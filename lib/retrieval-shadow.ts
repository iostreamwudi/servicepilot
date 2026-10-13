import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { embeddingIndexVersions, knowledgeDocuments, knowledgeEmbeddings, retrievalShadowRuns } from "../db/schema";
import { cosineSimilarity, createEmbeddings, normalizeEmbedding } from "./embedding";
import { applyActionAwareRerank, businessRuleBoostForDocument, parentIdForDocument, retrieveCandidates, retrieveScopedBm25Candidates, retrieveScopedDenseCandidates, type RetrievalDocument } from "./retrieval";
import { reciprocalRankFusion } from "./rrf";
import { rerankCandidates, type RerankerConfig } from "./reranker";
import { scopeAllowsKnowledge, type RetrievalScope } from "./retrieval-scope";

export type RetrievalShadowConfig = {
  enabled?: string;
  apiKey?: string;
  baseUrl?: string;
  embeddingModel?: string;
  rerankerEnabled?: string;
  rerankerApiKey?: string;
  rerankerBaseUrl?: string;
  rerankerModel?: string;
  rerankerTimeoutMs?: number;
  /** Opt-in only: use the remote semantic reranker in an isolated experiment. */
  rerankerMode?: "local" | "qwen3-rerank";
};
export type RetrievalShadowInput = { traceId: string; organizationId: string; query: string; intent: string; defaultDocumentId: string; currentSourceId: string | null; config: RetrievalShadowConfig };

export type RetrievalV2Candidate = {
  id: string;
  knowledgeId: string;
  chunkId: string;
  parentId: string | null;
  version: string;
  title: string;
  bm25Rank: number | null;
  bm25Score: number | null;
  denseRank: number | null;
  denseScore: number | null;
  rrfScore: number;
  businessBoost: number;
  businessBoostReason: string | null;
  rerankScore: number;
  rerankRank: number;
};

export type RetrievalV2Result = {
  status: "completed" | "safe-fallback";
  candidateSourceId: string | null;
  selectedEvidence: RetrievalV2Candidate[];
  candidates: RetrievalV2Candidate[];
  retrievalScope: RetrievalScope;
  indexVersion: string | null;
  embeddingAvailable: boolean;
  rerankFallback: boolean;
  rerankProvider: string;
  fallbackReason: string | null;
  latency: { bm25Ms: number; embeddingMs: number; denseMs: number; fusionMs: number; rerankMs: number; totalRetrievalMs: number };
};

function parseKeywords(value: string) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }

export const RETRIEVAL_V2_DEFAULTS = { bm25TopK: 30, denseTopK: 30, fusionTopK: 25, rerankTopK: 8, rrfK: 60, maxBusinessBoost: 0.0005 } as const;

