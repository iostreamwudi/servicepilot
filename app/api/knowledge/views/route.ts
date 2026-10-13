import { and, desc, eq, or } from "drizzle-orm";
import { auditLogs, knowledgeSavedViews, users } from "../../../../db/schema";
import { KNOWLEDGE_EDITOR_ROLES, requireKnowledgeActor } from "../../../../lib/knowledge-auth";

const scopes = new Set(["personal", "team"]);
const states = new Set(["all", "active", "review", "draft", "archived"]);
const categories = new Set(["all", "refund", "damage", "address", "invoice"]);
const sorts = new Set(["updated", "coverage", "risk", "category"]);

function parsePayload(payload: Record<string, unknown>) {
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 40) : "";
  if (!name) return { error: "视图名称不能为空" };
  const scope = typeof payload.scope === "string" && scopes.has(payload.scope) ? payload.scope as "personal" | "team" : "personal";
  const stateFilter = typeof payload.stateFilter === "string" && states.has(payload.stateFilter) ? payload.stateFilter : "all";
  const categoryFilter = typeof payload.categoryFilter === "string" && categories.has(payload.categoryFilter) ? payload.categoryFilter : "all";
  const sort = typeof payload.sort === "string" && sorts.has(payload.sort) ? payload.sort : "updated";
  const stringValue = (key: string, max: number) => typeof payload[key] === "string" ? payload[key].trim().slice(0, max) : "";
  return { name, scope, stateFilter, categoryFilter, sort, query: stringValue("query", 100), ownerFilter: stringValue("ownerFilter", 120), teamKey: stringValue("teamKey", 80) || null, isDefault: payload.isDefault === true };
}

export async function GET(request: Request) {
  const auth = await requireKnowledgeActor(request);
  if ("response" in auth) return auth.response;
  const { db, organizationId, actor } = auth.context;
  const rows = await db.select({ view: knowledgeSavedViews, ownerName: users.displayName, ownerEmail: users.email }).from(knowledgeSavedViews).innerJoin(users, eq(users.id, knowledgeSavedViews.ownerUserId)).where(and(eq(knowledgeSavedViews.organizationId, organizationId), or(eq(knowledgeSavedViews.ownerUserId, actor.id), eq(knowledgeSavedViews.scope, "team")))).orderBy(desc(knowledgeSavedViews.isDefault), desc(knowledgeSavedViews.updatedAt));
  return Response.json({ views: rows.map(({ view, ownerName, ownerEmail }) => ({ ...view, ownerName, ownerEmail, canEdit: view.scope === "team" ? ["supervisor", "product_admin", "system_admin"].includes(actor.role) : view.ownerUserId === actor.id })) });
}

export async function POST(request: Request) {
  const auth = await requireKnowledgeActor(request, KNOWLEDGE_EDITOR_ROLES);
  if ("response" in auth) return auth.response;
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = parsePayload(payload);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  if (parsed.scope === "team" && !["supervisor", "product_admin", "system_admin"].includes(auth.context.actor.role)) return Response.json({ error: "创建团队共享视图需要主管或管理员权限" }, { status: 403 });
  const now = new Date().toISOString();
  const id = `KV-${crypto.randomUUID()}`;
  if (parsed.isDefault) await auth.context.db.update(knowledgeSavedViews).set({ isDefault: false, updatedAt: now }).where(and(eq(knowledgeSavedViews.organizationId, auth.context.organizationId), eq(knowledgeSavedViews.ownerUserId, auth.context.actor.id), eq(knowledgeSavedViews.scope, parsed.scope)));
  const [view] = await auth.context.db.insert(knowledgeSavedViews).values({ id, organizationId: auth.context.organizationId, ownerUserId: auth.context.actor.id, ...parsed, createdAt: now, updatedAt: now }).returning();
  await auth.context.db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId: auth.context.organizationId, actorUserId: auth.context.actor.id, actorType: "user", action: "knowledge_view.create", resourceType: "knowledge_saved_view", resourceId: id, result: "allowed", risk: parsed.scope === "team" ? "medium" : "low", metadataJson: JSON.stringify({ email: auth.context.email, scope: parsed.scope }) });
  return Response.json({ view, canEdit: true }, { status: 201 });
}
