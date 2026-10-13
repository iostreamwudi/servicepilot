export type ShadowRunForAnalysis = {
  id: string;
  status: "completed" | "failed" | "skipped";
  changed: boolean;
  latencyMs: number;
  intent: string | null;
  indexVersion: string | null;
};

export type ShadowReviewForAnalysis = {
  shadowRunId: string;
  decision: "improvement" | "regression" | "equivalent" | "inconclusive";
};

export const RETRIEVAL_SHADOW_GATE = {
  minimumCompleted: 200,
  minimumConclusiveReviewedChanged: 30,
  minimumCompletedPerIntent: 25,
  maximumFailureRate: 0.01,
  maximumP95LatencyMs: 500,
  maximumRegressionRate: 0.05,
  minimumImprovementRate: 0.6,
  requiredIntents: ["refund", "damage", "address", "invoice"],
} as const;

function percentile95(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1)];
}

function groupedSummary(runs: ShadowRunForAnalysis[], keyFor: (run: ShadowRunForAnalysis) => string) {
  const groups = new Map<string, ShadowRunForAnalysis[]>();
  for (const run of runs) {
    const key = keyFor(run);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.entries()].map(([key, items]) => {
    const completed = items.filter((item) => item.status === "completed");
    return {
      key,
      total: items.length,
      completed: completed.length,
      failed: items.filter((item) => item.status === "failed").length,
      skipped: items.filter((item) => item.status === "skipped").length,
      changed: completed.filter((item) => item.changed).length,
      p95LatencyMs: percentile95(completed.map((item) => item.latencyMs)),
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

export function analyzeRetrievalShadows(runs: ShadowRunForAnalysis[], reviews: ShadowReviewForAnalysis[]) {
  const reviewByRun = new Map(reviews.map((review) => [review.shadowRunId, review]));
  const completed = runs.filter((run) => run.status === "completed");
  const failed = runs.filter((run) => run.status === "failed");
  const changed = completed.filter((run) => run.changed);
  const changedReviews = changed.map((run) => reviewByRun.get(run.id)).filter((review): review is ShadowReviewForAnalysis => Boolean(review));
  const improvements = changedReviews.filter((review) => review.decision === "improvement").length;
  const regressions = changedReviews.filter((review) => review.decision === "regression").length;
  const equivalent = changedReviews.filter((review) => review.decision === "equivalent").length;
  const inconclusive = changedReviews.filter((review) => review.decision === "inconclusive").length;
  const conclusive = improvements + regressions + equivalent;
  const failureRate = completed.length + failed.length ? failed.length / (completed.length + failed.length) : 0;
  const improvementRate = conclusive ? improvements / conclusive : 0;
  const regressionRate = conclusive ? regressions / conclusive : 0;
  const p95LatencyMs = percentile95(completed.map((run) => run.latencyMs));
  const byIntent = groupedSummary(runs, (run) => run.intent ?? "unrouted");
  const byIndexVersion = groupedSummary(runs, (run) => run.indexVersion ?? "unknown");
  const activeVersions = new Set(completed.map((run) => run.indexVersion).filter(Boolean));
  const reasons: string[] = [];
  if (completed.length < RETRIEVAL_SHADOW_GATE.minimumCompleted) reasons.push(`completed ${completed.length}/${RETRIEVAL_SHADOW_GATE.minimumCompleted}`);
  if (conclusive < RETRIEVAL_SHADOW_GATE.minimumConclusiveReviewedChanged) reasons.push(`conclusive reviewed changed ${conclusive}/${RETRIEVAL_SHADOW_GATE.minimumConclusiveReviewedChanged}`);
  if (failureRate > RETRIEVAL_SHADOW_GATE.maximumFailureRate) reasons.push(`failure rate ${(failureRate * 100).toFixed(2)}% > ${(RETRIEVAL_SHADOW_GATE.maximumFailureRate * 100).toFixed(2)}%`);
  if (p95LatencyMs > RETRIEVAL_SHADOW_GATE.maximumP95LatencyMs) reasons.push(`P95 ${p95LatencyMs}ms > ${RETRIEVAL_SHADOW_GATE.maximumP95LatencyMs}ms`);
  if (conclusive && regressionRate > RETRIEVAL_SHADOW_GATE.maximumRegressionRate) reasons.push(`regression rate ${(regressionRate * 100).toFixed(2)}% > ${(RETRIEVAL_SHADOW_GATE.maximumRegressionRate * 100).toFixed(2)}%`);
  if (!conclusive || improvementRate < RETRIEVAL_SHADOW_GATE.minimumImprovementRate) reasons.push(`improvement rate ${(improvementRate * 100).toFixed(2)}% < ${(RETRIEVAL_SHADOW_GATE.minimumImprovementRate * 100).toFixed(2)}%`);
  for (const intent of RETRIEVAL_SHADOW_GATE.requiredIntents) {
    const count = completed.filter((run) => run.intent === intent).length;
    if (count < RETRIEVAL_SHADOW_GATE.minimumCompletedPerIntent) reasons.push(`${intent} completed ${count}/${RETRIEVAL_SHADOW_GATE.minimumCompletedPerIntent}`);
  }
  if (activeVersions.size !== 1) reasons.push(`analysis must contain exactly one index version; found ${activeVersions.size}`);

  return {
    summary: {
      total: runs.length,
      completed: completed.length,
      failed: failed.length,
      skipped: runs.filter((run) => run.status === "skipped").length,
      changed: changed.length,
      changeRate: completed.length ? changed.length / completed.length : 0,
      failureRate,
      averageLatencyMs: completed.length ? Math.round(completed.reduce((sum, run) => sum + run.latencyMs, 0) / completed.length) : 0,
      p95LatencyMs,
    },
    reviews: { pendingChanged: changed.length - changedReviews.length, reviewedChanged: changedReviews.length, conclusiveReviewedChanged: conclusive, improvements, regressions, equivalent, inconclusive, improvementRate, regressionRate },
    byIntent,
    byIndexVersion,
    readiness: { readyForGrayDesign: reasons.length === 0, thresholds: RETRIEVAL_SHADOW_GATE, blockingReasons: reasons },
  };
}
