import { and, eq, gt, inArray, isNull, like, lte, or } from "drizzle-orm";
import { knowledgeDocuments } from "../../../../db/schema";
import { canReadKnowledgeState, requireKnowledgeActor } from "../../../../lib/knowledge-auth";
import { searchKnowledgeIds } from "../../../../lib/knowledge-search";

export async function GET(request: Request) {
  const auth = await requireKnowledgeActor(request);
  if ("response" in auth) return auth.response;
  const { db, organizationId, actor } = auth.context;
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (query.length < 2) return Response.json({ suggestions: [] });
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8) || 8, 1), 8);
  const state = url.searchParams.get("state");
  if (state && !["draft", "review", "active", "archived"].includes(state)) return Response.json({ error: "Invalid state" }, { status: 400 });
  if (state && !canReadKnowledgeState(actor.role, state)) return Response.json({ error: "当前角色只能查看已生效知识" }, { status: 403 });
  try {
    const now = new Date().toISOString();
    const effectiveWindow = and(or(isNull(knowledgeDocuments.validFrom), lte(knowledgeDocuments.validFrom, now)), or(isNull(knowledgeDocuments.validUntil), gt(knowledgeDocuments.validUntil, now)));
    let condition = and(eq(knowledgeDocuments.organizationId, organizationId), canReadKnowledgeState(actor.role, "draft") ? undefined : and(eq(knowledgeDocuments.state, "active"), effectiveWindow));
    if (state) condition = and(condition, eq(knowledgeDocuments.state, state as "draft" | "review" | "active" | "archived"));
    const fullTextIds = await searchKnowledgeIds(db, organizationId, query);
    const fallback = or(like(knowledgeDocuments.title, `%${query}%`), like(knowledgeDocuments.content, `%${query}%`), like(knowledgeDocuments.ownerTeam, `%${query}%`), like(knowledgeDocuments.sourceTitle, `%${query}%`));
    condition = and(condition, fullTextIds?.length ? inArray(knowledgeDocuments.id, fullTextIds) : fallback);
    const documents = await db.select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title, category: knowledgeDocuments.category, version: knowledgeDocuments.version }).from(knowledgeDocuments).where(condition).limit(limit);
    return Response.json({ suggestions: documents });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "知识联想读取失败" }, { status: 500 });
  }
}
