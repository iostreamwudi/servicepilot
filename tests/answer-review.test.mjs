import assert from "node:assert/strict";
import test from "node:test";
import { reviewGroundedAnswer } from "../lib/answer-review.ts";

const skipDecision = { action: "skip", tool: null, orderId: null, missingParameters: [], reason: "规则问题", readOnly: true };

test("passes a draft whose timing is present in governed knowledge", () => {
  const result = reviewGroundedAnswer({
    draft: "退款审核通过后通常在1至3个工作日内原路退回。",
    knowledgeEvidence: ["审核通过后通常1–3个工作日原路退回。"],
    toolDecision: skipDecision, toolResult: null, handoff: false,
  });
  assert.equal(result.status, "passed");
});

test("removes unsupported numeric promises without learning a case answer", () => {
  const result = reviewGroundedAnswer({
    draft: "我们保证2小时内到账。您可以留意支付账户。",
    knowledgeEvidence: ["到账时间取决于支付渠道。"],
    toolDecision: skipDecision, toolResult: null, handoff: false,
  });
  assert.notEqual(result.status, "passed");
  assert.doesNotMatch(result.answer, /2小时|保证/);
});

test("blocks claims that an unauthorized write action has completed", () => {
  const result = reviewGroundedAnswer({
    draft: "已经为您修改地址，请等待收货。",
    knowledgeEvidence: ["修改地址需要核验订单状态。"],
    toolDecision: skipDecision, toolResult: null, handoff: false,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.handoff, true);
});

test("requires a parameter request before a live lookup", () => {
  const decision = { action: "request_parameter", tool: "order.refund.get", orderId: null, missingParameters: ["orderId"], reason: "缺少订单号", readOnly: true };
  const result = reviewGroundedAnswer({ draft: "我帮您看看。", knowledgeEvidence: [], toolDecision: decision, toolResult: null, handoff: false });
  assert.equal(result.status, "blocked");
  assert.match(result.answer, /订单号/);
});

test("blocks a state that conflicts with a successful read-only tool", () => {
  const decision = { action: "invoke", tool: "order.refund.get", orderId: "OR-123456", missingParameters: [], reason: "实时查询", readOnly: true };
  const result = reviewGroundedAnswer({
    draft: "这笔退款已完成。",
    knowledgeEvidence: ["退款按支付渠道原路退回。"],
    toolDecision: decision, toolResult: { ok: true, record: { status: "processing" } }, handoff: false,
  });
  assert.equal(result.status, "blocked");
  assert.doesNotMatch(result.answer, /已完成/);
});
