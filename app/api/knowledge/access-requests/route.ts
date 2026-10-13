import { and, desc, eq } from "drizzle-orm";
import { auditLogs, knowledgeAccessRequests, users } from "../../../../db/schema";
import { KNOWLEDGE_EDITOR_ROLES, requireKnowledgeActor } from "../../../../lib/knowledge-auth";

const requestStatuses = new Set(["open", "approved", "rejected"]);
const requestedRoles = new Set(["knowledge_operator", "supervisor"]);

export async function GET(request: Request) {
  const auth = await requireKnowledgeActor(request, KNOWLEDGE_EDITOR_ROLES);
  if ("response" in auth) return auth.response;
  const { db, organizationId } = auth.context;
  const statusParam = new URL(request.url).searchParams.get("status");
  const status = statusParam && requestStatuses.has(statusParam) ? statusParam : "open";
  const rows = await db.select({ request: knowledgeAccessRequests, requesterName: users.displayName, requesterEmail: users.email }).from(knowledgeAccessRequests).innerJoin(users, eq(users.id, knowledgeAccessRequests.requesterUserId)).where(and(eq(knowledgeAccessRequests.organizationId, organizationId), eq(knowledgeAccessRequests.status, status as "open" | "approved" | "rejected"))).orderBy(desc(knowledgeAccessRequests.createdAt)).limit(100);
  return Response.json({ requests: rows.map(({ request, requesterName, requesterEmail }) => ({ ...request, requesterName, requesterEmail })) });
}

export async function POST(request: Request) {
  const auth = await requireKnowledgeActor(request);
  if ("response" in auth) return auth.response;
  const { db, organizationId, actor, email } = auth.context;
  let payload: { requestedRole?: string; feature?: string; reason?: string };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "申请参数格式不正确" }, { status: 400 }); }
  const requestedRole = payload.requestedRole?.trim();
  const feature = payload.feature?.trim().slice(0, 120);
  const reason = payload.reason?.trim().slice(0, 1000);
  if (!requestedRole || !requestedRoles.has(requestedRole) || !feature || !reason) return Response.json({ error: "请选择申请角色并填写功能和业务理由" }, { status: 400 });
  const [pending] = await db.select({ id: knowledgeAccessRequests.id }).from(knowledgeAccessRequests).where(and(eq(knowledgeAccessRequests.organizationId, organizationId), eq(knowledgeAccessRequests.requesterUserId, actor.id), eq(knowledgeAccessRequests.status, "open"))).limit(1);
  if (pending) return Response.json({ error: "已有待处理的权限申请，请等待管理员审核", requestId: pending.id }, { status: 409 });
  const now = new Date().toISOString();
  const id = `KA-${crypto.randomUUID()}`;
  await db.insert(knowledgeAccessRequests).values({ id, organizationId, requesterUserId: actor.id, requestedRole, feature, reason, status: "open", reviewerUserId: null, reviewNote: "", reviewedAt: null, createdAt: now, updatedAt: now });
  await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.access_request.create", resourceType: "knowledge_access_request", resourceId: id, result: "allowed", risk: "medium", metadataJson: JSON.stringify({ email, requestedRole, feature }) });
  return Response.json({ request: { id, status: "open", requestedRole, feature, createdAt: now } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireKnowledgeActor(request, KNOWLEDGE_EDITOR_ROLES);
  if ("response" in auth) return auth.response;
  const { db, organizationId, actor, email } = auth.context;
  let payload: { id?: string; status?: string; reviewNote?: string };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "审核参数格式不正确" }, { status: 400 }); }
  const id = payload.id?.trim();
  const status = payload.status;
  const reviewNote = payload.reviewNote?.trim().slice(0, 1000) || "";
  if (!id || (status !== "approved" && status !== "rejected") || !reviewNote) return Response.json({ error: "审核结果和说明均为必填" }, { status: 400 });
  const [existing] = await db.select().from(knowledgeAccessRequests).where(and(eq(knowledgeAccessRequests.id, id), eq(knowledgeAccessRequests.organizationId, organizationId))).limit(1);
  if (!existing) return Response.json({ error: "权限申请不存在或不属于当前工作空间" }, { status: 404 });
  const now = new Date().toISOString();
  const [updated] = await db.update(knowledgeAccessRequests).set({ status, reviewerUserId: actor.id, reviewNote, reviewedAt: now, updatedAt: now }).where(and(eq(knowledgeAccessRequests.id, id), eq(knowledgeAccessRequests.organizationId, organizationId))).returning();
  await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.access_request.review", resourceType: "knowledge_access_request", resourceId: id, result: "allowed", risk: "medium", metadataJson: JSON.stringify({ email, fromStatus: existing.status, toStatus: status, reviewNote }) });
  return Response.json({ request: updated });
}
