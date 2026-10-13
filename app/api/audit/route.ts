import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, users } from "../../../db/schema";
import { tenantIdForRequest } from "../../../lib/tenant";

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

export async function GET(request: Request) {
  if (!authenticatedEmail(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const organizationId = tenantIdForRequest(request);
  const db = getDb();
  const rows = await db.select({ audit: auditLogs, actor: users }).from(auditLogs).leftJoin(users, eq(auditLogs.actorUserId, users.id)).where(eq(auditLogs.organizationId, organizationId)).orderBy(desc(auditLogs.createdAt)).limit(500);
  return Response.json({ logs: rows.map(({ audit, actor }) => ({ id: audit.id, at: audit.createdAt, actor: actor?.displayName ?? (audit.actorType === "agent" ? "Agent" : "系统"), action: audit.action, resourceType: audit.resourceType, resourceId: audit.resourceId, result: audit.result, risk: audit.risk, metadata: audit.metadataJson })) });
}
