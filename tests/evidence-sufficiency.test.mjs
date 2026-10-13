import assert from "node:assert/strict";
import test from "node:test";
import { assessRetrievalEvidenceSufficiency } from "../lib/evidence-sufficiency.ts";

function candidate(overrides = {}) {
  return {
    id: "KB-402", lexicalScore: 8, vectorScore: 0.81, fusedScore: 9.2,
    scoreDeltaFromCurrent: 2.1, matchedKeywords: ["税号"], actionMatched: true,
    ...overrides,
  };
}

test("keeps a stable source when Hybrid agrees", () => {
  const result = assessRetrievalEvidenceSufficiency({
    currentSourceId: "KB-401", candidateSourceId: "KB-401", routedSourceId: "KB-401", candidates: [],
  });
  assert.equal(result.decision, "keep-current");
  assert.equal(result.sufficient, true);
});

test("accepts a changed candidate with margin and independent governed evidence", () => {
  const result = assessRetrievalEvidenceSufficiency({
    currentSourceId: "KB-401", candidateSourceId: "KB-402", routedSourceId: "KB-402", candidates: [candidate()],
  });
  assert.equal(result.decision, "accept-candidate");
  assert.equal(result.selectedSourceId, "KB-402");
  assert.deepEqual(result.missing, []);
});

test("rejects semantic-only candidate changes", () => {
  const result = assessRetrievalEvidenceSufficiency({
    currentSourceId: "KB-401", candidateSourceId: "KB-402", routedSourceId: "KB-401",
    candidates: [candidate({ matchedKeywords: [], actionMatched: false })],
  });
  assert.equal(result.decision, "reject-candidate");
  assert.equal(result.selectedSourceId, "KB-401");
  assert.ok(result.missing.includes("independent-governed-signals"));
});

test("rejects a candidate that cannot be compared with the stable source", () => {
  const result = assessRetrievalEvidenceSufficiency({
    currentSourceId: "KB-401", candidateSourceId: "KB-402", routedSourceId: "KB-402",
    candidates: [candidate({ scoreDeltaFromCurrent: null })],
  });
  assert.equal(result.decision, "reject-candidate");
  assert.ok(result.missing.includes("stable-score"));
});
