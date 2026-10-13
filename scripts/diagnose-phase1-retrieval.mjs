import fs from "node:fs/promises";
import { matchKnowledgeSource } from "../lib/knowledge-hierarchy.ts";
import { routeIntent } from "../lib/intent-router.ts";
import {
  businessRuleBoostForDocument,
  retrieveBm25Candidates,
  retrieveScopedBm25Candidates,
} from "../lib/retrieval.ts";
import { buildRetrievalScope, scopeAllowsKnowledge } from "../lib/retrieval-scope.ts";
import { reciprocalRankFusion } from "../lib/rrf.ts";

const casesPath = process.env.SERVICEPILOT_PHASE1_CASES ?? "data/eval-csds-holdout3-100.json";
const outputPath = process.env.SERVICEPILOT_PHASE1_DIAGNOSIS_OUTPUT ?? "Optimization_process/phase1.1-retrieval-diagnosis.json";
const defaultMaxBusinessBoost = Number(process.env.RETRIEVAL_V2_MAX_BUSINESS_BOOST ?? 0.0005);

const genericSignals = {
  refund: new Set(["退款", "退货", "七天", "七日", "无理由"]),
  damage: new Set(["破损", "坏了", "质量问题"]),
  address: new Set(["地址", "物流", "收货地址"]),
  invoice: new Set(["发票", "电子发票", "数电发票"]),
};

function normalizeLegacy(value) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function legacyKeywordCandidates(documents, query, intent, defaultDocumentId) {
  const normalized = normalizeLegacy(query);
  return documents
    .filter((document) => document.state === "active" && document.category === intent)
    .map((document) => {
      const matchedKeywords = document.keywords.filter((keyword) => normalized.includes(normalizeLegacy(keyword)));
      const score = matchedKeywords.reduce((total, keyword) => total + (genericSignals[intent]?.has(keyword) ? 1 : 8 + Math.min(keyword.length, 4)), 0)
        + (document.id === defaultDocumentId ? 2 : 0);
      return { document, score, matchedKeywords };
    })
    .sort((left, right) => right.score - left.score
      || Number(right.document.id === defaultDocumentId) - Number(left.document.id === defaultDocumentId))
    .slice(0, 5);
}

function relevant(expected, candidate, query) {
  return matchKnowledgeSource(expected ?? null, candidate ?? null, query).passed;
}

function listRelevant(expected, list, query) {
  return list.some((candidate) => relevant(expected, typeof candidate === "string" ? candidate : candidate?.id ?? null, query));
}

function rankOf(expected, list, query) {
  const index = list.findIndex((candidate) => relevant(expected, typeof candidate === "string" ? candidate : candidate?.id ?? null, query));
  return index < 0 ? null : index + 1;
}

