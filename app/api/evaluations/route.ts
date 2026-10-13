import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, evaluationResults, evaluationRuns } from "../../../db/schema";
import evaluationSet from "../../../data/eval-seed.json";
import realEvaluationSet from "../../../data/eval-csds-real.json";
import blindEvaluationSet from "../../../data/eval-csds-blind.json";
import generalizationEvaluationSet from "../../../data/eval-csds-generalization-100.json";
import holdoutEvaluationSet from "../../../data/eval-csds-holdout2-100.json";
import holdout3EvaluationSet from "../../../data/eval-csds-holdout3-100.json";
import { POST as respond } from "../agent/respond/route";
import { matchKnowledgeSource } from "../../../lib/knowledge-hierarchy";

const ORG_ID = "org-qingyu";
const DATASET_VERSION = "1.0-real85+seed15";
const BLIND_DATASET_VERSION = "1.0-blind40+seed15";
const GENERALIZATION_DATASET_VERSION = "1.0-csds-train-new-agent100";
const HOLDOUT_DATASET_VERSION = "1.0-csds-train-holdout2-agent100";
const HOLDOUT3_DATASET_VERSION = "1.0-csds-train-holdout3-agent100";
const SYSTEM_VERSION = "router-v3.1-step8.7-glm52-stable";
const STEP89_SYSTEM_VERSION = "router-v3.2-step8.9-structured-actions";
const STEP810_SYSTEM_VERSION = "router-v3.3-step8.10-knowledge-action-matrix";
const STEP91_SYSTEM_VERSION = "router-v4.0-step9.1-constrained-hybrid-glm52";
const STEP92_SYSTEM_VERSION = "router-v4.1-step9.2-evidence-sufficiency-glm52";
const STEP93_SYSTEM_VERSION = "router-v4.2-step9.3-bounded-corrective-rag-glm52";
const STEP94_SYSTEM_VERSION = "router-v4.3-step9.4-bounded-multi-knowledge-glm52";
const STEP95_SYSTEM_VERSION = "router-v4.4-step9.5-governed-tool-decision-glm52";
const STEP96_SYSTEM_VERSION = "router-v4.5-step9.6-evidence-answer-review-glm52";
const STEP97_SYSTEM_VERSION = "router-v4.6-step9.7-joint-knowledge-tool-evidence-glm52";
const STEP98_SYSTEM_VERSION = "router-v4.7-step9.8-bounded-agentic-rag-glm52";
const STEP98_ACTION_SYSTEM_VERSION = "router-v4.9-step9.8-v1-service-action-guidance-glm52";
const STEP98_DOMAIN_SYSTEM_VERSION = "router-v5.0-step9.8-v1-domain-catalog-glm52";
const STEP98_MARGIN_SYSTEM_VERSION = "router-v5.1-step9.8-v1-adaptive-margin-glm52";
const STEP98_STATE_SYSTEM_VERSION = "router-v5.2-step9.8-v1-business-state-glm52";
const STEP98_TOPK_SYSTEM_VERSION = "router-v5.3-step9.8-v1-retrieval-calibration-glm52";
const STEP99_SYSTEM_VERSION = "router-v5.4-step9.9-v1-baseline-glm52";
const STEP99_REWRITE_SYSTEM_VERSION = "router-v5.5-step9.9-v1-bounded-query-rewrite-glm52";
const STEP99_CORRECTIVE_SYSTEM_VERSION = "router-v5.6-step9.9-v1-bounded-corrective-retrieval-glm52";
const STEP99_RERANK_SYSTEM_VERSION = "router-v5.7-step9.9-v1-qwen3-rerank-glm52";
const STEP98_V2_SYSTEM_VERSION = "router-v4.8-step9.8-bounded-agentic-rag-v2-glm52";
const STEP98_V2_BEFORE_SYSTEM_VERSION = "router-v4.8-step9.8-bounded-agentic-rag-v2-before-rerank-glm52";
const EVALUATION_MODEL = "minimax-m3";
type HistoryTurn = { role: "user" | "assistant"; content: string };
type EvaluationCase = {
  id: string; category: string; query: string; expectedSource: string | null; expectedHandoff: boolean;
  mustContain?: string[]; mustNotContain?: string[]; history?: HistoryTurn[]; contextRequired?: boolean;
  source?: { dataset: string; dialogueId?: string };
};
type AgentResponse = {
  answer: string; source: { id: string } | null; handoff: boolean; latencyMs?: number; mode: string; error?: string;
  routing?: { intent: string; confidence: number; matchedSignals: string[] } | null; traceId?: string; promptTokens?: number | null; completionTokens?: number | null; totalTokens?: number | null;
};

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

function normalize(value: string) { return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?]/g, ""); }

