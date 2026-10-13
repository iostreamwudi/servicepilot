import test from "node:test";
import assert from "node:assert/strict";
import { buildRetrievalScope, scopeAllowsKnowledge } from "../lib/retrieval-scope.ts";
import { businessRuleBoostForDocument, retrieveScopedBm25Candidates, retrieveScopedDenseCandidates } from "../lib/retrieval.ts";
import { reciprocalRankFusion } from "../lib/rrf.ts";
import { rerankCandidates } from "../lib/reranker.ts";

const docs = [
  { id: "KB-208", title: "通用破损售后", content: "商品破损后请提交售后申请并提供凭证。", category: "damage", keywords: ["破损", "售后"], state: "active", risk: "medium", handoff: false, coverage: 0.9, validFrom: null, validUntil: null, version: "v1", organizationId: "org-1" },
  { id: "KB-214", title: "质量故障与维修处理", content: "质量故障可以按维修流程寄修。", category: "damage", keywords: ["故障", "维修", "寄修"], state: "active", risk: "medium", handoff: false, coverage: 0.8, validFrom: null, validUntil: null, version: "v2", organizationId: "org-1" },
  { id: "KB-215", title: "保修与质保", content: "符合保修条件的商品可以申请保修。", category: "damage", keywords: ["保修", "质保"], state: "active", risk: "medium", handoff: false, coverage: 0.85, validFrom: null, validUntil: null, version: "v1", organizationId: "org-1" },
  { id: "KB-999", title: "其他租户知识", content: "不应被检索。", category: "damage", keywords: ["维修"], state: "active", risk: "low", handoff: false, coverage: 1, validFrom: null, validUntil: null, version: "v1", organizationId: "org-2" },
  { id: "KB-998", title: "过期知识", content: "不应被检索。", category: "damage", keywords: ["维修"], state: "active", risk: "low", handoff: false, coverage: 1, validFrom: "2020-01-01", validUntil: "2020-02-01", version: "v1", organizationId: "org-1" },
];

const scope = buildRetrievalScope({ organizationId: "org-1", intent: "damage", preferredKnowledgeIds: ["KB-208"], businessActions: ["repair"] });

test("RetrievalScope keeps a category-wide candidate space and filters tenant/state/time before scoring", () => {
  assert.deepEqual(scope.primaryCategory, "damage");
  assert.ok(scope.allowedCategories.includes("repair"));
  assert.equal(scopeAllowsKnowledge(scope, docs[0]), true);
  assert.equal(scopeAllowsKnowledge(scope, docs[3]), false);
  assert.equal(scopeAllowsKnowledge(scope, docs[4]), false);
  assert.equal(scopeAllowsKnowledge(scope, { ...docs[0], id: "KB-inactive", state: "archived" }), false);
});

test("BM25 wider recall keeps repair and warranty candidates instead of hard-routing KB-208", () => {
  const candidates = retrieveScopedBm25Candidates(docs, "商品买了8个月坏了，怎么申请保修寄修？", scope, { limit: 30 });
  assert.ok(candidates.some((candidate) => candidate.document.id === "KB-214"));
  assert.ok(candidates.some((candidate) => candidate.document.id === "KB-215"));
  assert.ok(candidates.length >= 3);
});

test("BM25 keeps a preferred parent as an auditable prior only when another document has positive evidence", () => {
  const candidates = retrieveScopedBm25Candidates(docs, "寄修", scope, { limit: 30 });
  const preferred = candidates.find((candidate) => candidate.document.id === "KB-208");
  assert.ok(preferred);
  assert.deepEqual(preferred.filterReasons, ["scope-preferred-prior-no-direct-bm25-match"]);
});

test("BM25 no-match returns no trustworthy candidate instead of a zero-score default", () => {
  const candidates = retrieveScopedBm25Candidates(docs, "完全无关的天文问题", scope, { limit: 30 });
  assert.deepEqual(candidates, []);
});

test("Dense recall is independently ranked and does not reuse BM25 score space", () => {
  const candidates = retrieveScopedDenseCandidates(docs, new Map([["KB-214", 0.91], ["KB-208", 0.62], ["KB-215", 0.8]]), scope, 30);
  assert.deepEqual(candidates.map((candidate) => candidate.document.id).slice(0, 3), ["KB-214", "KB-215", "KB-208"]);
  assert.equal(candidates[0].lexicalScore, 0);
});