function metric(records, field, rankLimit = 10) {
  const at = (record, rank) => listRelevant(record.expected, record[field].slice(0, rank), record.query);
  const usable = records.length || 1;
  const mrr = records.reduce((sum, record) => {
    const rank = rankOf(record.expected, record[field], record.query);
    return sum + (rank ? 1 / rank : 0);
  }, 0) / usable;
  const ndcg5 = records.reduce((sum, record) => {
    const rank = rankOf(record.expected, record[field].slice(0, 5), record.query);
    return sum + (rank ? 1 / Math.log2(rank + 1) : 0);
  }, 0) / usable;
  return {
    cases: records.length,
    recallAt1: records.filter((record) => at(record, 1)).length / usable,
    recallAt3: records.filter((record) => at(record, 3)).length / usable,
    recallAt5: records.filter((record) => at(record, 5)).length / usable,
    recallAt10: rankLimit >= 10 ? records.filter((record) => at(record, 10)).length / usable : null,
    mrr,
    ndcgAt5: ndcg5,
  };
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function rankMap(list) {
  return new Map(list.map((candidate, index) => [typeof candidate === "string" ? candidate : candidate.id, index + 1]));
}

function formatCandidate(candidate, rank, extra = {}) {
  return {
    rank,
    id: candidate.document?.id ?? candidate.id,
    score: candidate.score ?? null,
    bm25Score: candidate.bm25Score ?? null,
    rrfScore: candidate.rrfScore ?? null,
    businessBoost: extra.businessBoost ?? null,
    boostedScore: extra.boostedScore ?? null,
    matchedKeywords: candidate.matchedKeywords ?? [],
    matchedTerms: candidate.matchedTerms ?? [],
    title: candidate.document?.title ?? extra.title ?? null,
  };
}

function buildBoosted(fused, documentsById, query, scope, maxBoost) {
  return fused.map((candidate) => {
    const document = documentsById.get(candidate.id);
    const boost = businessRuleBoostForDocument({
      documentId: candidate.id,
      query,
      preferredKnowledgeIds: scope.preferredKnowledgeIds,
      maxBoost,
    });
    return { ...candidate, document, boost, boostedScore: candidate.rrfScore + boost.boost };
  }).filter((candidate) => candidate.document)
    .sort((left, right) => right.boostedScore - left.boostedScore || right.rrfScore - left.rrfScore || left.id.localeCompare(right.id));
}

function buildAblationRecords(records, maxBoost) {
  const fields = { v1: "v1Top5", bm25Raw: "v2Bm25Top30", rrf: "v2FusedTop25", boosted: "v2BoostedTop25" };
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, metric(records, field, field === "v1Top5" ? 5 : 30)]));
}

function rootCause(record) {
  const expected = record.expected;
  if (!expected) return { category: "F", reason: "没有单一 expectedKnowledgeId" };
  if (!record.scopeIds.includes(expected)) return { category: "A", reason: "expected knowledge 不在 RetrievalScope" };
  if (!record.v2Bm25Ids.includes(expected)) {
    if (!record.v2Bm25Ids.length) return { category: "F", reason: "V2没有正BM25证据；V1命中依赖旧默认知识回退，属于Golden Set/评测语义差异而非候选从BM25排名中丢失" };
    return { category: "B", reason: "Scope 内但未进入 BM25 Top30" };
  }
  if (!record.v2FusedIds.includes(expected)) return { category: "C", reason: "已进入 BM25，但未进入 Fusion Top25" };
  if (!record.v2BoostedIds.includes(expected)) return { category: "D", reason: "Boost 后被挤出 Top25" };
  if (!record.v2FinalIds.includes(expected)) return { category: "E", reason: "Boosted Top25 中但最终 Top5 未保留" };
  return { category: "G", reason: "候选中存在但按层级相关性判定仍未通过，需人工/标签复核" };
}

function describeMetadata(document) {
  return {
    organizationId: document.organizationId ?? null,
    category: document.category,
    state: document.state,
    validFrom: document.validFrom ?? null,
    validUntil: document.validUntil ?? null,
    version: document.version ?? null,
    metadataPresentInLocalSeed: ["organizationId", "validFrom", "validUntil"].filter((key) => document[key] !== undefined).length,
  };
}

function ablationForBoost(records, maxBoost) {
  return records.map((record) => {
    const boosted = buildBoosted(record.v2FusedObjects, record.documentsById, record.query, record.retrievalScope, maxBoost).map((candidate) => candidate.id);
    return { ...record, sweepBoosted: boosted };
  });
}

