import { getDb } from "../../../../db";
import { auditLogs } from "../../../../db/schema";
import { lookupRefund } from "../../../../lib/order-tool";
import { tenantIdForRequest } from "../../../../lib/tenant";

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

export async function GET(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const orderId = new URL(request.url).searchParams.get("orderId")?.trim().toUpperCase() ?? "";
  const organizationId = tenantIdForRequest(request);
  const result = await lookupRefund(orderId, organizationId);
  const auditBase = { id: `A-TOOL-${crypto.randomUUID()}`, organizationId, actorType: "agent" as const, action: "tool.order_refund.read", resourceType: "order", resourceId: orderId || "missing", metadataJson: JSON.stringify({ actorEmail: email, dataScope: "refund_status_only", piiMasked: true, sourceType: result.sourceType }) };
  await getDb().insert(auditLogs).values({ ...auditBase, result: result.ok ? "allowed" : "blocked", risk: result.ok ? "low" : "medium" });
  if (!result.ok) return Response.json({ error: result.code === "INVALID_ORDER_ID" ? "Invalid orderId" : "Order not found", code: result.code }, { status: result.code === "INVALID_ORDER_ID" ? 400 : 404 });
  return Response.json({ refund: result.record, meta: { sourceType: result.record.sourceType, sourceId: result.record.sourceId, readOnly: true, piiMasked: true, isSynthetic: false, dataFreshness: result.record.dataFreshness } });
}
