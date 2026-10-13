import { and, eq } from "drizzle-orm";
import { auditLogs, knowledgeSavedViews } from "../../../../../db/schema";
import { requireKnowledgeActor } from "../../../../../lib/knowledge-auth";

async function findView(request: Request, id: string) {
  const auth = await requireKnowledgeActor(request);
  if ("response" in auth) return auth;
  const [view] = await auth.context.db.select().from(knowledgeSavedViews).where(and(eq(knowledgeSavedViews.id, id), eq(knowledgeSavedViews.organizationId, auth.context.organizationId))).limit(1);
  if (!view) return { response: Response.json({ error: "视图不存在或不属于当前工作空间" }, { status: 404 }) } as const;
  const canEdit = view.scope === "team" ? ["supervisor", "product_admin", "system_admin"].includes(auth.context.actor.role) : view.ownerUserId === auth.context.actor.id;
  if (!canEdit) return { response: Response.json({ error: "你没有编辑该视图的权限" }, { status: 403 }) } as const;
  return { context: auth.context, view } as const;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await findView(request, (await context.params).id);
  if ("response" in auth) return auth.response;
  let payload: { name?: string; isDefault?: boolean };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const changes: Partial<typeof knowledgeSavedViews.$inferInsert> = {};
  if (typeof payload.name === "string") { const name = payload.name.trim().slice(0, 40); if (!name) return Response.json({ error: "视图名称不能为空" }, { status: 400 }); changes.name = name; }
  if (typeof payload.isDefault === "boolean") changes.isDefault = payload.isDefault;
  if (!Object.keys(changes).length) return Response.json({ error: "没有可更新的视图字段" }, { status: 400 });
  const now = new Date().toISOString();
  if (changes.isDefault) await auth.context.db.update(knowledgeSavedViews).set({ isDefault: false, updatedAt: now }).where(and(eq(knowledgeSavedViews.organizationId, auth.context.organizationId), eq(knowledgeSavedViews.ownerUserId, auth.context.actor.id), eq(knowledgeSavedViews.scope, auth.view.scope)));
  const [view] = await auth.context.db.update(knowledgeSavedViews).set({ ...changes, updatedAt: now }).where(and(eq(knowledgeSavedViews.id, auth.view.id), eq(knowledgeSavedViews.organizationId, auth.context.organizationId))).returning();
  await auth.context.db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId: auth.context.organizationId, actorUserId: auth.context.actor.id, actorType: "user", action: "knowledge_view.update", resourceType: "knowledge_saved_view", resourceId: auth.view.id, result: "allowed", risk: auth.view.scope === "team" ? "medium" : "low", metadataJson: JSON.stringify({ changes }) });
  return Response.json({ view, canEdit: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await findView(request, (await context.params).id);
  if ("response" in auth) return auth.response;
  await auth.context.db.delete(knowledgeSavedViews).where(and(eq(knowledgeSavedViews.id, auth.view.id), eq(knowledgeSavedViews.organizationId, auth.context.organizationId)));
  await auth.context.db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId: auth.context.organizationId, actorUserId: auth.context.actor.id, actorType: "user", action: "knowledge_view.delete", resourceType: "knowledge_saved_view", resourceId: auth.view.id, result: "allowed", risk: auth.view.scope === "team" ? "medium" : "low", metadataJson: JSON.stringify({ scope: auth.view.scope }) });
  return Response.json({ ok: true, deleted: auth.view.id });
}