async function main() {
  const [knowledge, evaluation] = await Promise.all([
    fs.readFile("data/knowledge-seed.json", "utf8").then(JSON.parse),
    fs.readFile(casesPath, "utf8").then(JSON.parse),
  ]);
  const documents = knowledge.documents.map((document) => ({ ...document, organizationId: "org-qingyu" }));
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const records = [];
  for (const item of evaluation.cases) {
    const routing = routeIntent(item.query, item.history ?? []);
    if (!routing) continue;
    const scope = buildRetrievalScope({ organizationId: "org-qingyu", intent: routing.intent, preferredKnowledgeIds: [routing.retrievalKnowledgeId] });
    const v1Keyword = legacyKeywordCandidates(documents, item.query, routing.intent, routing.retrievalKnowledgeId);
    const v1Top5 = retrieveBm25Candidates(documents, item.query, { category: routing.intent, defaultDocumentId: routing.retrievalKnowledgeId, limit: 5 }).map((candidate) => candidate.document.id);
    const bm25 = retrieveScopedBm25Candidates(documents, item.query, scope, { limit: 30 });
    const fusedObjects = reciprocalRankFusion([
      bm25.map((candidate, index) => ({ id: candidate.document.id, rank: index + 1, score: candidate.bm25Score, source: "bm25", payload: candidate })),
    ], 60);
    const boostedObjects = buildBoosted(fusedObjects, documentsById, item.query, scope, defaultMaxBusinessBoost);
    const v2Bm25Top30 = bm25.map((candidate) => candidate.document.id);
    const v2FusedTop25 = fusedObjects.slice(0, 25).map((candidate) => candidate.id);
    const v2BoostedTop25 = boostedObjects.slice(0, 25).map((candidate) => candidate.id);
    const v2FinalTop5 = v2BoostedTop25.slice(0, 5);
    const expected = item.expectedSource ?? null;
    const v1Hit = listRelevant(expected, v1Top5, item.query);
    const v2Hit = listRelevant(expected, v2FinalTop5, item.query);
    const miss = !v2Hit && v1Hit;
    const scopeIds = documents.filter((document) => scopeAllowsKnowledge(scope, document)).map((document) => document.id);
    const fusedWithDetails = fusedObjects.slice(0, 25).map((candidate, index) => ({ ...candidate, id: candidate.id, document: documentsById.get(candidate.id) }));
    const boostedWithDetails = boostedObjects.slice(0, 25);
    const root = miss ? rootCause({ expected, scopeIds, v2Bm25Ids: v2Bm25Top30, v2FusedIds: v2FusedTop25, v2BoostedIds: v2BoostedTop25, v2FinalIds: v2FinalTop5 }) : null;
    records.push({
      id: item.id,
      query: item.query,
      intent: routing.intent,
      category: item.category,
      expected,
      relevantKnowledgeIds: expected ? [expected] : [],
      history: item.history ?? [],
      v1KeywordTop5: v1Keyword.map((candidate, index) => formatCandidate(candidate, index + 1)),
      v1Top5,
      v1ReportedHit: v1Hit,
      v2Bm25Top30: bm25.map((candidate, index) => formatCandidate(candidate, index + 1)),
      v2Bm25Top30Ids: v2Bm25Top30,
      v2FusedTop25: fusedWithDetails.map((candidate, index) => formatCandidate(candidate.payloads.find((payload) => payload?.document?.id === candidate.id) ?? candidate, index + 1)),
      v2FusedTop25Ids: v2FusedTop25,
      v2BoostedTop25: boostedWithDetails.map((candidate, index) => formatCandidate(candidate, index + 1, { businessBoost: candidate.boost.boost, boostedScore: candidate.boostedScore })),
      v2BoostedTop25Ids: v2BoostedTop25,
      finalTop5: v2FinalTop5,
      v2Hit,
      miss,
      scope: {
        primaryCategory: scope.primaryCategory,
        allowedCategories: scope.allowedCategories,
        ids: scopeIds,
        expectedInScope: expected ? scopeIds.includes(expected) : false,
        expectedMetadata: expected ? describeMetadata(documentsById.get(expected)) : null,
        metadataFilters: scope.metadataFilters,
      },
      rootCause: root,
      fusedRrfScores: fusedObjects.slice(0, 25).map((candidate, index) => ({ id: candidate.id, rank: index + 1, rrfScore: candidate.rrfScore, bm25Rank: candidate.bm25Rank, bm25Score: candidate.bm25Score })),
      boostDetails: boostedObjects.slice(0, 25).map((candidate, index) => ({ id: candidate.id, rank: index + 1, beforeRank: fusedObjects.findIndex((item2) => item2.id === candidate.id) + 1, rrfScore: candidate.rrfScore, boost: candidate.boost.boost, reason: candidate.boost.reason, boostedScore: candidate.boostedScore })),
      v2Bm25Objects: bm25,
      v2FusedObjects: fusedObjects,
      documentsById,
      retrievalScope: scope,
    });
  }

  const misses = records.filter((record) => record.miss);
  const rootCounts = Object.fromEntries(["A", "B", "C", "D", "E", "F", "G"].map((category) => [category, misses.filter((record) => record.rootCause?.category === category).length]));
  const rootDistribution = Object.fromEntries(Object.entries(rootCounts).map(([category, count]) => [category, { count, share: misses.length ? count / misses.length : 0 }]));
  const allRrf = records.flatMap((record) => record.v2FusedObjects.slice(0, 25).map((candidate) => candidate.rrfScore));
  const allBoosts = records.flatMap((record) => record.boostDetails.map((candidate) => candidate.boost));

  const sweeps = [0, 0.0001, 0.0005, 0.001, 0.002, 0.005, 0.01].map((maxBoost) => {
    const swept = records.map((record) => ({ ...record, v2BoostedTop25: buildBoosted(record.v2FusedObjects, record.documentsById, record.query, record.retrievalScope, maxBoost).map((candidate) => candidate.id) }));
    const metricRecords = swept.map((record) => ({ ...record, v2BoostedTop25: record.v2BoostedTop25 }));
    const changes = records.reduce((count, record, index) => count + (record.v2FusedObjects.slice(0, 25).map((candidate) => candidate.id).join(",") === swept[index].v2BoostedTop25.join(",") ? 0 : 1), 0);
    const top5Changes = records.reduce((count, record, index) => count + (record.v2FusedObjects.slice(0, 5).map((candidate) => candidate.id).join(",") === swept[index].v2BoostedTop25.slice(0, 5).join(",") ? 0 : 1), 0);
    return { maxBoost, metrics: metric(metricRecords.map((record) => ({ ...record, v2BoostedTop25: record.v2BoostedTop25 })), "v2BoostedTop25", 25), changedTop25Cases: changes, changedTop5Cases: top5Changes };
  });

  const significantBoostChanges = records.flatMap((record) => {
    return record.boostDetails.map((detail) => ({
      queryId: record.id,
      query: record.query,
      expected: record.expected,
      id: detail.id,
      beforeRank: detail.beforeRank,
      afterRank: detail.rank,
      delta: detail.beforeRank - detail.rank,
      boost: detail.boost,
      reason: detail.reason,
    // On a single-list RRF, the score gap between adjacent ranks is ~0.00025.
    // A one-position displacement is therefore already material at maxBoost=0.01;
    // retain these real cases instead of hiding the effect behind an arbitrary
    // two-position threshold.
    })).filter((item) => Math.abs(item.delta) >= 1);
  }).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta)).slice(0, 20);

  const manualSample = ["refund", "damage", "address", "invoice"].flatMap((intent) => records.filter((record) => record.intent === intent).slice(0, 8)).slice(0, 32);
  const potentialLabelFalseNegatives = misses.filter((record) => {
    const expectedPrefix = record.expected?.slice(0, 4);
    const hasSameFamilyCandidate = record.v2Bm25Top30.some((candidate) => candidate.id?.startsWith(expectedPrefix ?? "__"));
    const hasExplicitEvidence = /快递|外包装|商品|破损|质量|损坏|压烂|故障|维修|保修|三包/.test(record.query);
    return hasSameFamilyCandidate && hasExplicitEvidence;
  }).map((record) => ({
    id: record.id,
    query: record.query,
    expected: record.expected,
    returnedCandidates: record.v2Bm25Top30.slice(0, 5).map((candidate) => ({ id: candidate.id, title: candidate.title, matchedTerms: candidate.matchedTerms })),
    assessment: "possible_label_false_negative",
    note: "同一知识族存在可回答候选，但当前single expectedSource标签未表达父/子/补充证据等多相关性；需要业务人工确认，不修改冻结集。",
  }));

  const report = {
    version: "phase1.1-retrieval-regression-diagnosis-v1",
    testClasses: {
      mockTest: "tests/phase1-retrieval.test.mjs and related deterministic unit tests; no effect conclusion",
      integrationTest: "same local knowledge seed + same frozen set through V1/V2 retrieval functions; no external Dense/Reranker",
      realModelRetrievalEval: "not-run; see phase1.1-real-retrieval-eval.json",
    },
    dataset: evaluation.version,
    casesInFile: evaluation.cases.length,
    routedCases: records.length,
    frozenRelevantLabel: "single expectedSource/expectedKnowledgeId; hierarchy matcher allows certain query-supported child sources",
    environment: {
      knowledgeSource: "data/knowledge-seed.json",
      organizationIdUsedForLocalDiagnosis: "org-qingyu",
      realD1Metadata: "not-available-in-local-process",
      dense: "not-run",
      reranker: "not-run",
    },
    metricDefinitions: {
      relevance: "lib/knowledge-hierarchy.matchKnowledgeSource",
      v1Top5: "existing Phase 1 baseline口径: retrieveBm25Candidates(category=intent, limit=5)",
      v1KeywordTop5: "production route legacy keyword scorer, reported separately",
      v2Bm25Raw: "RetrievalScope + retrieveScopedBm25Candidates Top30",
      v2Rrf: "BM25-only rank-level RRF(k=60), Top25",
      v2Boosted: `RRF + businessRuleBoostForDocument(maxBoost=${defaultMaxBusinessBoost}), Top25`,
    },
    metrics: {
      ablation: buildAblationRecords(records, defaultMaxBusinessBoost),
      v1Keyword: metric(records.map((record) => ({ ...record, v1Top5: record.v1KeywordTop5.map((candidate) => candidate.id) })), "v1Top5", 5),
    },
    v1HitV2Miss: {
      count: misses.length,
      shareOfRouted: misses.length / records.length,
      records: misses.map((record) => ({
        id: record.id,
        query: record.query,
        intent: record.intent,
        expected: record.expected,
        relevantKnowledgeIds: record.relevantKnowledgeIds,
        v1Top5: record.v1Top5,
        v2Bm25Top30: record.v2Bm25Top30,
        v2FusedTop25: record.v2FusedTop25,
        v2BoostedTop25: record.v2BoostedTop25,
        finalTop5: record.finalTop5,
        scope: record.scope,
        rootCause: record.rootCause,
      })),
      rootCauseCounts: rootCounts,
      rootCauseDistribution: rootDistribution,
    },
    retrievalScope: {
      scopeExcludedRelevantCount: misses.filter((record) => !record.scope?.expectedInScope).length,
      excludedCases: misses.filter((record) => !record.scope?.expectedInScope).map((record) => ({ id: record.id, query: record.query, expected: record.expected, scope: record.scope })),
      localMetadataAudit: {
        note: "Local seed has category/state/version/coverage but no organizationId/validFrom/validUntil columns. All local documents were assigned org-qingyu for code-path diagnosis; this is not a substitute for a real D1 metadata audit.",
        documents: documents.map(describeMetadata),
      },
    },
    bm25Comparison: {
      v1ProductionKeyword: {
        searchableFields: ["keywords"],
        title: false, content: false, aliases: false, generatedQuestions: false, category: "SQL category=intent filter", businessAction: "not in keyword scorer; action handling is separate in experiment paths",
        tokenizer: "lowercase + remove whitespace; substring keyword match",
        normalization: "does not remove punctuation or NFKC normalize",
        stemming: false, stopWords: false, exactMatch: "keyword substring", phraseMatch: false, fuzzy: false,
        weighting: "generic intent terms weight 1; other keyword 8+min(length,4); default document +2",
      },
      v1ReportedBaseline: {
        searchableFields: ["title", "content", "keywords", "keyword pseudo-terms"],
        title: true, content: true, aliases: "keywords only", generatedQuestions: false, category: "SQL category=intent filter", businessAction: "separate from BM25",
        tokenizer: "Chinese 2/3-character grams; Latin/digit runs",
        normalization: "NFKC + lowercase + remove bracket placeholders",
        stemming: false, stopWords: false, exactMatch: "term match and keyword pseudo-term", phraseMatch: false, fuzzy: false,
        weighting: "BM25 k1=1.2, b=0.75; no legacy generic/default score in bm25 raw",
      },
      v2Bm25: {
        searchableFields: ["title", "content", "keywords", "keyword pseudo-terms"],
        title: true, content: true, aliases: "keywords only", generatedQuestions: false, category: "RetrievalScope category mapping", businessAction: "separate bounded Boost after RRF",
        tokenizer: "Chinese 2/3-character grams; Latin/digit runs",
        normalization: "NFKC + lowercase + remove bracket placeholders",
        stemming: false, stopWords: false, exactMatch: "term match and keyword pseudo-term", phraseMatch: false, fuzzy: false,
        weighting: "BM25 k1=1.2, b=0.75; only positive BM25 candidates survive Scope retrieval",
      },
      lostSignals: ["legacy keyword scorer's generic intent-term weight", "legacy defaultKnowledgeId +2 prior", "legacy raw keyword-only ordering"],
      gainedSignals: ["title/content terms", "2/3-gram Chinese matching", "BM25 IDF and length normalization", "NFKC and placeholder normalization"],
    },
    boost: {
      rrfScoreDistribution: { count: allRrf.length, min: Math.min(...allRrf), p10: percentile(allRrf, 0.1), p50: percentile(allRrf, 0.5), p90: percentile(allRrf, 0.9), max: Math.max(...allRrf) },
      businessBoostDistribution: { count: allBoosts.length, min: Math.min(...allBoosts), p10: percentile(allBoosts, 0.1), p50: percentile(allBoosts, 0.5), p90: percentile(allBoosts, 0.9), max: Math.max(...allBoosts) },
      maxBusinessBoost: defaultMaxBusinessBoost,
      significantRankChanges: significantBoostChanges,
      sweep: sweeps,
      interpretation: "RRF单路相邻名次差距约0.00025；本报告将至少一位名次位移定义为显著变化。按实际冻结集分布判断；不得仅凭经验改值。",
    },
    goldenSet: {
      labelForm: "single expectedSource/expectedKnowledgeId per case",
      chunkLevel: false,
      multipleRelevantIds: false,
      hierarchyAcceptedByScorer: true,
      manualReviewMethod: "按四类各取最多8条、共32条；由当前知识族关系和查询显式证据做人工式初筛，潜在项仍需业务复核",
      sampledForManualReview: manualSample.map((record) => ({
        id: record.id,
        intent: record.intent,
        query: record.query,
        expected: record.expected,
        v1Top5: record.v1Top5,
        v2FinalTop5: record.finalTop5,
        assessment: potentialLabelFalseNegatives.some((item) => item.id === record.id)
          ? "possible_label_false_negative"
          : record.miss && !record.v2Bm25Top30.length
            ? "no_direct_bm25_evidence_legacy_default_fallback"
            : "no_obvious_label_false_negative",
      })),
      labelFalseNegative: potentialLabelFalseNegatives,
      recommendation: "保留当前冻结集不变；新增评测集采用relevantKnowledgeIds数组，并区分primary、acceptable-child、supplemental evidence，另保留chunkId级可选标注。",
    },
    records: records.map((record) => {
      const { v2Bm25Objects, v2FusedObjects, documentsById: _documentsById, retrievalScope: _retrievalScope, ...safeRecord } = record;
      return safeRecord;
    }),
  };
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath, routedCases: records.length, misses: misses.length, rootCauseCounts: rootCounts, ablation: report.metrics.ablation, scopeExcludedRelevantCount: report.retrievalScope.scopeExcludedRelevantCount, sweep: report.boost.sweep }, null, 2)}\n`);
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
