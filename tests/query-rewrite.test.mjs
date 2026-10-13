import test from "node:test";
import assert from "node:assert/strict";
import { buildQueryRewritePrompt, shouldAcceptRewrittenKnowledge, shouldRunQueryRewrite, validateQueryRewrite } from "../lib/query-rewrite.ts";

const base = { query: "那退款还要多久", intent: "refund", businessAction: "refund", entities: ["order_or_logistics"], states: ["refund"], evidence: ["退款金额或去向异常"], topicEvidence: ["到账"] };

test("rewrite prompt is retrieval-only and preserves governed signals", () => {
  const prompt = buildQueryRewritePrompt(base);
  assert.match(prompt, /不回答问题/);
  assert.match(prompt, /退款金额或去向异常/);
  assert.match(prompt, /preservedSignals/);
});

test("rewrite validator rejects answer-like or fact-adding output", () => {
  const accepted = validateQueryRewrite('{"query":"退款到账时间 查询","preservedSignals":["退款金额或去向异常"]}', base);
  assert.equal(accepted.accepted, true);
  const rejected = validateQueryRewrite('{"query":"保证今天一定到账","preservedSignals":["退款金额或去向异常"]}', base);
  assert.equal(rejected.accepted, false);
});

test("rewrite validator preserves protected order tokens", () => {
  const input = { ...base, query: "订单 OR-123456 的退款那还要多久" };
  const result = validateQueryRewrite('{"query":"退款到账时间","preservedSignals":["退款金额或去向异常"]}', input);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "protected-token-dropped");
});

test("rewrite gate only triggers on weak or context-derived routes", () => {
  assert.equal(shouldRunQueryRewrite({ matchedSignals: ["退款"], contextSource: "current", structuredEvidence: ["退款金额或去向异常"], margin: 0.7, marginThreshold: 0.4 }).run, false);
  assert.equal(shouldRunQueryRewrite({ matchedSignals: ["上下文:退款"], contextSource: "memory", structuredEvidence: [] }).run, true);
});

test("rewritten retrieval must show governed evidence gain", () => {
  assert.equal(shouldAcceptRewrittenKnowledge({ originalQuery: "钱", rewrittenQuery: "退款到账时间", originalTerms: ["退款"], rewrittenTerms: ["退款", "到账"], originalId: "KB-114", rewrittenId: "KB-114" }).accept, true);
  assert.equal(shouldAcceptRewrittenKnowledge({ originalQuery: "退款", rewrittenQuery: "退款", originalTerms: ["退款"], rewrittenTerms: ["退款"], originalId: "KB-114", rewrittenId: "KB-114" }).accept, false);
});
