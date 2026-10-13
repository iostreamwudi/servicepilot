import { and, desc, eq, inArray } from "drizzle-orm";
import { auditLogs, knowledgeDocuments, knowledgeFeedback, users } from "../../../../db/schema";
import { KNOWLEDGE_EDITOR_ROLES, requireKnowledgeActor } from "../../../../lib/knowledge-auth";

const feedbackStatuses = new Set(["open", "in_review", "resolved", "dismissed"]);

export async function GET(request: Request) {
  const auth = await requireKnowledgeActor(request, KNOWLEDGE_EDITOR_ROLES);
  if ("response" in auth) return auth.response;
  const { db, organizationId } = auth.context;
  const requestedStatus = new URL(request.url).searchParams.get("status");
  const statusCondition = requestedStatus && feedbackStatuses.has(requestedStatus) ? eq(knowledgeFeedback.status, requestedStatus as "open" | "in_review" | "resolved" | "dismissed") : inArray(knowledgeFeedback.status, ["open", "in_review"]);
  const rows = await db.select({ feedback: knowledgeFeedback, title: knowledgeDocuments.title, actorName: users.displayName, actorEmail: users.email }).from(knowledgeFeedback).innerJoin(knowledgeDocuments, and(eq(knowledgeDocuments.id, knowledgeFeedback.knowledgeId), eq(knowledgeDocuments.organizationId, organizationId))).innerJoin(users, eq(users.id, knowledgeFeedback.actorUserId)).where(and(eq(knowledgeFeedback.organizationId, organizationId), statusCondition)).orderBy(desc(knowledgeFeedback.createdAt)).limit(100);
  return Response.json({ feedback: rows.map(({ feedback, title, actorName, actorEmail }) => ({ ...feedback, title, actorName, actorEmail })) });
}

export async function POST(request: Request) {
  const auth = await requireKnowledgeActor(request);
  if ("response" in auth) return auth.response;
  const { db, organizationId, actor, email } = auth.context;
  let payload: { knowledgeId?: string; reason?: string; content?: string };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const knowledgeId = payload.knowledgeId?.trim();
  const content = payload.content?.trim();
  if (!knowledgeId || !content || content.length > 2000) return Response.json({ error: "knowledgeId and content are required" }, { status: 400 });
  const [document] = await db.select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, knowledgeId), eq(knowledgeDocuments.organizationId, organizationId))).limit(1);
  if (!document) return Response.json({ error: "Knowledge document not found" }, { status: 404 });
  const now = new Date().toISOString();
  const id = `KF-${crypto.randomUUID()}`;
  const reason = payload.reason?.trim().slice(0, 80) || "未分类";
  await db.insert(knowledgeFeedback).values({ id, organizationId, knowledgeId, actorUserId: actor.id, reason, content, status: "open", resolutionNote: "", resolvedByUserId: null, resolvedAt: null, createdAt: now, updatedAt: now });
  await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.feedback.create", resourceType: "knowledge_feedback", resourceId: id, result: "allowed", risk: "low", metadataJson: JSON.stringify({ actorEmail: email, actorName: actor.displayName, knowledgeId, reason }) });
  return Response.json({ ok: true, feedback: { id, knowledgeId, title: document.title, status: "open", createdAt: now } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireKnowledgeActor(request, KNOWLEDGE_EDITOR_ROLES);
  if ("response" in auth) return auth.response;
  const { db, organizationId, actor, email } = auth.context;
  let payload: { id?: string; status?: string; resolutionNote?: string };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const id = payload.id?.trim();
  const status = payload.status;
  const resolutionNote = payload.resolutionNote?.trim().slice(0, 1000) || "";
  if (!id || !status || !feedbackStatuses.has(status)) return Response.json({ error: "反馈状态或编号不正确" }, { status: 400 });
  if ((status === "resolved" || status === "dismissed") && !resolutionNote) return Response.json({ error: "处理完成前请填写处理说明" }, { status: 400 });
  const [existing] = await db.select().from(knowledgeFeedback).where(and(eq(knowledgeFeedback.id, id), eq(knowledgeFeedback.organizationId, organizationId))).limit(1);
  if (!existing) return Response.json({ error: "反馈不存在或不属于当前工作空间" }, { status: 404 });
  const now = new Date().toISOString();
  const isClosed = status === "resolved" || status === "dismissed";
  const [updated] = await db.update(knowledgeFeedback).set({ status: status as "open" | "in_review" | "resolved" | "dismissed", resolutionNote, resolvedByUserId: isClosed ? actor.id : null, resolvedAt: isClosed ? now : null, updatedAt: now }).where(and(eq(knowledgeFeedback.id, id), eq(knowledgeFeedback.organizationId, organizationId))).returning();
  await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.feedback.update", resourceType: "knowledge_feedback", resourceId: id, result: "allowed", risk: "low", metadataJson: JSON.stringify({ email, fromStatus: existing.status, toStatus: status, resolutionNote }) });
  return Response.json({ feedback: updated });
}
