export type RerankerCandidate = {
  id: string;
  knowledgeId: string;
  title: string;
  sectionTitle?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  rrfScore: number;
  businessBoost: number;
  bm25Rank: number | null;
  bm25Score: number | null;
  denseRank: number | null;
  denseScore: number | null;
  parentId?: string | null;
};

export type RerankedCandidate = RerankerCandidate & {
  rerankScore: number;
  rerankRank: number;
};

export type RerankerConfig = {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
};

export type RerankerResult = {
  candidates: RerankedCandidate[];
  provider: "qwen3-rerank" | "rrf-fallback";
  fallback: boolean;
  failureCode?: string;
  latencyMs: number;
};

function rrfBoostFallback(candidates: readonly RerankerCandidate[], topK: number): RerankedCandidate[] {
  return candidates.map((candidate) => ({ ...candidate, rerankScore: candidate.rrfScore + candidate.businessBoost, rerankRank: 0 }))
    .sort((left, right) => right.rerankScore - left.rerankScore || right.rrfScore - left.rrfScore || left.id.localeCompare(right.id))
    .slice(0, topK)
    .map((candidate, index) => ({ ...candidate, rerankRank: index + 1 }));
}

function rerankEndpoint(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/compatible-mode/v1")) return normalized.replace(/\/compatible-mode\/v1$/, "/compatible-api/v1/reranks");
  if (normalized.endsWith("/compatible-api/v1")) return `${normalized}/reranks`;
  return `${normalized}/reranks`;
}

/**
 * Provider-neutral semantic reranker. The remote path follows DashScope's
 * qwen3-rerank compatible API; every failure falls back without blocking RAG.
 */
export async function rerankCandidates(input: {
  query: string;
  candidates: readonly RerankerCandidate[];
  topK: number;
  config?: RerankerConfig;
}): Promise<RerankerResult> {
  const started = Date.now();
  const config = input.config ?? {};
  if (!config.enabled || !config.apiKey || !config.baseUrl || !input.candidates.length) {
    const candidates = rrfBoostFallback(input.candidates, input.topK);
    return { candidates, provider: "rrf-fallback", fallback: true, failureCode: "RERANKER_NOT_CONFIGURED", latencyMs: Date.now() - started };
  }
  try {
    const response = await fetch(rerankEndpoint(config.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model ?? "qwen3-rerank",
        query: input.query,
        documents: input.candidates.map((candidate) => [candidate.title, candidate.sectionTitle ?? "", candidate.content].filter(Boolean).join("\n")),
        top_n: input.topK,
        return_documents: false,
      }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 1_500),
    });
    if (!response.ok) throw new Error(`RERANKER_HTTP_${response.status}`);
    const body = await response.json() as { results?: Array<{ index?: number; relevance_score?: number; score?: number }> };
    const rows = body.results;
    if (!Array.isArray(rows) || !rows.length || rows.some((row) => !Number.isInteger(row.index) || !Number.isFinite(row.relevance_score ?? row.score))) throw new Error("RERANKER_INVALID_RESPONSE");
    if (new Set(rows.map((row) => row.index)).size !== rows.length) throw new Error("RERANKER_DUPLICATE_INDEX");
    const ranked = rows.map((row, index) => {
      const source = input.candidates[row.index as number];
      if (!source) throw new Error("RERANKER_INDEX_OUT_OF_RANGE");
      return { ...source, rerankScore: Number(row.relevance_score ?? row.score), rerankRank: index + 1 };
    });
    return { candidates: ranked, provider: "qwen3-rerank", fallback: false, latencyMs: Date.now() - started };
  } catch (error) {
    const failureCode = error instanceof Error ? error.message.slice(0, 120) : "RERANKER_UNKNOWN_ERROR";
    const candidates = rrfBoostFallback(input.candidates, input.topK);
    return { candidates, provider: "rrf-fallback", fallback: true, failureCode, latencyMs: Date.now() - started };
  }
}