async function evaluateCase(item: EvaluationCase, request: Request, retrievalStrategy: string) {
  const started = Date.now();
  const email = authenticatedEmail(request)!;
  const response = await respond(new Request(new URL("/api/agent/respond", request.url), {
    method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-email": email, "x-servicepilot-environment": "test", "x-servicepilot-channel": "customer-demo", "x-servicepilot-retrieval-experiment": retrievalStrategy },
    body: JSON.stringify({ query: item.query, history: item.history ?? [] }),
  }));
  const body = await response.json() as AgentResponse;
  if (!response.ok) throw new Error(body.error || `Agent returned ${response.status}`);
  const failures: string[] = [];
  const sourceMatch = matchKnowledgeSource(item.expectedSource, body.source?.id ?? null, item.query);
  if (!sourceMatch.passed) failures.push("知识来源不符合预期");
  if (body.handoff !== item.expectedHandoff) failures.push("转人工决策不符合预期");
  const answer = normalize(body.answer);
  for (const text of item.mustContain ?? []) if (!answer.includes(normalize(text))) failures.push(`缺少必要信息：${text}`);
  for (const text of item.mustNotContain ?? []) if (answer.includes(normalize(text))) failures.push(`包含禁止内容：${text}`);
  return { item, body, failures, sourceMatch, latencyMs: Date.now() - started, passed: failures.length === 0 };
}

