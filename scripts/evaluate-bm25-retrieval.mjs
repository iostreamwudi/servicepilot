import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { matchKnowledgeSource } from "../lib/knowledge-hierarchy.ts";
import { routeIntent } from "../lib/intent-router.ts";
import { applyActionAwareRerank, retrieveBm25Candidates, retrieveContextualBm25Candidates, selectBm25Candidate } from "../lib/retrieval.ts";

const outputPath = process.env.SERVICEPILOT_BM25_OUTPUT;
const files = {
  real: new URL("../data/eval-csds-real.json", import.meta.url),
  seed: new URL("../data/eval-seed.json", import.meta.url),
  knowledge: new URL("../data/knowledge-seed.json", import.meta.url),
};

function normalize(value) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?；;：:]/g, "");
}

function legacyKeywordSource(documents, query, intent, defaultDocumentId) {
  const genericSignals = {
    refund: new Set(["退款", "退货", "七天", "七日", "无理由"]),
    damage: new Set(["破损", "坏了", "质量问题"]),
    address: new Set(["地址", "物流", "收货地址"]),
    invoice: new Set(["发票", "电子发票", "数电发票"]),
  };
  const normalized = normalize(query);
  const scored = documents.filter((document) => document.state === "active" && document.category === intent).map((document) => {
    const hits = document.keywords.filter((keyword) => normalized.includes(normalize(keyword)));
    const score = hits.reduce((total, keyword) => total + (genericSignals[intent].has(keyword) ? 1 : 8 + Math.min(keyword.length, 4)), 0) + (document.id === defaultDocumentId ? 2 : 0);
    return { document, score };
  }).sort((left, right) => right.score - left.score || Number(right.document.id === defaultDocumentId) - Number(left.document.id === defaultDocumentId));
  const selected = scored[0];
  const fallback = scored.find((item) => item.document.id === defaultDocumentId);
  return selected ? (selected.score > 2 ? selected : fallback ?? selected).document.id : null;
}

