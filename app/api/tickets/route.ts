import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, tickets } from "../../../db/schema";

const ORG_ID = "org-qingyu";
function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}
export async function GET(request: Request) {
  if (!authenticatedEmail(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const rows = await getDb().select().from(tickets).where(eq(tickets.organizationId, ORG_ID)).orderBy(desc(tickets.createdAt)).limit(100);
  return Response.json({ tickets: rows });
}
export async function POST(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const payload = await request.json() as { title?: string; customerName?: string; priority?: "P1" | "P2" | "P3"; conversationId?: string };
  if (!payload.title?.trim() || !payload.customerName?.trim()) return Response.json({ error: "title and customerName are required" }, { status: 400 });
  if (!payload.priority || !["P1", "P2", "P3"].includes(payload.priority)) return Response.json({ error: "valid priority is required" }, { status: 400 });
  const id = `T-${Date.now()}`;
  const slaMinutes = payload.priority === "P1" ? 60 : payload.priority === "P2" ? 240 : 1440;
  const db = getDb();
  const [ticket] = await db.insert(tickets).values({ id, organizationId: ORG_ID, conversationId: payload.conversationId, title: payload.title.trim(), customerName: payload.customerName.trim(), priority: payload.priority, state: "unassigned", slaDueAt: new Date(Date.now() + slaMinutes * 60_000).toISOString() }).returning();
  await db.insert(auditLogs).values({ id: `A-${Date.now()}`, organizationId: ORG_ID, actorType: "user", action: "ticket.create", resourceType: "ticket", resourceId: id, result: "allowed", risk: payload.priority === "P1" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email }) });
  return Response.json({ ticket }, { status: 201 });
}
