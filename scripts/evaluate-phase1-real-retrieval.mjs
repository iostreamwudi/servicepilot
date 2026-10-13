import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { matchKnowledgeSource } from "../lib/knowledge-hierarchy.ts";
import { routeIntent } from "../lib/intent-router.ts";
import {
  applyActionAwareRerank,
  businessRuleBoostForDocument,
  retrieveCandidates,
  retrieveScopedBm25Candidates,
  retrieveScopedDenseCandidates,
} from "../lib/retrieval.ts";
import { buildRetrievalScope } from "../lib/retrieval-scope.ts";
import { reciprocalRankFusion } from "../lib/rrf.ts";
import { rerankCandidates } from "../lib/reranker.ts";

const casesPath = process.env.SERVICEPILOT_PHASE1_CASES ?? "data/eval-csds-holdout3-100.json";
const outputPath = process.env.SERVICEPILOT_REAL_RETRIEVAL_OUTPUT ?? "Optimization_process/phase1.1-real-retrieval-eval.json";
const model = process.env.EMBEDDING_MODEL ?? "qwen3.7-text-embedding";
const embeddingBaseUrl = process.env.EMBEDDING_BASE_URL ?? process.env.LLM_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
const rerankBaseUrl = process.env.RERANK_BASE_URL ?? process.env.LLM_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
const embeddingApiKey = process.env.EMBEDDING_API_KEY ?? process.env.LLM_API_KEY ?? "";
const rerankApiKey = process.env.RERANK_API_KEY ?? process.env.LLM_API_KEY ?? "";
const indexPath = process.env.SERVICEPILOT_EMBEDDING_INDEX ?? "";
const knowledgePath = process.env.SERVICEPILOT_KNOWLEDGE_SNAPSHOT ?? "";
const retrievalConfig = {
  bm25TopK: Number(process.env.RETRIEVAL_V2_BM25_TOP_K ?? 30),
  denseTopK: Number(process.env.RETRIEVAL_V2_DENSE_TOP_K ?? 30),
  fusionTopK: Number(process.env.RETRIEVAL_V2_FUSION_TOP_K ?? 25),
  rerankTopK: Number(process.env.RETRIEVAL_V2_RERANK_TOP_K ?? 8),
  rrfK: Number(process.env.RETRIEVAL_V2_RRF_K ?? 60),
  maxBusinessBoost: Number(process.env.RETRIEVAL_V2_MAX_BUSINESS_BOOST ?? 0.0005),
};

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function cosine(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return 0;
  let dot = 0; let leftMagnitude = 0; let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

function relevant(expected, actual, query) {
  return matchKnowledgeSource(expected ?? null, actual ?? null, query).passed;
}

function metrics(records, field, limit = 10) {
  const rankOf = (record) => {
    const rank = record[field].findIndex((id) => relevant(record.expected, id, record.query));
    return rank < 0 ? null : rank + 1;
  };
  const usable = records.length || 1;
  const recall = (at) => records.filter((record) => (rankOf(record) ?? Infinity) <= at).length / usable;
  const mrr = records.reduce((sum, record) => sum + (rankOf(record) ? 1 / rankOf(record) : 0), 0) / usable;
  const ndcgAt5 = records.reduce((sum, record) => {
    const rank = rankOf(record);
    return sum + (rank && rank <= 5 ? 1 / Math.log2(rank + 1) : 0);
  }, 0) / usable;
  return { cases: records.length, recallAt1: recall(1), recallAt3: recall(3), recallAt5: recall(5), recallAt10: limit >= 10 ? recall(10) : null, mrr, ndcgAt5 };
}

function parseDocuments(payload) {
  const rows = Array.isArray(payload) ? payload : payload.documents ?? payload.records ?? [];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
    keywords: Array.isArray(row.keywords) ? row.keywords : (() => { try { return JSON.parse(row.keywordsJson ?? "[]"); } catch { return []; } })(),
    state: row.state ?? "active",
    risk: row.risk ?? "medium",
    handoff: Boolean(row.handoff),
    coverage: Number(row.coverage ?? 0),
    validFrom: row.validFrom ?? row.valid_from ?? null,
    validUntil: row.validUntil ?? row.valid_until ?? null,
    version: row.version ?? "unknown",
    sourceTitle: row.sourceTitle ?? row.source_title ?? null,
    sourceUrl: row.sourceUrl ?? row.source_url ?? null,
    organizationId: row.organizationId ?? row.organization_id ?? "org-qingyu",
  }));
}

