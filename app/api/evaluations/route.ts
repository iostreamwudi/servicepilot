import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, evaluationResults, evaluationRuns } from "../../../db/schema";
import evaluationSet from "../../../data/eval-seed.json";
import realEvaluationSet from "../../../data/eval-csds-real.json";
import blindEvaluationSet from "../../../data/eval-csds-blind.json";
import { POST as respond } from "../agent/respond/route";

const ORG_ID = "org-qingyu";
const DATASET_VERSION = "1.0-real85+seed15";
const BLIND_DATASET_VERSION = "1.0-blind40+seed15";
const SYSTEM_VERSION = "router-v2.0";
type HistoryTurn = { role: "user" | "assistant"; content: string };
type EvaluationCase = {
  id: string; category: string; query: string; expectedSource: string | null; expectedHandoff: boolean;
  mustContain?: string[]; mustNotContain?: string[]; history?: HistoryTurn[]; contextRequired?: boolean;
  source?: { dataset: string; dialogueId?: string };
};
type AgentResponse = {
  answer: string; source: { id: string } | null; handoff: boolean; latencyMs?: number; mode: string; error?: string;
  routing?: { intent: string; confidence: number; matchedSignals: string[] } | null;
};

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

function normalize(value: string) { return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?]/g, ""); }

async function evaluateCase(item: EvaluationCase, request: Request) {
  const started = Date.now();
  const email = authenticatedEmail(request)!;
  const response = await respond(new Request(new URL("/api/agent/respond", request.url), {
    method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-email": email },
    body: JSON.stringify({ query: item.query, history: item.history ?? [] }),
  }));
  const body = await response.json() as AgentResponse;
  if (!response.ok) throw new Error(body.error || `Agent returned ${response.status}`);
  const failures: string[] = [];
  if ((body.source?.id ?? null) !== item.expectedSource) failures.push("知识来源不符合预期");
  if (body.handoff !== item.expectedHandoff) failures.push("转人工决策不符合预期");
  const answer = normalize(body.answer);
  for (const text of item.mustContain ?? []) if (!answer.includes(normalize(text))) failures.push(`缺少必要信息：${text}`);
  for (const text of item.mustNotContain ?? []) if (answer.includes(normalize(text))) failures.push(`包含禁止内容：${text}`);
  return { item, body, failures, latencyMs: Date.now() - started, passed: failures.length === 0 };
}

async function runWithConcurrency(items: EvaluationCase[], request: Request, concurrency = 3) {
  const results = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    const settled = await Promise.all(batch.map(async (item) => {
      try { return await evaluateCase(item, request); }
      catch (error) { return { item, body: { answer: "", source: null, handoff: true, mode: "request-failed" }, failures: [`调用失败：${error instanceof Error ? error.message : "unknown"}`], latencyMs: 0, passed: false }; }
    }));
    results.push(...settled);
  }
  return results;
}

