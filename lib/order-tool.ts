import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { orders, refunds } from "../db/schema";

export type RefundRecord = {
  orderId: string;
  status: "approved" | "processing" | "completed";
  approvedAt: string;
  expectedBusinessDays: string;
  paymentChannelMasked: string;
  sourceType: "production";
  sourceId: string;
  dataFreshness: string;
};

export function validOrderId(value: string) {
  return /^OR-\d{6}$/.test(value);
}

export async function lookupRefund(orderId: string, organizationId: string) {
  if (!validOrderId(orderId)) return { ok: false as const, code: "INVALID_ORDER_ID", sourceType: "production" as const, sourceId: orderId, isSynthetic: false };
  const db = getDb();
  const rows = await db.select({ refund: refunds, order: orders }).from(refunds).innerJoin(orders, eq(refunds.orderId, orders.id)).where(and(eq(refunds.organizationId, organizationId), eq(refunds.orderId, orderId))).limit(1);
  const row = rows[0];
  if (!row) return { ok: false as const, code: "NOT_FOUND", sourceType: "production" as const, sourceId: orderId, isSynthetic: false };
  if (row.refund.sourceType !== "production") return { ok: false as const, code: "NON_PRODUCTION_RECORD", sourceType: row.refund.sourceType, sourceId: orderId, isSynthetic: true };
  return { ok: true as const, record: { orderId, status: row.refund.status as RefundRecord["status"], approvedAt: row.refund.approvedAt ?? "", expectedBusinessDays: row.refund.expectedBusinessDays ?? "", paymentChannelMasked: row.order.paymentChannelMasked ?? "未记录", sourceType: "production", sourceId: row.refund.id, dataFreshness: row.refund.updatedAt }, readOnly: true, isSynthetic: false };
}
