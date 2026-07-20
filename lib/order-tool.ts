export type RefundRecord = {
  orderId: string;
  status: "approved" | "processing" | "completed";
  approvedAt: string;
  expectedBusinessDays: string;
  paymentChannelMasked: string;
};

const refundRecords: Record<string, RefundRecord> = {
  "OR-773928": { orderId: "OR-773928", status: "approved", approvedAt: "2026-07-20T10:26:00+08:00", expectedBusinessDays: "1–3", paymentChannelMasked: "支付宝（尾号 **28）" },
  "OR-773114": { orderId: "OR-773114", status: "processing", approvedAt: "2026-07-18T15:40:00+08:00", expectedBusinessDays: "1–3", paymentChannelMasked: "微信支付（尾号 **06）" },
  "OR-772601": { orderId: "OR-772601", status: "completed", approvedAt: "2026-07-16T09:15:00+08:00", expectedBusinessDays: "1–3", paymentChannelMasked: "银行卡（尾号 **61）" },
};

export function validOrderId(value: string) {
  return /^OR-\d{6}$/.test(value);
}

export function lookupRefund(orderId: string) {
  if (!validOrderId(orderId)) return { ok: false as const, code: "INVALID_ORDER_ID" };
  const record = refundRecords[orderId];
  if (!record) return { ok: false as const, code: "NOT_FOUND" };
  return { ok: true as const, record };
}