/** Phase 1 V2: scope → wider BM25/dense recall → RRF → bounded business boost → rerank. */
export async function runRetrievalV2(input: RetrievalShadowInput & {
  scope: RetrievalScope;
  skipRerank?: boolean;
  limits?: Partial<Record<keyof typeof RETRIEVAL_V2_DEFAULTS, number>>;
}) : Promise<RetrievalV2Result> {
  const started = Date.now();
  const limits = { ...RETRIEVAL_V2_DEFAULTS, ...(input.limits ?? {}) };
  const emptyLatency = { bm25Ms: 0, embeddingMs: 0, denseMs: 0, fusionMs: 0, rerankMs: 0, totalRetrievalMs: 0 };
  try {
    const db = getDb();
    const model = input.config.embeddingModel ?? "qwen3.7-text-embedding";
    const [currentIndex, documentRows] = await Promise.all([
      db.select().from(embeddingIndexVersions).where(and(eq(embeddingIndexVersions.organizationId, input.organizationId), eq(embeddingIndexVersions.model, model))).limit(1),
      // Tenant/state are applied in SQL before any candidate generator. Scope
      // category, version and validity checks run before BM25/Dense scoring.
      db.select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, input.organizationId), eq(knowledgeDocuments.state, "active"))),
    ]);
    const indexVersion = currentIndex[0]?.currentIndexVersion ?? null;
    const documents: RetrievalDocument[] = documentRows
      .filter((row) => scopeAllowsKnowledge(input.scope, row))
      .map((row) => ({ id: row.id, title: row.title, content: row.content, category: row.category, keywords: parseKeywords(row.keywordsJson), state: row.state, risk: row.risk, handoff: row.handoff, coverage: row.coverage, validFrom: row.validFrom, validUntil: row.validUntil, version: row.version, sourceTitle: row.sourceTitle, sourceUrl: row.sourceUrl, organizationId: row.organizationId }));
    if (!documents.length) return { status: "safe-fallback", candidateSourceId: null, selectedEvidence: [], candidates: [], retrievalScope: input.scope, indexVersion, embeddingAvailable: false, rerankFallback: true, rerankProvider: "rrf-fallback", fallbackReason: "EMPTY_RETRIEVAL_SCOPE", latency: { ...emptyLatency, totalRetrievalMs: Date.now() - started } };

    const bm25Started = Date.now();
    const bm25 = retrieveScopedBm25Candidates(documents, input.query, input.scope, { limit: limits.bm25TopK });
    const bm25Ms = Date.now() - bm25Started;

    let embeddingAvailable = false;
    let embeddingMs = 0;
    let denseMs = 0;
    let dense: ReturnType<typeof retrieveScopedDenseCandidates> = [];
    if (input.config.apiKey && input.config.baseUrl && indexVersion) {
      const embeddingStarted = Date.now();
      try {
        const [embeddingRows, queryVector] = await Promise.all([
          db.select().from(knowledgeEmbeddings).where(and(eq(knowledgeEmbeddings.organizationId, input.organizationId), eq(knowledgeEmbeddings.model, model), eq(knowledgeEmbeddings.indexVersion, indexVersion))),
          createEmbeddings([input.query], { apiKey: input.config.apiKey, baseUrl: input.config.baseUrl, model, timeoutMs: 5_000 }),
        ]);
        embeddingMs = Date.now() - embeddingStarted;
        const vectorByDocument = new Map<string, number>();
        for (const row of embeddingRows) {
          const vector = normalizeEmbedding(JSON.parse(row.vectorJson));
          if (vector?.length === queryVector[0].length) vectorByDocument.set(row.documentId, cosineSimilarity(queryVector[0], vector));
        }
        const denseStarted = Date.now();
        dense = retrieveScopedDenseCandidates(documents, vectorByDocument, input.scope, limits.denseTopK);
        denseMs = Date.now() - denseStarted;
        embeddingAvailable = dense.length > 0;
      } catch {
        embeddingMs = Date.now() - embeddingStarted;
        embeddingAvailable = false;
      }
    }

    const fusionStarted = Date.now();
    const fused = reciprocalRankFusion([
      bm25.map((candidate, index) => ({ id: candidate.document.id, rank: index + 1, score: candidate.bm25Score, source: "bm25" as const, payload: candidate })),
      dense.map((candidate, index) => ({ id: candidate.document.id, rank: index + 1, score: candidate.vectorScore, source: "dense" as const, payload: candidate })),
    ], limits.rrfK).slice(0, limits.fusionTopK);
    const documentById = new Map(documents.map((document) => [document.id, document]));
    const preRerank = fused.flatMap((candidate) => {
      const document = documentById.get(candidate.id);
      if (!document) return [];
      const boost = businessRuleBoostForDocument({ documentId: document.id, query: input.query, preferredKnowledgeIds: input.scope.preferredKnowledgeIds, maxBoost: limits.maxBusinessBoost });
      return [{ candidate, document, boost }];
    }).sort((left, right) => right.candidate.rrfScore + right.boost.boost - (left.candidate.rrfScore + left.boost.boost));
    const fusionMs = Date.now() - fusionStarted;
    if (!preRerank.length || (!bm25.some((candidate) => candidate.bm25Score > 0) && !dense.some((candidate) => candidate.vectorScore >= 0.55))) {
      return { status: "safe-fallback", candidateSourceId: null, selectedEvidence: [], candidates: [], retrievalScope: input.scope, indexVersion, embeddingAvailable, rerankFallback: true, rerankProvider: "rrf-fallback", fallbackReason: embeddingAvailable ? "NO_TRUSTWORTHY_RETRIEVAL" : "BM25_EMPTY_AND_DENSE_UNAVAILABLE", latency: { bm25Ms, embeddingMs, denseMs, fusionMs, rerankMs: 0, totalRetrievalMs: Date.now() - started } };
    }

    const rerankInput = preRerank.map(({ candidate, document, boost }) => ({
      id: `${document.id}#document`, knowledgeId: document.id, title: document.title, sectionTitle: null, content: document.content,
      metadata: { category: document.category, version: document.version, coverage: document.coverage },
      rrfScore: candidate.rrfScore, businessBoost: boost.boost, bm25Rank: candidate.bm25Rank, bm25Score: candidate.bm25Score,
      denseRank: candidate.denseRank, denseScore: candidate.denseScore, parentId: parentIdForDocument(document.id),
    }));
    const rerankStarted = Date.now();
    const reranked = input.skipRerank
      ? { candidates: rerankInput.slice(0, limits.rerankTopK).map((candidate, index) => ({ ...candidate, rerankScore: candidate.rrfScore + candidate.businessBoost, rerankRank: index + 1 })), provider: "rrf-fallback" as const, fallback: false, latencyMs: 0 }
      : await rerankCandidates({ query: input.query, candidates: rerankInput, topK: limits.rerankTopK, config: {
        enabled: input.config.rerankerEnabled === "true",
        apiKey: input.config.rerankerApiKey ?? input.config.apiKey,
        baseUrl: input.config.rerankerBaseUrl ?? input.config.baseUrl,
        model: input.config.rerankerModel ?? "qwen3-rerank",
        timeoutMs: input.config.rerankerTimeoutMs ?? 1_500,
      } satisfies RerankerConfig });
    const rerankMs = Date.now() - rerankStarted;
    const finalCandidates: RetrievalV2Candidate[] = reranked.candidates.map((candidate) => {
      const document = documentById.get(candidate.knowledgeId)!;
      return { id: candidate.id, knowledgeId: document.id, chunkId: candidate.id, parentId: candidate.parentId ?? null, version: document.version ?? "unknown", title: document.title, bm25Rank: candidate.bm25Rank, bm25Score: candidate.bm25Score, denseRank: candidate.denseRank, denseScore: candidate.denseScore, rrfScore: Number(candidate.rrfScore.toFixed(8)), businessBoost: Number(candidate.businessBoost.toFixed(4)), businessBoostReason: preRerank.find((item) => item.document.id === document.id)?.boost.reason ?? null, rerankScore: Number(candidate.rerankScore.toFixed(6)), rerankRank: candidate.rerankRank };
    });
    return { status: "completed", candidateSourceId: finalCandidates[0]?.knowledgeId ?? null, selectedEvidence: finalCandidates, candidates: finalCandidates, retrievalScope: input.scope, indexVersion, embeddingAvailable, rerankFallback: reranked.fallback, rerankProvider: reranked.provider, fallbackReason: "failureCode" in reranked ? reranked.failureCode ?? null : null, latency: { bm25Ms, embeddingMs, denseMs, fusionMs, rerankMs, totalRetrievalMs: Date.now() - started } };
  } catch (error) {
    return { status: "safe-fallback", candidateSourceId: null, selectedEvidence: [], candidates: [], retrievalScope: input.scope, indexVersion: null, embeddingAvailable: false, rerankFallback: true, rerankProvider: "rrf-fallback", fallbackReason: error instanceof Error ? error.message.slice(0, 120) : "RETRIEVAL_V2_FAILURE", latency: { ...emptyLatency, totalRetrievalMs: Date.now() - started } };
  }
}

