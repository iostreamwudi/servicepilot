import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, conversations, messages } from "../../../../db/schema";

const ORG_ID = "org-qingyu";

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  if (!/^C-[A-Za-z0-9-]{1,80}$/.test(id)) return Response.json({ error: "conversationId is invalid" }, { status: 400 });
  let payload: { action?: unknown; content?: unknown };
  try { payload = await request.json() as { action?: unknown; content?: unknown }; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const action = payload.action;
  const db = getDb();
  const [conversation] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.organizationId, ORG_ID))).limit(1);
  if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const now = new Date().toISOString();
  if (action === "claim") {
    await db.update(conversations).set({ status: "human_active", updatedAt: now }).where(eq(conversations.id, id));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId: ORG_ID, actorType: "user", action: "conversation.claim", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email }) });
    return Response.json({ ok: true, status: "处理中" });
  }
  if (action === "reply") {
    if (typeof payload.content !== "string" || !payload.content.trim()) return Response.json({ error: "content is required" }, { status: 400 });
    await db.insert(messages).values({ id: `M-${crypto.randomUUID()}`, conversationId: id, senderType: "agent", content: payload.content.trim().slice(0, 500), citationsJson: "[]", toolTraceJson: "[]", createdAt: now });
    await db.update(conversations).set({ status: "human_active", updatedAt: now }).where(eq(conversations.id, id));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId: ORG_ID, actorType: "user", action: "conversation.reply", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, contentLength: payload.content.trim().length }) });
    return Response.json({ ok: true, status: "处理中" });
  }
  if (action === "resolve") {
    await db.update(conversations).set({ status: "resolved", updatedAt: now }).where(eq(conversations.id, id));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId: ORG_ID, actorType: "user", action: "conversation.resolve", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email }) });
    return Response.json({ ok: true, status: "已解决" });
  }
  if (action === "reopen") {
    await db.update(conversations).set({ status: "human_active", updatedAt: now }).where(eq(conversations.id, id));
    return Response.json({ ok: true, status: "处理中" });
  }
  return Response.json({ error: "Unsupported conversation action" }, { status: 400 });
}
