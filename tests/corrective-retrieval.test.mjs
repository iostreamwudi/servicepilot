import assert from "node:assert/strict";
import test from "node:test";
import { assessCorrectiveRetrieval, buildCorrectiveRetrievalQuery, shouldRunCorrectiveRetrieval } from "../lib/corrective-retrieval.ts";

function evidenceCandidate(id, overrides = {}) {
  return {
    id, lexicalScore: 8, vectorScore: 0.8, fusedScore: 9,
    scoreDeltaFromCurrent: 1.5, matchedKeywords: ["税号"], actionMatched: false,
    ...overrides,
  };
}

test("builds one structured correction query only from governed context", () => {
  const query = buildCorrectiveRetrievalQuery({
    query: "公司税号写错了怎么办",
    intent: "invoice",
    matchedSignals: ["税号", "公司名称"],
    topicEvidence: ["发票"],
    providedFacts: ["税号"],
  });
  assert.match(query, /用户原问题：公司税号写错了怎么办/);
  assert.match(query, /业务类目：发票/);
  assert.match(query, /已确认上下文：发票、税号/);
  assert.match(query, /路由证据：税号、公司名称/);
});

test("runs correction only when first retrieval evidence is insufficient", () => {
  assert.equal(shouldRunCorrectiveRetrieval({ sufficient: false }), true);
  assert.equal(shouldRunCorrectiveRetrieval({ sufficient: true }), false);
});

test("accepts a corrected candidate with score gain and original-query evidence", () => {
  const result = assessCorrectiveRetrieval({
    baselineSourceId: "KB-401",
    correctedSourceId: "KB-402",
    routedSourceId: "KB-402",
    initialCandidates: [evidenceCandidate("KB-402")],
    correctedCandidates: [evidenceCandidate("KB-402", { scoreDeltaFromCurrent: 2.4, matchedKeywords: ["改写注入词"] })],
  });
  assert.equal(result.decision, "accept-candidate");
  assert.equal(result.selectedSourceId, "KB-402");
});

test("rejects a correction supported only by terms introduced in the rewrite", () => {
  const result = assessCorrectiveRetrieval({
    baselineSourceId: "KB-401",
    correctedSourceId: "KB-402",
    routedSourceId: "KB-402",
    initialCandidates: [evidenceCandidate("KB-402", { matchedKeywords: [], actionMatched: false })],
    correctedCandidates: [evidenceCandidate("KB-402", { matchedKeywords: ["发票信息更正"], actionMatched: true })],
  });
  assert.equal(result.decision, "reject-candidate");
  assert.ok(result.missing.includes("independent-governed-signals"));
});
