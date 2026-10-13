import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRetrievalShadows, RETRIEVAL_SHADOW_GATE } from "../lib/retrieval-shadow-analysis.ts";

const intents = ["refund", "damage", "address", "invoice"];

function completedRuns(count = 200) {
  return Array.from({ length: count }, (_, index) => ({
    id: `run-${index}`,
    status: "completed",
    changed: index < 30,
    latencyMs: 250 + (index % 50),
    intent: intents[index % intents.length],
    indexVersion: "idx-2026-08-21",
  }));
}

test("requires representative reviewed traffic before gray design", () => {
  const analysis = analyzeRetrievalShadows(completedRuns(20), []);
  assert.equal(analysis.readiness.readyForGrayDesign, false);
  assert.ok(analysis.readiness.blockingReasons.some((reason) => reason.includes("completed 20/200")));
  assert.ok(analysis.readiness.blockingReasons.some((reason) => reason.includes("conclusive reviewed changed")));
  assert.equal(analysis.reviews.pendingChanged, 20);
});

test("reports intent and index cohorts and passes the evidence gate", () => {
  const runs = completedRuns();
  const reviews = Array.from({ length: 30 }, (_, index) => ({
    shadowRunId: `run-${index}`,
    decision: index < 24 ? "improvement" : index === 24 ? "regression" : "equivalent",
  }));
  const analysis = analyzeRetrievalShadows(runs, reviews);
  assert.equal(analysis.summary.completed, 200);
  assert.equal(analysis.summary.p95LatencyMs, 297);
  assert.equal(analysis.byIntent.length, 4);
  assert.ok(analysis.byIntent.every((item) => item.completed === 50));
  assert.deepEqual(analysis.byIndexVersion.map((item) => item.key), ["idx-2026-08-21"]);
  assert.equal(analysis.reviews.reviewedChanged, 30);
  assert.equal(analysis.reviews.conclusiveReviewedChanged, 30);
  assert.equal(analysis.reviews.improvementRate, 24 / 30);
  assert.equal(analysis.reviews.regressionRate, 1 / 30);
  assert.equal(analysis.readiness.readyForGrayDesign, true);
  assert.deepEqual(analysis.readiness.blockingReasons, []);
  assert.equal(analysis.readiness.thresholds, RETRIEVAL_SHADOW_GATE);
});

test("blocks mixed index versions, excessive failures and regressions", () => {
  const runs = completedRuns();
  runs[0].indexVersion = "older-index";
  runs.push({ id: "failed-1", status: "failed", changed: false, latencyMs: 0, intent: "refund", indexVersion: "idx-2026-08-21" });
  runs.push({ id: "failed-2", status: "failed", changed: false, latencyMs: 0, intent: "refund", indexVersion: "idx-2026-08-21" });
  runs.push({ id: "failed-3", status: "failed", changed: false, latencyMs: 0, intent: "refund", indexVersion: "idx-2026-08-21" });
  const reviews = Array.from({ length: 30 }, (_, index) => ({ shadowRunId: `run-${index}`, decision: index < 20 ? "improvement" : "regression" }));
  const analysis = analyzeRetrievalShadows(runs, reviews);
  assert.equal(analysis.readiness.readyForGrayDesign, false);
  assert.ok(analysis.readiness.blockingReasons.some((reason) => reason.includes("failure rate")));
  assert.ok(analysis.readiness.blockingReasons.some((reason) => reason.includes("regression rate")));
  assert.ok(analysis.readiness.blockingReasons.some((reason) => reason.includes("exactly one index version")));
});
