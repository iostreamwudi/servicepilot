import fs from "node:fs/promises";
import { matchKnowledgeSource } from "../lib/knowledge-hierarchy.ts";

const casesPath = process.env.SERVICEPILOT_EVAL_CASES ?? "data/eval-csds-holdout500.json";
const outputPath = process.env.SERVICEPILOT_REAL_AGENT_OUTPUT ?? "/tmp/servicepilot-real-agent-eval.json";
const appBaseUrl = (process.env.SERVICEPILOT_APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const strategy = process.env.SERVICEPILOT_RETRIEVAL_STRATEGY ?? "bounded-agentic-rag-step9.8-v1";
const concurrency = Math.max(1, Number(process.env.SERVICEPILOT_EVAL_CONCURRENCY ?? 2));

function normalize(value) { return String(value ?? "").toLowerCase().replace(/\s+/g, ""); }
function scoreCase(item, body, error, latencyMs) {
  const actualSource = body?.source?.id ?? null;
  const answer = normalize(body?.answer ?? "");
  const sourceMatch = matchKnowledgeSource(item.expectedSource ?? null, actualSource, item.query);
  const failures = [];
  if (error) failures.push(error);
  if (!sourceMatch.passed) failures.push("source");
  if (body?.handoff !== item.expectedHandoff) failures.push("handoff");
  for (const text of item.mustContain ?? []) if (!answer.includes(normalize(text))) failures.push(`mustContain:${text}`);
  for (const text of item.mustNotContain ?? []) if (answer.includes(normalize(text))) failures.push(`mustNotContain:${text}`);
  return {
    caseId: item.id,
    query: item.query,
    expectedSource: item.expectedSource ?? null,
    actualSource,
    expectedHandoff: item.expectedHandoff,
    actualHandoff: body?.handoff ?? null,
    routingIntent: body?.routing?.intent ?? null,
    routingConfidence: body?.routing?.confidence ?? null,
    routingMargin: body?.routing?.margin ?? null,
    sourceRelation: sourceMatch.relation,
    sourceReason: sourceMatch.reason,
    passed: failures.length === 0,
    failures,
    answer: body?.answer ?? null,
    traceId: body?.traceId ?? null,
    latencyMs,
    model: body?.sourceId?.startsWith("model:") ? body.sourceId.slice(6) : null,
    httpError: error ?? null,
  };
}

async function callAgent(item) {
  const started = Date.now();
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${appBaseUrl}/api/agent/respond`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "oai-authenticated-user-email": "eval-500@servicepilot.local",
          "x-servicepilot-environment": "test",
          "x-servicepilot-channel": "customer-demo",
          "x-servicepilot-retrieval-experiment": strategy,
        },
        body: JSON.stringify({ query: item.query, history: item.history ?? [], channel: "customer-demo" }),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`HTTP_${response.status}:${body?.failureCode ?? body?.error ?? "unknown"}`);
      return scoreCase(item, body, null, Date.now() - started);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  return scoreCase(item, {}, lastError, Date.now() - started);
}

async function main() {
  const raw = JSON.parse(await fs.readFile(casesPath, "utf8"));
  const cases = raw.cases ?? raw;
  const results = new Array(cases.length);
  let next = 0; let completed = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= cases.length) return;
      results[index] = await callAgent(cases[index]);
      completed += 1;
      if (completed % 25 === 0 || completed === cases.length) console.error(`progress ${completed}/${cases.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const count = (predicate) => results.filter(predicate).length;
  const avg = results.reduce((sum, row) => sum + (row.latencyMs ?? 0), 0) / results.length;
  const p95 = [...results].sort((a, b) => a.latencyMs - b.latencyMs)[Math.max(0, Math.ceil(results.length * 0.95) - 1)]?.latencyMs ?? null;
  const report = {
    generatedAt: new Date().toISOString(),
    appBaseUrl, strategy, cases: cases.length, concurrency,
    model: results.find((row) => row.model)?.model ?? "unknown",
    metrics: {
      passed: count((row) => row.passed), passRate: count((row) => row.passed) / cases.length,
      sourcePassed: count((row) => row.sourceRelation === "exact" || row.sourceRelation === "accepted-child"),
      sourcePassRate: count((row) => row.sourceRelation === "exact" || row.sourceRelation === "accepted-child") / cases.length,
      handoffPassed: count((row) => row.actualHandoff === row.expectedHandoff),
      handoffPassRate: count((row) => row.actualHandoff === row.expectedHandoff) / cases.length,
      avgLatencyMs: Math.round(avg), p95LatencyMs: p95,
      httpErrors: count((row) => Boolean(row.httpError)),
    },
    byCategory: Object.fromEntries([...new Set(cases.map((item) => item.category))].map((category) => {
      const rows = results.filter((row) => cases.find((item) => item.id === row.caseId)?.category === category);
      return [category, { cases: rows.length, passed: rows.filter((row) => row.passed).length, passRate: rows.filter((row) => row.passed).length / rows.length, sourcePassed: rows.filter((row) => row.sourceRelation === "exact" || row.sourceRelation === "accepted-child").length }];
    })),
    results,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, strategy, model: report.model, metrics: report.metrics, byCategory: report.byCategory }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
