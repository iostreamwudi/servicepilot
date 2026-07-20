import { getDb } from "../../../../db";
import { auditLogs } from "../../../../db/schema";
import { lookupRefund } from "../../../../lib/order-tool";

const ORG_ID = "org-qingyu";

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

export async function GET(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const orderId = new URL(request.url).searchParams.get("orderId")?.trim().toUpperCase() ?? "";
  const result = lookupRefund(orderId);
  const auditBase = { id: `A-TOOL-${crypto.randomUUID()}`, organizationId: ORG_ID, actorType: "agent" as const, action: "tool.order_refund.read", resourceType: "order", resourceId: orderId || "missing", metadataJson: JSON.stringify({ actorEmail: email, dataScope: "refund_status_only", piiMasked: true }) };
  try {
    await getDb().insert(auditLogs).values({ ...auditBase, result: result.ok ? "allowed" : "blocked", risk: result.ok ? "low" : "medium" });
  } catch { /* The read result remains available if audit storage is temporarily degraded. */ }
  if (!result.ok) return Response.json({ error: result.code === "INVALID_ORDER_ID" ? "Invalid orderId" : "Order not found", code: result.code }, { status: result.code === "INVALID_ORDER_ID" ? 400 : 404 });
  return Response.json({ refund: result.record, meta: { source: "mock-order-service", readOnly: true, piiMasked: true } });
}
