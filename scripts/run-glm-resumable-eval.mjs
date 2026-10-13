import fs from "node:fs/promises";
import { matchKnowledgeSource } from "../lib/knowledge-hierarchy.ts";

const casesPath = process.env.SERVICEPILOT_EVAL_CASES ?? "/private/tmp/glm-csds-full4196.json";
const outputPath = process.env.SERVICEPILOT_REAL_AGENT_OUTPUT ?? "/private/tmp/glm-csds-full4196-result.json";
const journalPath = process.env.SERVICEPILOT_EVAL_JOURNAL ?? "/private/tmp/glm-csds-full4196-results.jsonl";
const appBaseUrl = (process.env.SERVICEPILOT_APP_URL ?? "http://150.158.86.194").replace(/\/$/, "");
const strategy = process.env.SERVICEPILOT_RETRIEVAL_STRATEGY ?? "bounded-agentic-rag-step9.9-v1";
const concurrency = Math.max(1, Number(process.env.SERVICEPILOT_EVAL_CONCURRENCY ?? 1));
const maxConsecutiveFailures = Math.max(1, Number(process.env.SERVICEPILOT_MAX_CONSECUTIVE_FAILURES ?? 3));

function normalize(value) { return String(value ?? "").toLowerCase().replace(/\s+/g, ""); }
function quotaLike(error) {
  const text = String(error ?? "").toLowerCase();
  return /http_(401|402|403|429)|quota|insufficient|balance|rate.?limit|limit.?exceed|credit|api.?key|unauthori[sz]ed|forbidden/.test(text);
}
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
    caseId: item.id, query: item.query, expectedSource: item.expectedSource ?? null,
    actualSource, expectedHandoff: item.expectedHandoff, actualHandoff: body?.handoff ?? null,
    routingIntent: body?.routing?.intent ?? null, routingConfidence: body?.routing?.confidence ?? null,
    routingMargin: body?.routing?.margin ?? null, sourceRelation: sourceMatch.relation,
    sourceReason: sourceMatch.reason, passed: failures.length === 0, failures,
    answer: body?.answer ?? null, traceId: body?.traceId ?? null, latencyMs,
    model: body?.sourceId?.startsWith("model:") ? body.sourceId.slice(6) : null,
    httpError: error ?? null, quotaLike: Boolean(error && quotaLike(error)),
  };
}
async function callAgent(item) {
  const started = Date.now(); let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${appBaseUrl}/api/agent/respond`, {
        method: "POST",
        headers: { "content-type": "application/json", "oai-authenticated-user-email": "eval-4196@servicepilot.local", "x-servicepilot-environment": "test", "x-servicepilot-channel": "customer-demo", "x-servicepilot-retrieval-experiment": strategy },
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
function metrics(rows) {
  const n = rows.length; const count = (predicate) => rows.filter(predicate).length;
  const avg = n ? rows.reduce((sum, row) => sum + (row.latencyMs ?? 0), 0) / n : 0;
  const sorted = [...rows].sort((a, b) => a.latencyMs - b.latencyMs);
  const p95 = n ? sorted[Math.max(0, Math.ceil(n * 0.95) - 1)]?.latencyMs ?? null : null;
  return { casesEvaluated: n, passed: count((row) => row.passed), passRate: n ? count((row) => row.passed) / n : 0, sourcePassed: count((row) => row.sourceRelation === "exact" || row.sourceRelation === "accepted-child"), sourcePassRate: n ? count((row) => row.sourceRelation === "exact" || row.sourceRelation === "accepted-child") / n : 0, handoffPassed: count((row) => row.actualHandoff === row.expectedHandoff), handoffPassRate: n ? count((row) => row.actualHandoff === row.expectedHandoff) / n : 0, avgLatencyMs: Math.round(avg), p95LatencyMs: p95, httpErrors: count((row) => Boolean(row.httpError)) };
}
function byCategory(rows) {
  return Object.fromEntries([...new Set(rows.map((row) => row.category))].map((category) => {
    const subset = rows.filter((row) => row.category === category); const m = metrics(subset);
    return [category, { cases: subset.length, passed: m.passed, passRate: m.passRate, sourcePassed: m.sourcePassed, handoffPassed: m.handoffPassed, httpErrors: m.httpErrors }];
  }));
}
async function main() {
  const raw = JSON.parse(await fs.readFile(casesPath, "utf8")); const cases = raw.cases ?? raw;
  const rows = new Array(cases.length); const done = new Set();
  try {
    const journal = await fs.readFile(journalPath, "utf8");
    for (const line of journal.split("\n")) { if (!line.trim()) continue; const row = JSON.parse(line); const index = cases.findIndex((item) => item.id === row.caseId); if (index >= 0) { rows[index] = row; done.add(index); } }
  } catch { /* fresh run */ }
  let next = 0; let completed = done.size; let consecutiveFailures = 0; let stoppedEarly = false; let stopReason = null;
  async function worker() {
    while (!stoppedEarly) {
      while (next < cases.length && done.has(next)) next += 1;
      const index = next++; if (index >= cases.length) return;
      const row = await callAgent(cases[index]); row.category = cases[index].category; rows[index] = row; done.add(index); completed += 1;
      await fs.appendFile(journalPath, `${JSON.stringify(row)}\n`, "utf8");
      if (row.httpError) consecutiveFailures += 1; else consecutiveFailures = 0;
      if (consecutiveFailures >= maxConsecutiveFailures) { stoppedEarly = true; stopReason = `consecutive_api_failures:${consecutiveFailures}`; }
      if (completed % 25 === 0 || stoppedEarly || completed === cases.length) console.error(`progress ${completed}/${cases.length}${stoppedEarly ? ` stopped=${stopReason}` : ""}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const evaluated = rows.filter(Boolean); const report = { generatedAt: new Date().toISOString(), appBaseUrl, strategy, model: evaluated.find((row) => row.model)?.model ?? "unknown", cases: cases.length, completedCases: evaluated.length, remainingCases: cases.length - evaluated.length, stoppedEarly, stopReason, concurrency, metrics: metrics(evaluated), byCategory: byCategory(evaluated), results: evaluated };
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, strategy, model: report.model, cases: report.cases, completedCases: report.completedCases, remainingCases: report.remainingCases, stoppedEarly, stopReason, metrics: report.metrics, byCategory: report.byCategory }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
