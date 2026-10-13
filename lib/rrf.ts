export type RankedRetrievalCandidate = {
  id: string;
  rank: number;
  score: number;
  source: "bm25" | "dense";
  payload?: unknown;
};

export type RrfCandidate = {
  id: string;
  rrfScore: number;
  bm25Rank: number | null;
  bm25Score: number | null;
  denseRank: number | null;
  denseScore: number | null;
  payloads: unknown[];
};

/** Rank-level fusion deliberately avoids adding BM25 and cosine score spaces. */
export function reciprocalRankFusion(
  lists: readonly (readonly RankedRetrievalCandidate[])[],
  k = 60,
): RrfCandidate[] {
  if (!Number.isFinite(k) || k <= 0) throw new Error("RRF_K_MUST_BE_POSITIVE");
  const merged = new Map<string, RrfCandidate>();
  for (const list of lists) {
    for (const [index, candidate] of list.entries()) {
      const rank = candidate.rank > 0 ? candidate.rank : index + 1;
      const existing = merged.get(candidate.id) ?? {
        id: candidate.id,
        rrfScore: 0,
        bm25Rank: null,
        bm25Score: null,
        denseRank: null,
        denseScore: null,
        payloads: [],
      };
      existing.rrfScore += 1 / (k + rank);
      if (candidate.source === "bm25") {
        existing.bm25Rank = rank;
        existing.bm25Score = candidate.score;
      } else {
        existing.denseRank = rank;
        existing.denseScore = candidate.score;
      }
      if (candidate.payload !== undefined) existing.payloads.push(candidate.payload);
      merged.set(candidate.id, existing);
    }
  }
  return [...merged.values()].sort((left, right) => right.rrfScore - left.rrfScore || left.id.localeCompare(right.id));
}