export async function GET(request: Request) {
  if (!authenticatedEmail(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const db = getDb();
  const runs = await db.select().from(evaluationRuns).where(eq(evaluationRuns.organizationId, ORG_ID)).orderBy(desc(evaluationRuns.startedAt)).limit(10);
  const latest = runs.find((run) => run.status === "completed") ?? null;
  const blindConsumed = runs.some((run) => run.suite === "blind" && run.systemVersion === SYSTEM_VERSION && run.status === "completed");
  if (!latest) return Response.json({ runs, latest: null, results: [], blindConsumed });
  const results = await db.select().from(evaluationResults).where(eq(evaluationResults.runId, latest.id));
  return Response.json({ runs, latest, results, blindConsumed });
}

export async function POST(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const db = getDb();
  let suite: "regression" | "blind" = "regression";
  try { const raw = await request.text(); if (raw) { const body = JSON.parse(raw) as { suite?: unknown }; if (body.suite === "blind") suite = "blind"; } }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const recent = await db.select().from(evaluationRuns).where(eq(evaluationRuns.organizationId, ORG_ID)).orderBy(desc(evaluationRuns.startedAt)).limit(1);
  if (recent[0] && recent[0].status !== "failed" && Date.now() - new Date(recent[0].startedAt).getTime() < 300_000) return Response.json({ error: "请等待 5 分钟后再次运行，避免重复消耗模型额度" }, { status: 429 });
  if (suite === "blind") {
    const consumed = await db.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(eq(evaluationRuns.organizationId, ORG_ID), eq(evaluationRuns.suite, "blind"), eq(evaluationRuns.systemVersion, SYSTEM_VERSION), eq(evaluationRuns.status, "completed"))).limit(1);
    if (consumed[0]) return Response.json({ error: "当前系统版本已经运行过冻结盲测；请升级系统版本后再使用新的盲测集" }, { status: 409 });
  }
  const items = (suite === "blind" ? [...evaluationSet.cases, ...blindEvaluationSet.cases] : [...evaluationSet.cases, ...realEvaluationSet.cases]) as EvaluationCase[];
  const datasetVersion = suite === "blind" ? BLIND_DATASET_VERSION : DATASET_VERSION;
  const runId = `ER-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db.insert(evaluationRuns).values({ id: runId, organizationId: ORG_ID, model: "qwen-plus", datasetVersion, suite, systemVersion: SYSTEM_VERSION, status: "running", totalCases: items.length, startedAt });
  try {
    const results = await runWithConcurrency(items, request, 5);
    const passed = results.filter((item) => item.passed).length;
    const highRisk = results.filter((item) => ["high-risk", "adversarial", "privacy"].includes(item.item.category));
    const highRiskPassed = highRisk.filter((item) => item.passed).length;
    const averageLatencyMs = Math.round(results.reduce((sum, item) => sum + item.latencyMs, 0) / Math.max(results.length, 1));
    const rows = results.map((result) => ({
      id: `EV-${crypto.randomUUID()}`, runId, caseId: result.item.id, category: result.item.category, query: result.item.query,
      passed: result.passed, expectedSource: result.item.expectedSource, actualSource: result.body.source?.id ?? null,
      expectedHandoff: result.item.expectedHandoff, actualHandoff: result.body.handoff, latencyMs: result.latencyMs,
      mode: result.body.mode, failuresJson: JSON.stringify(result.failures), answer: result.body.answer,
      sourceDataset: result.item.source?.dataset ?? "ServicePilot synthetic seed",
      sourceRecordId: result.item.source?.dialogueId ?? result.item.id,
      contextRequired: result.item.contextRequired ?? false,
      historyJson: JSON.stringify(result.item.history ?? []),
      routingIntent: result.body.routing?.intent ?? null,
      routingConfidence: result.body.routing?.confidence ?? null,
      routingSignalsJson: JSON.stringify(result.body.routing?.matchedSignals ?? []),
    }));
    for (let index = 0; index < rows.length; index += 4) await db.insert(evaluationResults).values(rows.slice(index, index + 4));
    const summary = { status: "completed" as const, passedCases: passed, passRate: passed / items.length, highRiskPassRate: highRiskPassed / Math.max(highRisk.length, 1), averageLatencyMs, completedAt: new Date().toISOString() };
    await db.update(evaluationRuns).set(summary).where(eq(evaluationRuns.id, runId));
    await db.insert(auditLogs).values({ id: `A-EVAL-${crypto.randomUUID()}`, organizationId: ORG_ID, actorType: "user", action: "evaluation.run", resourceType: "evaluation_run", resourceId: runId, result: "allowed", risk: "low", metadataJson: JSON.stringify({ actorEmail: email, model: "qwen-plus", totalCases: items.length, suite, systemVersion: SYSTEM_VERSION }) });
    return Response.json({ run: { id: runId, model: "qwen-plus", datasetVersion, suite, systemVersion: SYSTEM_VERSION, totalCases: items.length, ...summary }, results }, { status: 201 });
  } catch (error) {
    await db.update(evaluationRuns).set({ status: "failed", completedAt: new Date().toISOString() }).where(eq(evaluationRuns.id, runId));
    await db.insert(auditLogs).values({ id: `A-EVAL-FAIL-${crypto.randomUUID()}`, organizationId: ORG_ID, actorType: "system", action: "evaluation.fail", resourceType: "evaluation_run", resourceId: runId, result: "failed", risk: "medium", metadataJson: JSON.stringify({ errorType: error instanceof Error ? error.name : "unknown" }) });
    return Response.json({ error: "评测运行未完成，系统已记录失败原因，请稍后重试", runId }, { status: 500 });
  }
}
