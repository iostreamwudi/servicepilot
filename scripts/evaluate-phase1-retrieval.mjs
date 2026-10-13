import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { matchKnowledgeSource } from "../lib/knowledge-hierarchy.ts";
import { routeIntent } from "../lib/intent-router.ts";
import { businessRuleBoostForDocument, retrieveBm25Candidates, retrieveScopedBm25Candidates } from "../lib/retrieval.ts";
import { buildRetrievalScope } from "../lib/retrieval-scope.ts";
import { reciprocalRankFusion } from "../lib/rrf.ts";
import { rerankCandidates } from "../lib/reranker.ts";

const casesPath = process.env.SERVICEPILOT_PHASE1_CASES ?? "data/eval-csds-holdout3-100.json";

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function relevant(expected, candidate, query) {
  return matchKnowledgeSource(expected ?? null, candidate ?? null, query).passed;
}

function metrics(records, field, maxRank = 10) {
  const usable = records.filter((record) => Array.isArray(record[field]));
  const at = (record, rank) => record[field].slice(0, rank).some((id) => relevant(record.expected, id, record.query));
  const recall = rank => usable.length ? usable.filter(record => at(record, rank)).length / usable.length : null;
  const mrr = usable.length ? usable.reduce((sum, record) => {
    const rank = record[field].findIndex((id) => relevant(record.expected, id, record.query));
    return sum + (rank < 0 ? 0 : 1 / (rank + 1));
  }, 0) / usable.length : null;
  const ndcg5 = usable.length ? usable.reduce((sum, record) => {
    const rank = record[field].slice(0, 5).findIndex((id) => relevant(record.expected, id, record.query));
    return sum + (rank < 0 ? 0 : 1 / Math.log2(rank + 2));
  }, 0) / usable.length : null;
  return { cases: usable.length, recallAt5: recall(5), recallAt10: maxRank >= 10 ? recall(10) : null, hitAt5: recall(5), mrr, ndcgAt5: ndcg5 };
}

async function main() {
  const [knowledge, evaluation] = await Promise.all([
    fs.readFile("data/knowledge-seed.json", "utf8").then(JSON.parse),
    fs.readFile(casesPath, "utf8").then(JSON.parse),
  ]);
  const documents = knowledge.documents.map(document => ({ ...document, organizationId: "org-qingyu" }));
  const timings = { v1: [], v2Before: [], v2After: [] };
  const records = [];
  for (const item of evaluation.cases) {
    const routing = routeIntent(item.query, item.history ?? []);
    if (!routing) continue;
    const scope = buildRetrievalScope({ organizationId: "org-qingyu", intent: routing.intent, preferredKnowledgeIds: [routing.retrievalKnowledgeId] });

    let started = performance.now();
    const v1 = retrieveBm25Candidates(documents, item.query, { category: routing.intent, defaultDocumentId: routing.retrievalKnowledgeId, limit: 5 });
    timings.v1.push(performance.now() - started);

    started = performance.now();
    const bm25 = retrieveScopedBm25Candidates(documents, item.query, scope, { limit: 30 });
    const fused = reciprocalRankFusion([bm25.map((candidate, index) => ({ id: candidate.document.id, rank: index + 1, score: candidate.bm25Score, source: "bm25", payload: candidate }))], 60).slice(0, 25);
    const byId = new Map(documents.map(document => [document.id, document]));
    const boosted = fused.map(candidate => {
      const document = byId.get(candidate.id);
      const boost = businessRuleBoostForDocument({ documentId: candidate.id, query: item.query, preferredKnowledgeIds: scope.preferredKnowledgeIds, maxBoost: 0.01 });
      return { candidate, document, boost };
    }).filter(item => item.document).sort((left, right) => right.candidate.rrfScore + right.boost.boost - left.candidate.rrfScore - left.boost.boost);
    const v2Before = boosted.slice(0, 8).map(item => item.document.id);
    timings.v2Before.push(performance.now() - started);

    started = performance.now();
    const rerank = await rerankCandidates({ query: item.query, topK: 8, candidates: boosted.map(item => ({ id: `${item.document.id}#document`, knowledgeId: item.document.id, title: item.document.title, content: item.document.content, rrfScore: item.candidate.rrfScore, businessBoost: item.boost.boost, bm25Rank: item.candidate.bm25Rank, bm25Score: item.candidate.bm25Score, denseRank: null, denseScore: null })) });
    const v2After = rerank.candidates.map(candidate => candidate.knowledgeId);
    timings.v2After.push(performance.now() - started);
    records.push({ id: item.id, query: item.query, expected: item.expectedSource ?? null, v1: v1.map(candidate => candidate.document.id), v2Before, v2After });
  }
  const result = {
    version: "phase1-retrieval-v2-offline-bm25-only",
    dataset: evaluation.version,
    cases: records.length,
    note: "本地没有当前 D1 Dense 索引、Embedding 凭据或远程 Reranker 配置，因此本报告不伪造双路或语义精排结果；V2-before 使用 BM25 wider recall + 单路 rank fusion，V2-after 按规定回退为同一 RRF + Boost 排序。线上 V2 在服务可用时执行 BM25 + Dense RRF + qwen3-rerank。",
    metrics: {
      v1: metrics(records, "v1", 5),
      v2BeforeRerank: metrics(records, "v2Before", 8),
      v2AfterRerank: metrics(records, "v2After", 8),
    },
    latencyMs: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, { p50: percentile(values, 0.5), p95: percentile(values, 0.95), average: values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1) }])),
    dense: { status: "not-run", reason: "LOCAL_DENSE_INDEX_OR_CREDENTIALS_UNAVAILABLE" },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
