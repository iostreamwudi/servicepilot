import type { BusinessIntent } from "./intent-router.ts";

export type ReadOnlyToolName = "order.refund.get";
export type ToolDecisionAction = "skip" | "request_parameter" | "invoke";

export type ToolDecision = {
  action: ToolDecisionAction;
  tool: ReadOnlyToolName | null;
  orderId: string | null;
  missingParameters: string[];
  reason: string;
  readOnly: true;
};

const ORDER_ID_PATTERN = /OR-\d{6}/gi;
const liveRefundFactPattern = /退款(?:状态|进度|结果)|处理到哪|到哪一步|到账(?:了|没|没有|了吗|没有到账)|退(?:了|回了吗|回来没)|审核(?:状态|通过了吗|完成了吗)|原路退回(?:了吗|没有)/;
const customerRecordAnchorPattern = /我的|这笔|该笔|这个订单|该订单|订单号|订单\s*OR-|OR-\d{6}/i;

export function extractVerifiedOrderId(query: string, verifiedFacts: readonly string[] = []) {
  const values = [query, ...verifiedFacts];
  for (const value of values) {
    const match = value.toUpperCase().match(ORDER_ID_PATTERN)?.[0];
    if (match) return match;
  }
  return null;
}

export function requiresLiveRefundFact(query: string) {
  const normalized = query.replace(/\s+/g, "");
  return liveRefundFactPattern.test(normalized) && customerRecordAnchorPattern.test(normalized);
}

/**
 * Selects a read-only tool from governed intent and verified user facts.
 * The decision is deliberately deterministic: model wording cannot invent a
 * tool, a parameter, or a business-record lookup.
 */
export function decideReadOnlyTool(input: {
  query: string;
  intent: BusinessIntent;
  verifiedFacts?: readonly string[];
}): ToolDecision {
  const orderId = extractVerifiedOrderId(input.query, input.verifiedFacts);
  if (input.intent !== "refund") {
    return { action: "skip", tool: null, orderId, missingParameters: [], reason: "当前业务类目没有已授权的只读事实工具", readOnly: true };
  }
  if (!requiresLiveRefundFact(input.query)) {
    return { action: "skip", tool: null, orderId, missingParameters: [], reason: "用户询问的是规则或流程，不需要读取实时订单事实", readOnly: true };
  }
  if (!orderId) {
    return { action: "request_parameter", tool: "order.refund.get", orderId: null, missingParameters: ["orderId"], reason: "实时退款事实需要经用户提供并校验订单号", readOnly: true };
  }
  return { action: "invoke", tool: "order.refund.get", orderId, missingParameters: [], reason: "用户明确询问当前退款事实且已提供有效订单号", readOnly: true };
}