async function runWithConcurrency(items: EvaluationCase[], request: Request, retrievalStrategy: string, concurrency = 3) {
  const results = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    const settled = await Promise.all(batch.map(async (item) => {
      try { return await evaluateCase(item, request, retrievalStrategy); }
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
  let suite: "regression" | "blind" | "generalization" | "holdout" | "holdout3" = "regression";
  let variant: "step89" | "step810" | "step91" | "step92" | "step93" | "step94" | "step95" | "step96" | "step97" | "step98" | "step98action" | "step98domain" | "step98margin" | "step98state" | "step98topk" | "step99" | "step99rewrite" | "step99corrective" | "step99rerank" | "step98v2" | "step98v2before" | "step87" = "step91";
  try { const raw = await request.text(); if (raw) { const body = JSON.parse(raw) as { suite?: unknown; variant?: unknown }; if (body.suite === "blind" || body.suite === "generalization" || body.suite === "holdout" || body.suite === "holdout3") suite = body.suite; if (body.variant === "step89" || body.variant === "step810" || body.variant === "step91" || body.variant === "step92" || body.variant === "step93" || body.variant === "step94" || body.variant === "step95" || body.variant === "step96" || body.variant === "step97" || body.variant === "step98" || body.variant === "step98action" || body.variant === "step98domain" || body.variant === "step98margin" || body.variant === "step98state" || body.variant === "step98topk" || body.variant === "step99" || body.variant === "step99rewrite" || body.variant === "step99corrective" || body.variant === "step99rerank" || body.variant === "step98v2" || body.variant === "step98v2before") variant = body.variant; } }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const retrievalStrategy = variant === "step89" ? "structured-actions-step8.9-v1" : variant === "step810" ? "knowledge-action-matrix-step8.10-v1" : variant === "step91" ? "constrained-hybrid-step9.1-v1" : variant === "step92" ? "hybrid-evidence-step9.2-v1" : variant === "step93" ? "corrective-hybrid-step9.3-v1" : variant === "step94" ? "multi-knowledge-step9.4-v1" : variant === "step95" ? "tool-decision-step9.5-v1" : variant === "step96" ? "answer-review-step9.6-v1" : variant === "step97" ? "joint-evidence-step9.7-v1" : variant === "step98topk" ? "bounded-agentic-rag-step9.8-v1-retrieval-calibration" : variant === "step99rewrite" ? "bounded-agentic-rag-step9.9-v1-query-rewrite" : variant === "step99corrective" ? "bounded-agentic-rag-step9.9-v1-corrective-retrieval" : variant === "step99rerank" ? "bounded-agentic-rag-step9.9-v1-qwen3-rerank" : variant === "step99" ? "bounded-agentic-rag-step9.9-v1" : variant === "step98" || variant === "step98action" || variant === "step98domain" || variant === "step98margin" || variant === "step98state" ? "bounded-agentic-rag-step9.8-v1" : variant === "step98v2" ? "bounded-agentic-rag-step9.8-v2" : variant === "step98v2before" ? "bounded-agentic-rag-step9.8-v2-before-rerank" : "action-gates-step8.7-v1";
  const systemVersion = variant === "step89" ? STEP89_SYSTEM_VERSION : variant === "step810" ? STEP810_SYSTEM_VERSION : variant === "step91" ? STEP91_SYSTEM_VERSION : variant === "step92" ? STEP92_SYSTEM_VERSION : variant === "step93" ? STEP93_SYSTEM_VERSION : variant === "step94" ? STEP94_SYSTEM_VERSION : variant === "step95" ? STEP95_SYSTEM_VERSION : variant === "step96" ? STEP96_SYSTEM_VERSION : variant === "step97" ? STEP97_SYSTEM_VERSION : variant === "step98action" ? STEP98_ACTION_SYSTEM_VERSION : variant === "step98domain" ? STEP98_DOMAIN_SYSTEM_VERSION : variant === "step98margin" ? STEP98_MARGIN_SYSTEM_VERSION : variant === "step98state" ? STEP98_STATE_SYSTEM_VERSION : variant === "step98topk" ? STEP98_TOPK_SYSTEM_VERSION : variant === "step99rewrite" ? STEP99_REWRITE_SYSTEM_VERSION : variant === "step99corrective" ? STEP99_CORRECTIVE_SYSTEM_VERSION : variant === "step99rerank" ? STEP99_RERANK_SYSTEM_VERSION : variant === "step99" ? STEP99_SYSTEM_VERSION : variant === "step98" ? STEP98_SYSTEM_VERSION : variant === "step98v2" ? STEP98_V2_SYSTEM_VERSION : variant === "step98v2before" ? STEP98_V2_BEFORE_SYSTEM_VERSION : SYSTEM_VERSION;
  const recent = await db.select().from(evaluationRuns).where(eq(evaluationRuns.organizationId, ORG_ID)).orderBy(desc(evaluationRuns.startedAt)).limit(1);
  if (recent[0] && recent[0].systemVersion === systemVersion && recent[0].status !== "failed" && Date.now() - new Date(recent[0].startedAt).getTime() < 300_000) return Response.json({ error: "请等待 5 分钟后再次运行，避免重复消耗模型额度" }, { status: 429 });
  if (suite === "blind") {
    const consumed = await db.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(eq(evaluationRuns.organizationId, ORG_ID), eq(evaluationRuns.suite, "blind"), eq(evaluationRuns.systemVersion, systemVersion), eq(evaluationRuns.status, "completed"))).limit(1);
    if (consumed[0]) return Response.json({ error: "当前系统版本已经运行过冻结盲测；请升级系统版本后再使用新的盲测集" }, { status: 409 });
  }
  const items = (suite === "blind" ? [...evaluationSet.cases, ...blindEvaluationSet.cases] : suite === "generalization" ? generalizationEvaluationSet.cases : suite === "holdout" ? holdoutEvaluationSet.cases : suite === "holdout3" ? holdout3EvaluationSet.cases : [...evaluationSet.cases, ...realEvaluationSet.cases]) as EvaluationCase[];
  const datasetVersion = suite === "blind" ? BLIND_DATASET_VERSION : suite === "generalization" ? GENERALIZATION_DATASET_VERSION : suite === "holdout" ? HOLDOUT_DATASET_VERSION : suite === "holdout3" ? HOLDOUT3_DATASET_VERSION : DATASET_VERSION;
  const runId = `ER-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db.insert(evaluationRuns).values({ id: runId, organizationId: ORG_ID, model: EVALUATION_MODEL, datasetVersion, suite, systemVersion, status: "running", totalCases: items.length, startedAt });
  try {
    const results = await runWithConcurrency(items, request, retrievalStrategy, 2);
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
      traceId: result.body.traceId ?? null,
      promptTokens: result.body.promptTokens ?? null,
      completionTokens: result.body.completionTokens ?? null,
      totalTokens: result.body.totalTokens ?? null,
    }));
    for (let index = 0; index < rows.length; index += 4) await db.insert(evaluationResults).values(rows.slice(index, index + 4));
    const summary = { status: "completed" as const, passedCases: passed, passRate: passed / items.length, highRiskPassRate: highRiskPassed / Math.max(highRisk.length, 1), averageLatencyMs, completedAt: new Date().toISOString() };
    await db.update(evaluationRuns).set(summary).where(eq(evaluationRuns.id, runId));
    await db.insert(auditLogs).values({ id: `A-EVAL-${crypto.randomUUID()}`, organizationId: ORG_ID, actorType: "user", action: "evaluation.run", resourceType: "evaluation_run", resourceId: runId, result: "allowed", risk: "low", metadataJson: JSON.stringify({ actorEmail: email, model: EVALUATION_MODEL, totalCases: items.length, suite, systemVersion }) });
    return Response.json({ run: { id: runId, model: EVALUATION_MODEL, datasetVersion, suite, systemVersion, totalCases: items.length, ...summary }, results }, { status: 201 });
  } catch (error) {
    await db.update(evaluationRuns).set({ status: "failed", completedAt: new Date().toISOString() }).where(eq(evaluationRuns.id, runId));
    await db.insert(auditLogs).values({ id: `A-EVAL-FAIL-${crypto.randomUUID()}`, organizationId: ORG_ID, actorType: "system", action: "evaluation.fail", resourceType: "evaluation_run", resourceId: runId, result: "failed", risk: "medium", metadataJson: JSON.stringify({ errorType: error instanceof Error ? error.name : "unknown" }) });
    return Response.json({ error: "评测运行未完成，系统已记录失败原因，请稍后重试", runId }, { status: 500 });
  }
}