export async function runRetrievalShadow(input: RetrievalShadowInput) {
  const started = Date.now();
  if (input.config.enabled !== "true") return null;
  const model = input.config.embeddingModel ?? "qwen3.7-text-embedding";
  try {
    const db = getDb();
    if (!input.config.apiKey || !input.config.baseUrl) throw new Error("SHADOW_EMBEDDING_CONFIG_MISSING");
    const [currentIndex] = await db.select().from(embeddingIndexVersions).where(and(eq(embeddingIndexVersions.organizationId, input.organizationId), eq(embeddingIndexVersions.model, model))).limit(1);
    if (!currentIndex) throw new Error("SHADOW_INDEX_VERSION_MISSING");
    const [embeddingRows, documentRows] = await Promise.all([
      db.select().from(knowledgeEmbeddings).where(and(eq(knowledgeEmbeddings.organizationId, input.organizationId), eq(knowledgeEmbeddings.model, model), eq(knowledgeEmbeddings.indexVersion, currentIndex.currentIndexVersion))),
      db.select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, input.organizationId), eq(knowledgeDocuments.category, input.intent as "refund" | "damage" | "address" | "invoice"), eq(knowledgeDocuments.state, "active"))),
    ]);
    if (!embeddingRows.length) throw new Error("SHADOW_INDEX_EMPTY");
    const queryVector = (await createEmbeddings([input.query], { apiKey: input.config.apiKey, baseUrl: input.config.baseUrl, model, timeoutMs: 5_000 }))[0];
    const vectorByDocument = new Map<string, number>();
    for (const row of embeddingRows) {
      const vector = normalizeEmbedding(JSON.parse(row.vectorJson));
      if (vector?.length === queryVector.length) vectorByDocument.set(row.documentId, cosineSimilarity(queryVector, vector));
    }
    const documents: RetrievalDocument[] = documentRows.map((row) => ({ id: row.id, title: row.title, content: row.content, category: row.category, keywords: parseKeywords(row.keywordsJson), state: row.state, risk: row.risk, handoff: row.handoff, coverage: row.coverage, validFrom: row.validFrom, validUntil: row.validUntil, version: row.version, sourceTitle: row.sourceTitle, sourceUrl: row.sourceUrl }));
    const candidates = retrieveCandidates(documents, input.query, { category: input.intent, defaultDocumentId: input.defaultDocumentId, vectorScores: vectorByDocument, vectorWeight: 0.5, coverageWeight: 1, limit: 5 });
    const locallyRanked = applyActionAwareRerank(candidates, input.query, input.defaultDocumentId);
    let rerankProvider = "local-action-aware";
    let rerankFallback = false;
    let rerankFailureCode: string | null = null;
    let rerankLatencyMs = 0;
    let reranked = locallyRanked;
    if (input.config.rerankerMode === "qwen3-rerank" && locallyRanked.length) {
      const rerankResult = await rerankCandidates({
        query: input.query,
        candidates: locallyRanked.map((item) => ({
          id: `${item.document.id}#document`,
          knowledgeId: item.document.id,
          title: item.document.title,
          sectionTitle: null,
          content: item.document.content,
          metadata: { category: item.document.category, version: item.document.version, coverage: item.document.coverage },
          rrfScore: item.fusedScore,
          businessBoost: 0,
          bm25Rank: null,
          bm25Score: item.lexicalScore,
          denseRank: null,
          denseScore: item.vectorScore,
          parentId: parentIdForDocument(item.document.id),
        })),
        topK: Math.min(5, locallyRanked.length),
        config: {
          enabled: input.config.rerankerEnabled === "true",
          apiKey: input.config.rerankerApiKey ?? input.config.apiKey,
          baseUrl: input.config.rerankerBaseUrl ?? input.config.baseUrl,
          model: input.config.rerankerModel ?? "qwen3-rerank",
          timeoutMs: input.config.rerankerTimeoutMs ?? 1_500,
        } satisfies RerankerConfig,
      });
      rerankProvider = rerankResult.provider;
      rerankFallback = rerankResult.fallback;
      rerankFailureCode = rerankResult.failureCode ?? null;
      rerankLatencyMs = rerankResult.latencyMs;
      const byId = new Map(locallyRanked.map((item) => [item.document.id, item]));
      reranked = rerankResult.candidates.flatMap((item) => {
        const source = byId.get(item.knowledgeId);
        return source ? [source] : [];
      });
    }
    const selected = reranked[0] ?? null;
    const indexVersion = currentIndex.currentIndexVersion;
    const currentScore = reranked.find((item) => item.document.id === input.currentSourceId)?.fusedScore ?? null;
    const payload = reranked.map((item) => ({ id: item.document.id, lexicalScore: item.lexicalScore, vectorScore: Number(item.vectorScore.toFixed(4)), fusedScore: Number(item.fusedScore.toFixed(4)), scoreDeltaFromCurrent: currentScore === null ? null : Number((item.fusedScore - currentScore).toFixed(4)), matchedKeywords: item.matchedKeywords, actionMatched: item.actionMatched ?? false, reason: item.actionReason ?? item.guardReason ?? null }));
    const result = { candidateSourceId: selected?.document.id ?? null, changed: Boolean(selected && selected.document.id !== input.currentSourceId), latencyMs: Date.now() - started, indexVersion, candidates: payload, reason: selected?.actionReason ?? "关键词、向量、覆盖率与业务动作融合排序", rerankProvider, rerankFallback, rerankFailureCode, rerankLatencyMs };
    await db.insert(retrievalShadowRuns).values({ id: `RS-${crypto.randomUUID()}`, traceId: input.traceId, organizationId: input.organizationId, intent: input.intent, currentSourceId: input.currentSourceId, candidateSourceId: result.candidateSourceId, changed: result.changed, status: "completed", embeddingModel: model, indexVersion, candidatesJson: JSON.stringify(payload), selectionReason: result.reason, latencyMs: result.latencyMs });
    return result;
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : "SHADOW_UNKNOWN_ERROR";
    try { await getDb().insert(retrievalShadowRuns).values({ id: `RS-${crypto.randomUUID()}`, traceId: input.traceId, organizationId: input.organizationId, intent: input.intent, currentSourceId: input.currentSourceId, changed: false, status: "failed", embeddingModel: model, candidatesJson: "[]", latencyMs: Date.now() - started, errorCode }); } catch { /* Shadow telemetry must never block the Agent. */ }
    return { candidateSourceId: null, changed: false, latencyMs: Date.now() - started, indexVersion: null, candidates: [], reason: errorCode, rerankProvider: "rrf-fallback", rerankFallback: true, rerankFailureCode: errorCode, rerankLatencyMs: 0 };
  }
}

export async function recordRetrievalShadowSkip(input: { traceId: string; organizationId: string; reason: string; config: RetrievalShadowConfig }) {
  if (input.config.enabled !== "true") return;
  try {
    await getDb().insert(retrievalShadowRuns).values({ id: `RS-${crypto.randomUUID()}`, traceId: input.traceId, organizationId: input.organizationId, changed: false, status: "skipped", embeddingModel: input.config.embeddingModel ?? "qwen3.7-text-embedding", candidatesJson: "[]", selectionReason: input.reason, latencyMs: 0 });
  } catch { /* Shadow telemetry must never block the Agent. */ }
}
