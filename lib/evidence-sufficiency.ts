export type RetrievalEvidenceCandidate = {
  id: string;
  lexicalScore: number;
  vectorScore: number;
  fusedScore: number;
  scoreDeltaFromCurrent: number | null;
  matchedKeywords: string[];
  actionMatched: boolean;
};

export type RetrievalEvidenceAssessment = {
  decision: "keep-current" | "accept-candidate" | "reject-candidate";
  sufficient: boolean;
  selectedSourceId: string | null;
  signals: string[];
  missing: string[];
  reason: string;
};

/**
 * A changed Hybrid candidate must be supported by two independent governed
 * signals and must beat the stable source in the same candidate cohort.
 * Semantic similarity alone is never sufficient to change answer evidence.
 */
export function assessRetrievalEvidenceSufficiency(input: {
  currentSourceId: string | null;
  candidateSourceId: string | null;
  routedSourceId: string | null;
  candidates: readonly RetrievalEvidenceCandidate[];
}): RetrievalEvidenceAssessment {
  if (!input.candidateSourceId) {
    return {
      decision: "reject-candidate", sufficient: false, selectedSourceId: input.currentSourceId,
      signals: [], missing: ["candidate"], reason: "Hybrid未返回可核验候选，保留稳定来源",
    };
  }
  if (input.candidateSourceId === input.currentSourceId) {
    return {
      decision: "keep-current", sufficient: true, selectedSourceId: input.currentSourceId,
      signals: ["stable-source-agreement"], missing: [], reason: "Hybrid与稳定来源一致",
    };
  }
  const candidate = input.candidates.find((item) => item.id === input.candidateSourceId);
  if (!candidate) {
    return {
      decision: "reject-candidate", sufficient: false, selectedSourceId: input.currentSourceId,
      signals: [], missing: ["candidate-detail"], reason: "候选缺少可审计分数，保留稳定来源",
    };
  }

  const signals = [
    candidate.matchedKeywords.length > 0 ? "explicit-keyword" : null,
    candidate.actionMatched ? "business-action" : null,
    candidate.id === input.routedSourceId ? "route-agreement" : null,
  ].filter((item): item is string => Boolean(item));
  const comparable = candidate.scoreDeltaFromCurrent !== null;
  const positiveMargin = comparable && candidate.scoreDeltaFromCurrent! > 0;
  const semantic = Number.isFinite(candidate.vectorScore) && candidate.vectorScore > 0;
  const missing = [
    !comparable ? "stable-score" : null,
    comparable && !positiveMargin ? "positive-margin" : null,
    !semantic ? "semantic-signal" : null,
    signals.length < 2 ? "independent-governed-signals" : null,
  ].filter((item): item is string => Boolean(item));
  const sufficient = missing.length === 0;

  return {
    decision: sufficient ? "accept-candidate" : "reject-candidate",
    sufficient,
    selectedSourceId: sufficient ? candidate.id : input.currentSourceId,
    signals: semantic ? [...signals, "semantic-signal"] : signals,
    missing,
    reason: sufficient
      ? `候选具备正向分差和独立证据：${signals.join("、")}`
      : `候选证据不足（${missing.join("、")}），保留稳定来源`,
  };
}
