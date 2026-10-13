import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, ticketSavedViews } from "../../../../db/schema";
import { authenticatedEmail, actorFor, isSupervisor } from "../../../../lib/request-auth";
import { tenantIdForRequest } from "../../../../lib/tenant";

async function authorized(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return { error: Response.json({ error: "Authentication required" }, { status: 401 }) } as const;
  const organizationId = tenantIdForRequest(request);
  const db = getDb();
  const actor = await actorFor(db, organizationId, email);
  if (!actor) return { error: Response.json({ error: "当前账号没有该工作空间的工单权限" }, { status: 403 }) } as const;
  return { db, actor, email, organizationId } as const;
}

async function findView(request: Request, id: string) {
  const auth = await authorized(request);
  if ("error" in auth) return auth;
  const [view] = await auth.db.select().from(ticketSavedViews).where(and(eq(ticketSavedViews.id, id), eq(ticketSavedViews.organizationId, auth.organizationId))).limit(1);
  if (!view) return { error: Response.json({ error: "视图不存在或不属于当前工作空间" }, { status: 404 }) } as const;
  const canEdit = view.scope === "team" ? isSupervisor(auth.actor.role) : view.ownerUserId === auth.actor.id;
  if (!canEdit) return { error: Response.json({ error: "你没有编辑该视图的权限" }, { status: 403 }) } as const;
  return { ...auth, view } as const;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await findView(request, (await context.params).id);
  if ("error" in auth) return auth.error;
  let payload: { name?: string; isDefault?: boolean };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const changes: Partial<typeof ticketSavedViews.$inferInsert> = {};
  if (typeof payload.name === "string") {
    const name = payload.name.trim().slice(0, 40);
    if (!name) return Response.json({ error: "视图名称不能为空" }, { status: 400 });
    changes.name = name;
  }
  if (typeof payload.isDefault === "boolean") changes.isDefault = payload.isDefault;
  if (!Object.keys(changes).length) return Response.json({ error: "没有可更新的视图字段" }, { status: 400 });
  const now = new Date().toISOString();
  if (changes.isDefault) await auth.db.update(ticketSavedViews).set({ isDefault: false, updatedAt: now }).where(and(eq(ticketSavedViews.organizationId, auth.organizationId), eq(ticketSavedViews.ownerUserId, auth.view.ownerUserId), eq(ticketSavedViews.scope, auth.view.scope)));
  const [view] = await auth.db.update(ticketSavedViews).set({ ...changes, updatedAt: now }).where(and(eq(ticketSavedViews.id, auth.view.id), eq(ticketSavedViews.organizationId, auth.organizationId))).returning();
  await auth.db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId: auth.organizationId, actorUserId: auth.actor.id, actorType: "user", action: "ticket_view.update", resourceType: "ticket_saved_view", resourceId: auth.view.id, result: "allowed", risk: auth.view.scope === "team" ? "medium" : "low", metadataJson: JSON.stringify({ email: auth.email, changes }) });
  return Response.json({ view, canEdit: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await findView(request, (await context.params).id);
  if ("error" in auth) return auth.error;
  await auth.db.delete(ticketSavedViews).where(and(eq(ticketSavedViews.id, auth.view.id), eq(ticketSavedViews.organizationId, auth.organizationId)));
  await auth.db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId: auth.organizationId, actorUserId: auth.actor.id, actorType: "user", action: "ticket_view.delete", resourceType: "ticket_saved_view", resourceId: auth.view.id, result: "allowed", risk: auth.view.scope === "team" ? "medium" : "low", metadataJson: JSON.stringify({ email: auth.email, scope: auth.view.scope }) });
  return Response.json({ ok: true, deleted: auth.view.id });
}