function summarize(records, field) {
  const strict = records.filter((record) => record[field] === record.expectedSource).length;
  const accepted = records.filter((record) => matchKnowledgeSource(record.expectedSource, record[field], record.query).passed).length;
  return { strictPassed: strict, strictPassRate: strict / records.length, acceptedPassed: accepted, acceptedPassRate: accepted / records.length };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function main() {
  const [real, seed, knowledge] = await Promise.all(Object.values(files).map(async (file) => JSON.parse(await fs.readFile(file, "utf8"))));
  const cases = [...real.cases, ...seed.cases];
  const documents = knowledge.documents;
  const timings = [];
  const contextualTimings = [];
  const records = cases.map((item) => {
    const routing = routeIntent(item.query, item.history ?? []);
    const legacySource = routing ? legacyKeywordSource(documents, item.query, routing.intent, routing.retrievalKnowledgeId) : null;
    const started = performance.now();
    const bm25Candidates = routing ? retrieveBm25Candidates(documents, item.query, { category: routing.intent, defaultDocumentId: routing.retrievalKnowledgeId, limit: 5 }) : [];
    const bm25Source = selectBm25Candidate(bm25Candidates, routing?.retrievalKnowledgeId)?.document.id ?? null;
    const bm25ActionCandidates = routing ? applyActionAwareRerank(bm25Candidates, item.query, routing.retrievalKnowledgeId) : [];
    const bm25ActionSource = bm25ActionCandidates[0]?.document.id ?? null;
    timings.push(performance.now() - started);
    const contextualStarted = performance.now();
    const contextualCandidates = routing ? retrieveContextualBm25Candidates(documents, item.query, { category: routing.intent, defaultDocumentId: routing.retrievalKnowledgeId, limit: 5 }) : [];
    const contextualActionCandidates = routing ? applyActionAwareRerank(contextualCandidates, item.query, routing.retrievalKnowledgeId) : [];
    const contextualSource = contextualActionCandidates[0]?.document.id ?? null;
    contextualTimings.push(performance.now() - contextualStarted);
    const before = matchKnowledgeSource(item.expectedSource ?? null, legacySource, item.query).passed;
    const after = matchKnowledgeSource(item.expectedSource ?? null, bm25Source, item.query).passed;
    return {
      id: item.id,
      category: item.category,
      query: item.query,
      contextRequired: item.contextRequired ?? false,
      expectedSource: item.expectedSource ?? null,
      routingIntent: routing?.intent ?? null,
      defaultSource: routing?.retrievalKnowledgeId ?? null,
      legacySource,
      bm25Source,
      bm25ActionSource,
      contextualSource,
      bm25Top: bm25Candidates.slice(0, 3).map((candidate) => ({ id: candidate.document.id, score: Number(candidate.bm25Score.toFixed(4)), matchedKeywords: candidate.matchedKeywords, matchedTerms: candidate.matchedTerms.slice(0, 12) })),
      delta: legacySource === bm25Source ? "unchanged" : !before && after ? "improved" : before && !after ? "regressed" : "neutral",
      actionDelta: legacySource === bm25ActionSource ? "unchanged" : !before && matchKnowledgeSource(item.expectedSource ?? null, bm25ActionSource, item.query).passed ? "improved" : before && !matchKnowledgeSource(item.expectedSource ?? null, bm25ActionSource, item.query).passed ? "regressed" : "neutral",
      contextualDelta: bm25ActionSource === contextualSource ? "unchanged" : !matchKnowledgeSource(item.expectedSource ?? null, bm25ActionSource, item.query).passed && matchKnowledgeSource(item.expectedSource ?? null, contextualSource, item.query).passed ? "improved" : matchKnowledgeSource(item.expectedSource ?? null, bm25ActionSource, item.query).passed && !matchKnowledgeSource(item.expectedSource ?? null, contextualSource, item.query).passed ? "regressed" : "neutral",
      contextualTop: contextualCandidates.slice(0, 3).map((candidate) => ({ id: candidate.document.id, score: Number(candidate.bm25Score.toFixed(4)), parentDocumentId: candidate.parentDocumentId, chunkId: candidate.bestChunk.id, sectionType: candidate.bestChunk.sectionType, content: candidate.bestChunk.content })),
    };
  });
  const changed = records.filter((record) => record.delta !== "unchanged");
  const actionChanged = records.filter((record) => record.actionDelta !== "unchanged");
  const contextualChanged = records.filter((record) => record.contextualDelta !== "unchanged");
  const report = {
    version: "contextual-step8.2-v1",
    dataset: `${real.version}-real85+${seed.version}-seed15`,
    cases: records.length,
    routingSource: "current-routeIntent-with-history",
    knowledgeVersion: knowledge.version,
    legacy: summarize(records, "legacySource"),
    bm25: summarize(records, "bm25Source"),
    bm25Action: summarize(records, "bm25ActionSource"),
    contextualAction: summarize(records, "contextualSource"),
    contextRequired: {
      cases: records.filter((record) => record.contextRequired).length,
      legacy: summarize(records.filter((record) => record.contextRequired), "legacySource"),
      bm25: summarize(records.filter((record) => record.contextRequired), "bm25Source"),
      bm25Action: summarize(records.filter((record) => record.contextRequired), "bm25ActionSource"),
      contextualAction: summarize(records.filter((record) => record.contextRequired), "contextualSource"),
    },
    latencyMs: { average: timings.reduce((total, value) => total + value, 0) / timings.length, p95: percentile(timings, 0.95), maximum: Math.max(...timings) },
    contextualLatencyMs: { average: contextualTimings.reduce((total, value) => total + value, 0) / contextualTimings.length, p95: percentile(contextualTimings, 0.95), maximum: Math.max(...contextualTimings) },
    deltaSummary: {
      bm25: { changed: changed.length, improved: changed.filter((record) => record.delta === "improved").length, regressed: changed.filter((record) => record.delta === "regressed").length, neutral: changed.filter((record) => record.delta === "neutral").length },
      bm25Action: { changed: actionChanged.length, improved: actionChanged.filter((record) => record.actionDelta === "improved").length, regressed: actionChanged.filter((record) => record.actionDelta === "regressed").length, neutral: actionChanged.filter((record) => record.actionDelta === "neutral").length },
      contextualAgainstBm25Action: { changed: contextualChanged.length, improved: contextualChanged.filter((record) => record.contextualDelta === "improved").length, regressed: contextualChanged.filter((record) => record.contextualDelta === "regressed").length, neutral: contextualChanged.filter((record) => record.contextualDelta === "neutral").length },
    },
    changes: changed,
    actionChanges: actionChanged,
    contextualChanges: contextualChanged,
    failures: records.filter((record) => !matchKnowledgeSource(record.expectedSource, record.bm25Source, record.query).passed),
    bm25ActionFailures: records.filter((record) => !matchKnowledgeSource(record.expectedSource, record.bm25ActionSource, record.query).passed),
    contextualFailures: records.filter((record) => !matchKnowledgeSource(record.expectedSource, record.contextualSource, record.query).passed),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await fs.writeFile(outputPath, serialized);
  process.stdout.write(serialized);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
