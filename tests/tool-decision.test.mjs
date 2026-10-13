import assert from "node:assert/strict";
import test from "node:test";
import { decideReadOnlyTool, extractVerifiedOrderId, requiresLiveRefundFact } from "../lib/tool-decision.ts";

test("does not call a business tool for a general refund policy question", () => {
  assert.equal(requiresLiveRefundFact("退款通常多久到账？"), false);
  assert.equal(decideReadOnlyTool({ query: "退款通常多久到账？", intent: "refund" }).action, "skip");
});

test("requests a verified order id before reading a customer refund record", () => {
  const decision = decideReadOnlyTool({ query: "我的退款现在到哪一步了？", intent: "refund" });
  assert.equal(decision.action, "request_parameter");
  assert.deepEqual(decision.missingParameters, ["orderId"]);
});

test("invokes only the authorized read-only tool for an explicit live fact request", () => {
  const decision = decideReadOnlyTool({ query: "订单 OR-123456 的退款到账了吗？", intent: "refund" });
  assert.equal(decision.action, "invoke");
  assert.equal(decision.tool, "order.refund.get");
  assert.equal(decision.orderId, "OR-123456");
  assert.equal(decision.readOnly, true);
});

test("inherits an order id only from verified structured conversation facts", () => {
  assert.equal(extractVerifiedOrderId("现在到账了吗？", ["OR-654321"]), "OR-654321");
  const decision = decideReadOnlyTool({ query: "我的退款到账了吗？", intent: "refund", verifiedFacts: ["OR-654321"] });
  assert.equal(decision.action, "invoke");
  assert.equal(decision.orderId, "OR-654321");
});

test("does not expose the refund tool to a different business category", () => {
  const decision = decideReadOnlyTool({ query: "订单 OR-123456 现在到哪一步？", intent: "invoice" });
  assert.equal(decision.action, "skip");
  assert.equal(decision.tool, null);
});
