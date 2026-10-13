import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, ticketSavedViews, users } from "../../../db/schema";
import { authenticatedEmail, actorFor, isSupervisor } from "../../../lib/request-auth";
import { tenantIdForRequest } from "../../../lib/tenant";

const scopes = new Set(["personal", "team"]);
const filters = new Set(["all", "unassigned", "in_progress", "waiting_customer", "resolved", "closed", "P1", "P2", "P3"]);
const views = new Set(["all", "mine", "unassigned", "overdue", "due_soon"]);
const sorts = new Set(["priority", "created", "updated", "sla"]);

async function authorized(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return { error: Response.json({ error: "Authentication required" }, { status: 401 }) } as const;
  const organizationId = tenantIdForRequest(request);
  const db = getDb();
  const actor = await actorFor(db, organizationId, email);
  if (!actor) return { error: Response.json({ error: "当前账号没有该工作空间的工单权限" }, { status: 403 }) } as const;
  return { db, actor, email, organizationId } as const;
}

function validPayload(payload: Record<string, unknown>) {
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 40) : "";
  const scope = typeof payload.scope === "string" && scopes.has(payload.scope) ? payload.scope as "personal" | "team" : "personal";
  const filter = typeof payload.filter === "string" && filters.has(payload.filter) ? payload.filter : "all";
  const view = typeof payload.view === "string" && views.has(payload.view) ? payload.view : "all";
  const sort = typeof payload.sort === "string" && sorts.has(payload.sort) ? payload.sort : "updated";
  const stringValue = (key: string, max: number) => typeof payload[key] === "string" ? payload[key].trim().slice(0, max) : "";
  if (!name) return { error: "视图名称不能为空" };
  return { name, scope, teamKey: stringValue("teamKey", 80) || null, filter, view, ownerFilter: stringValue("ownerFilter", 120), teamFilter: stringValue("teamFilter", 80), sort, query: stringValue("query", 100), openOnly: payload.openOnly === true, isDefault: payload.isDefault === true };
}

export async function GET(request: Request) {
  const auth = await authorized(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select({ view: ticketSavedViews, ownerName: users.displayName, ownerEmail: users.email })
    .from(ticketSavedViews).innerJoin(users, eq(users.id, ticketSavedViews.ownerUserId))
    .where(and(eq(ticketSavedViews.organizationId, auth.organizationId), or(eq(ticketSavedViews.ownerUserId, auth.actor.id), eq(ticketSavedViews.scope, "team"))))
    .orderBy(desc(ticketSavedViews.isDefault), desc(ticketSavedViews.updatedAt));
  return Response.json({ views: rows.map(({ view, ownerName, ownerEmail }) => ({ ...view, ownerName, ownerEmail, canEdit: view.scope === "team" ? isSupervisor(auth.actor.role) : view.ownerUserId === auth.actor.id })) });
}

export async function POST(request: Request) {
  const auth = await authorized(request);
  if ("error" in auth) return auth.error;
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = validPayload(payload);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  if (parsed.scope === "team" && !isSupervisor(auth.actor.role)) return Response.json({ error: "创建团队共享视图需要主管权限" }, { status: 403 });
  const id = `TV-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  if (parsed.isDefault) await auth.db.update(ticketSavedViews).set({ isDefault: false, updatedAt: now }).where(and(eq(ticketSavedViews.organizationId, auth.organizationId), eq(ticketSavedViews.ownerUserId, auth.actor.id), eq(ticketSavedViews.scope, parsed.scope)));
  const [view] = await auth.db.insert(ticketSavedViews).values({ id, organizationId: auth.organizationId, ownerUserId: auth.actor.id, ...parsed, createdAt: now, updatedAt: now }).returning();
  await auth.db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId: auth.organizationId, actorUserId: auth.actor.id, actorType: "user", action: "ticket_view.create", resourceType: "ticket_saved_view", resourceId: id, result: "allowed", risk: parsed.scope === "team" ? "medium" : "low", metadataJson: JSON.stringify({ email: auth.email, scope: parsed.scope }) });
  return Response.json({ view, canEdit: true }, { status: 201 });
}