test("RRF fuses different BM25 and dense winners by rank rather than raw score", () => {
  const fused = reciprocalRankFusion([
    [{ id: "A", rank: 1, score: 13.2, source: "bm25" }, { id: "B", rank: 2, score: 5, source: "bm25" }],
    [{ id: "B", rank: 1, score: 0.91, source: "dense" }, { id: "A", rank: 2, score: 0.82, source: "dense" }],
  ], 60);
  assert.equal(fused[0].id, "A");
  assert.equal(fused[0].bm25Rank, 1);
  assert.equal(fused[0].denseRank, 2);
  assert.ok(fused[0].rrfScore > 0);
});

test("RRF remains available when embedding is the only working recall path", () => {
  const fused = reciprocalRankFusion([[{ id: "semantic-only", rank: 1, score: 0.88, source: "dense" }]], 60);
  assert.equal(fused[0].id, "semantic-only");
  assert.equal(fused[0].bm25Rank, null);
  assert.equal(fused[0].denseRank, 1);
});

test("business action boost is bounded to the RRF score scale and separate from raw retrieval scores", () => {
  const matched = businessRuleBoostForDocument({ documentId: "KB-214", query: "我想寄修", maxBoost: 0.01 });
  const unmatched = businessRuleBoostForDocument({ documentId: "KB-214", query: "商品坏了怎么办", maxBoost: 0.01 });
  assert.equal(matched.boost, 0.01);
  assert.equal(unmatched.boost, -0.01);
  assert.notEqual(matched.reason, null);
});

test("reranker returns audit fields and exact RRF + boost fallback when provider is absent", async () => {
  const result = await rerankCandidates({ query: "商品寄修", topK: 2, candidates: [
    { id: "KB-208#document", knowledgeId: "KB-208", title: "通用售后", content: "商品破损售后", rrfScore: 0.01, businessBoost: 0, bm25Rank: 1, bm25Score: 1, denseRank: null, denseScore: null },
    { id: "KB-214#document", knowledgeId: "KB-214", title: "维修寄修", content: "质量故障可以寄修", rrfScore: 0.009, businessBoost: 0.01, bm25Rank: 2, bm25Score: 0.8, denseRank: 1, denseScore: 0.9 },
  ] });
  assert.equal(result.fallback, true);
  assert.equal(result.provider, "rrf-fallback");
  assert.equal(result.candidates[0].knowledgeId, "KB-214");
  assert.equal(result.candidates[0].rerankRank, 1);
});

test("Dense recall excludes documents that have no vector in the active index", () => {
  const candidates = retrieveScopedDenseCandidates(docs, new Map([["KB-214", 0.91]]), scope, 30);
  assert.deepEqual(candidates.map((candidate) => candidate.document.id), ["KB-214"]);
});

test("reranker timeout/API failure falls back to RRF-compatible candidates", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("RERANKER_TIMEOUT"); };
  try {
    const result = await rerankCandidates({ query: "退款规则", topK: 1, config: { enabled: true, apiKey: "test", baseUrl: "https://example.test/v1", timeoutMs: 1 }, candidates: [{ id: "A#document", knowledgeId: "A", title: "退款规则", content: "退款规则内容", rrfScore: 0.01, businessBoost: 0, bm25Rank: 1, bm25Score: 1, denseRank: null, denseScore: null }] });
    assert.equal(result.fallback, true);
    assert.equal(result.failureCode, "RERANKER_TIMEOUT");
    assert.equal(result.candidates[0].rerankRank, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("reranker invalid response falls back without accepting malformed ranks", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await rerankCandidates({ query: "保修", topK: 1, config: { enabled: true, apiKey: "test", baseUrl: "https://example.test/v1" }, candidates: [{ id: "A#document", knowledgeId: "A", title: "保修", content: "保修规则", rrfScore: 0.01, businessBoost: 0, bm25Rank: 1, bm25Score: 1, denseRank: null, denseScore: null }] });
    assert.equal(result.provider, "rrf-fallback");
    assert.equal(result.failureCode, "RERANKER_INVALID_RESPONSE");
    assert.equal(result.candidates[0].knowledgeId, "A");
  } finally { globalThis.fetch = originalFetch; }
});
