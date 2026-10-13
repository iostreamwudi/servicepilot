import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBoth, evaluateRankings, validateGradedSet } from "../scripts/evaluate-graded-golden.mjs";

function golden() {
  return {
    schemaVersion: "phase1.3a-graded-golden-v2",
    frozen: false,
    cases: [
      {
        id: "q1",
        expectedSource: "KB-114",
        primaryKnowledgeId: "KB-114",
        relevanceGrades: { "KB-114": 3, "KB-120": 2, "KB-119": 1, "KB-999": 0 },
        labelRationale: "人工示例",
        candidateReviewQueue: [],
      },
      {
        id: "q2",
        expectedSource: "KB-208",
        primaryKnowledgeId: "KB-208",
        relevanceGrades: { "KB-208": 3, "KB-211": 2 },
        labelRationale: "人工示例",
        candidateReviewQueue: [],
      },
    ],
  };
}

test("graded evaluator accepts multiple grade>=2 and computes ranking metrics", () => {
  const resultRecords = [
    { id: "q1", v1: ["KB-119", "KB-120", "KB-114"], reranked: ["KB-999", "KB-114"] },
    { id: "q2", v1: ["KB-211", "KB-208"], reranked: ["KB-999"] },
  ];
  const graded = evaluateRankings(golden(), resultRecords, { field: "v1" });
  assert.equal(graded.cases, 2);
  assert.equal(graded.missingResultCases, 0);
  assert.equal(graded.recallAt5, 1);
  assert.equal(graded.recallAt10, 1);
  assert.equal(graded.mrr, 0.75);
  assert.ok(graded.dcgAt10 > 0);
  assert.ok(graded.ndcgAt5 > 0 && graded.ndcgAt5 <= 1);
});

test("single-label and graded modes run together", () => {
  const result = evaluateBoth(golden(), [{ id: "q1", v1: ["KB-120", "KB-114"] }, { id: "q2", v1: ["KB-211"] }], ["v1"]);
  assert.equal(result.graded.v1.recallAt5, 1);
  assert.equal(result.singleLabel.v1.recallAt5, 0.5);
  assert.equal(result.graded.v1.mrr, 1);
  assert.equal(result.singleLabel.v1.mrr, 0.25);
});

test("draft validation permits inherited primary only and rejects unreviewed proposed grades", () => {
  const payload = golden();
  payload.cases[0].candidateReviewQueue = [{ knowledgeId: "KB-120", proposedGrade: 2, humanReviewed: false }];
  const invalid = validateGradedSet(payload);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /requires humanReviewed/);
});

test("human review may downgrade expectedSource while preserving legacy compatibility", () => {
  const payload = golden();
  payload.cases[0] = { ...payload.cases[0], relevanceGrades: { "KB-114": 2 }, humanReviewed: true, reviewer: "qa", reviewedAt: "2026-08-26T00:00:00Z", reviewNotes: "正文复核后降级" };
  assert.equal(validateGradedSet(payload).valid, true);
});

test("frozen validation requires reviewer metadata for every case", () => {
  const payload = golden();
  payload.frozen = true;
  assert.equal(validateGradedSet(payload, { requireFrozen: true }).valid, false);
  payload.cases = payload.cases.map((record) => ({ ...record, frozen: true, humanReviewed: true, reviewer: "qa", reviewedAt: "2026-08-25T00:00:00Z", reviewNotes: "人工复核完成" }));
  assert.equal(validateGradedSet(payload, { requireFrozen: true }).valid, true);
});