function missingRequirements() {
  const missing = [];
  if (!indexPath) missing.push("SERVICEPILOT_EMBEDDING_INDEX");
  if (!knowledgePath) missing.push("SERVICEPILOT_KNOWLEDGE_SNAPSHOT");
  if (!embeddingApiKey) missing.push("EMBEDDING_API_KEY or LLM_API_KEY");
  if (!rerankApiKey) missing.push("RERANK_API_KEY or LLM_API_KEY");
  return missing;
}

async function embeddingVectors(queries) {
  const vectors = [];
  for (let start = 0; start < queries.length; start += 20) {
    const response = await fetch(`${embeddingBaseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${embeddingApiKey}` },
      body: JSON.stringify({ model, input: queries.slice(start, start + 20) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`EMBEDDING_HTTP_${response.status}:${payload?.error?.message ?? "unknown"}`);
    vectors.push(...(payload.data ?? []).sort((left, right) => (left.index ?? 0) - (right.index ?? 0)).map((row) => row.embedding));
  }
  if (vectors.length !== queries.length) throw new Error(`EMBEDDING_COUNT_MISMATCH:${vectors.length}/${queries.length}`);
  return vectors;
}

async function main() {
  const evaluation = JSON.parse(await fs.readFile(casesPath, "utf8"));
  const missing = missingRequirements();
  if (missing.length) {
    const report = {
      status: "not-run",
      testClass: "Real-model Retrieval Eval",
      dataset: evaluation.version,
      cases: evaluation.cases.length,
      reason: "尚未完成真实模型验证",
      missingRequirements: missing,
      metrics: null,
      dense: { status: "not-run" },
      reranker: { status: "not-run" },
      note: "Mock 仅用于单元/异常/fallback 测试；本结果不提供Recall/MRR/nDCG改善结论。需要同一知识库、同一索引版本、同一Embedding模型及真实qwen3-rerank API配置。",
    };
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const [index, knowledgePayload] = await Promise.all([
    fs.readFile(indexPath, "utf8").then(JSON.parse),
    fs.readFile(knowledgePath, "utf8").then(JSON.parse),
  ]);
  if (index.model !== model) throw new Error(`INDEX_MODEL_MISMATCH:${index.model}/${model}`);
  const documents = parseDocuments(knowledgePayload);
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const indexVersion = index.indexVersion ?? index.version ?? null;
  const indexRecords = index.records ?? [];
  if (!indexVersion || !indexRecords.length) throw new Error("INDEX_VERSION_OR_RECORDS_MISSING");
  if (indexRecords.some((record) => record.indexVersion && record.indexVersion !== indexVersion)) throw new Error("INDEX_RECORD_VERSION_MISMATCH");
  const indexedIds = new Set(indexRecords.map((record) => record.id));
  const missingDocuments = documents.filter((document) => !indexedIds.has(document.id)).map((document) => document.id);
  const orphanedIndexRecords = indexRecords.filter((record) => !documentById.has(record.id)).map((record) => record.id);
  const versionMismatches = indexRecords.filter((record) => documentById.has(record.id) && record.version && documentById.get(record.id).version !== record.version).map((record) => ({ id: record.id, knowledgeVersion: documentById.get(record.id).version, indexVersion: record.version }));
  if (versionMismatches.length) throw new Error(`KNOWLEDGE_INDEX_DOCUMENT_VERSION_MISMATCH:${versionMismatches.length}`);
  const queries = [];
  const routed = [];
  for (const item of evaluation.cases) {
    const routing = routeIntent(item.query, item.history ?? []);
    if (!routing) continue;
    routed.push({ item, routing });
    queries.push(item.query);
  }
  const queryVectors = await embeddingVectors(queries);
  const rerankLatencies = [];
  const records = [];
  for (let indexOfCase = 0; indexOfCase < routed.length; indexOfCase += 1) {
    const { item, routing } = routed[indexOfCase];
    const scope = buildRetrievalScope({ organizationId: "org-qingyu", intent: routing.intent, preferredKnowledgeIds: [routing.retrievalKnowledgeId] });
    const vectorByDocument = new Map(indexRecords.filter((row) => row.category === routing.intent && documentById.has(row.id)).map((row) => [row.id, cosine(queryVectors[indexOfCase], row.vector)]));
    const v1Candidates = applyActionAwareRerank(retrieveCandidates(documents, item.query, { category: routing.intent, defaultDocumentId: routing.retrievalKnowledgeId, vectorScores: vectorByDocument, vectorWeight: 0.5, coverageWeight: 1, limit: 5 }), item.query, routing.retrievalKnowledgeId);
    const bm25 = retrieveScopedBm25Candidates(documents, item.query, scope, { limit: retrievalConfig.bm25TopK });
    const dense = retrieveScopedDenseCandidates(documents, vectorByDocument, scope, retrievalConfig.denseTopK);
    const fused = reciprocalRankFusion([
      bm25.map((candidate, rank) => ({ id: candidate.document.id, rank: rank + 1, score: candidate.bm25Score, source: "bm25", payload: candidate })),
      dense.map((candidate, rank) => ({ id: candidate.document.id, rank: rank + 1, score: candidate.vectorScore, source: "dense", payload: candidate })),
    ], retrievalConfig.rrfK).slice(0, retrievalConfig.fusionTopK);
    const preRerank = fused.map((candidate) => {
      const document = documentById.get(candidate.id);
      const boost = businessRuleBoostForDocument({ documentId: candidate.id, query: item.query, preferredKnowledgeIds: scope.preferredKnowledgeIds, maxBoost: retrievalConfig.maxBusinessBoost });
      return { candidate, document, boost };
    }).filter((candidate) => candidate.document).sort((left, right) => right.candidate.rrfScore + right.boost.boost - left.candidate.rrfScore - left.boost.boost);
    const rerankStarted = performance.now();
    const reranked = await rerankCandidates({
      query: item.query,
      candidates: preRerank.map(({ candidate, document, boost }) => ({ id: `${document.id}#document`, knowledgeId: document.id, title: document.title, content: document.content, rrfScore: candidate.rrfScore, businessBoost: boost.boost, bm25Rank: candidate.bm25Rank, bm25Score: candidate.bm25Score, denseRank: candidate.denseRank, denseScore: candidate.denseScore })),
      topK: retrievalConfig.rerankTopK,
      config: { enabled: true, apiKey: rerankApiKey, baseUrl: rerankBaseUrl, model: process.env.RERANK_MODEL ?? "qwen3-rerank", timeoutMs: Number(process.env.RERANK_TIMEOUT_MS ?? 1500) },
    });
    const rerankLatency = performance.now() - rerankStarted;
    rerankLatencies.push(rerankLatency);
    records.push({
      id: item.id,
      query: item.query,
      intent: routing.intent,
      expected: item.expectedSource ?? null,
      v1: v1Candidates.map((candidate) => candidate.document.id),
      bm25: bm25.map((candidate) => candidate.document.id),
      dense: dense.map((candidate) => candidate.document.id),
      hybrid: preRerank.map(({ document }) => document.id),
      reranked: reranked.candidates.map((candidate) => candidate.knowledgeId),
      rerankFallback: reranked.fallback,
      rerankProvider: reranked.provider,
    });
  }
  const keywordOnlyWins = records.filter((record) => relevant(record.expected, record.bm25[0], record.query) && !relevant(record.expected, record.dense[0], record.query)).length;
  const denseOnlyWins = records.filter((record) => relevant(record.expected, record.dense[0], record.query) && !relevant(record.expected, record.bm25[0], record.query)).length;
  const bothHit = records.filter((record) => relevant(record.expected, record.bm25[0], record.query) && relevant(record.expected, record.dense[0], record.query)).length;
  const bothMiss = records.filter((record) => !relevant(record.expected, record.bm25[0], record.query) && !relevant(record.expected, record.dense[0], record.query)).length;
  const improvedCases = records.filter((record) => !relevant(record.expected, record.hybrid[0], record.query) && relevant(record.expected, record.reranked[0], record.query)).map((record) => record.id);
  const degradedCases = records.filter((record) => relevant(record.expected, record.hybrid[0], record.query) && !relevant(record.expected, record.reranked[0], record.query)).map((record) => record.id);
  const routedIds = new Set(records.map((record) => record.id));
  const unroutedCases = evaluation.cases.filter((item) => !routedIds.has(item.id));
  const categories = [...new Set(records.map((record) => record.intent))].sort();
  const metricsByCategory = Object.fromEntries(categories.map((category) => {
    const categoryRecords = records.filter((record) => record.intent === category);
    return [category, {
      v1: metrics(categoryRecords, "v1", 5),
      bm25Only: metrics(categoryRecords, "bm25", retrievalConfig.bm25TopK),
      denseOnly: metrics(categoryRecords, "dense", retrievalConfig.denseTopK),
      hybridBeforeRerank: metrics(categoryRecords, "hybrid", retrievalConfig.fusionTopK),
      hybridAfterRerank: metrics(categoryRecords, "reranked", retrievalConfig.rerankTopK),
    }];
  }));
  const report = {
    status: "completed",
    testClass: "Real-model Retrieval Eval",
    dataset: evaluation.version,
    knowledgeSource: {
      type: "live-d1-active-current-index-export",
      organizationId: documents[0]?.organizationId ?? null,
      documentCount: documents.length,
    },
    embeddingModel: model,
    indexVersion,
    indexModel: index.model,
    retrievalConfig,
    sameKnowledgeAndIndexValidated: missingDocuments.length === 0 && orphanedIndexRecords.length === 0 && versionMismatches.length === 0,
    missingIndexedDocuments: missingDocuments,
    orphanedIndexRecords,
    knowledgeIndexVersionMismatches: versionMismatches,
    routingCoverage: {
      datasetCases: evaluation.cases.length,
      routedCases: records.length,
      answerableDatasetCases: evaluation.cases.filter((item) => item.expectedSource).length,
      answerableRoutedCases: records.filter((record) => record.expected).length,
      noAnswerDatasetCases: evaluation.cases.filter((item) => !item.expectedSource).length,
      noAnswerCorrectlyUnrouted: unroutedCases.filter((item) => !item.expectedSource).length,
      answerableUnroutedCaseIds: unroutedCases.filter((item) => item.expectedSource).map((item) => item.id),
      routedNoAnswerCaseIds: records.filter((record) => !record.expected).map((record) => record.id),
    },
    reranker: { status: rerankedStatus(records), provider: records[0]?.rerankProvider ?? null, fallbackCases: records.filter((record) => record.rerankFallback).length, p50LatencyMs: percentile(rerankLatencies, 0.5), p95LatencyMs: percentile(rerankLatencies, 0.95), top1ImprovedCases: improvedCases, top1DegradedCases: degradedCases },
    metrics: {
      v1: metrics(records, "v1", 5),
      bm25Only: metrics(records, "bm25", retrievalConfig.bm25TopK),
      denseOnly: metrics(records, "dense", retrievalConfig.denseTopK),
      hybridBeforeRerank: metrics(records, "hybrid", retrievalConfig.fusionTopK),
      hybridAfterRerank: metrics(records, "reranked", retrievalConfig.rerankTopK),
    },
    metricsByCategory,
    denseIncrement: { keywordOnlyWins, denseOnlyWins, bothHit, bothMiss },
    records,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function rerankedStatus(records) {
  if (!records.length) return "not-run";
  return records.every((record) => record.rerankProvider === "qwen3-rerank" && !record.rerankFallback) ? "real-api" : "completed-with-fallback";
}

main().catch(async (error) => {
  const report = { status: "failed", testClass: "Real-model Retrieval Eval", reason: error instanceof Error ? error.message : String(error), metrics: null, note: "真实模型验证失败，不得将本次运行解释为效果改善。" };
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
});
