import { and, asc, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { auditLogs, knowledgeDocuments } from "../../../../db/schema";
import { KNOWLEDGE_EDITOR_ROLES, requireKnowledgeActor } from "../../../../lib/knowledge-auth";
import { searchKnowledgeIds } from "../../../../lib/knowledge-search";

const categories = new Set(["refund", "damage", "address", "invoice"]);
const states = new Set(["draft", "review", "active", "archived"]);
const sorts = new Set(["updated", "coverage", "risk", "category"]);

function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/[\r\n]+/g, " ");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function POST(request: Request) {
  const auth = await requireKnowledgeActor(request, KNOWLEDGE_EDITOR_ROLES);
  if ("response" in auth) return auth.response;
  const { db, organizationId, actor, email } = auth.context;
  let payload: { ids?: unknown; q?: unknown; state?: unknown; category?: unknown; owner?: unknown; sort?: unknown };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "导出参数格式不正确" }, { status: 400 }); }
  const ids = Array.isArray(payload.ids) ? payload.ids.filter((id): id is string => typeof id === "string" && /^KB-[A-Za-z0-9-]{1,120}$/.test(id)).slice(0, 500) : [];
  if (Array.isArray(payload.ids) && payload.ids.length > 500) return Response.json({ error: "已选导出最多支持 500 条知识" }, { status: 400 });
  const state = typeof payload.state === "string" && states.has(payload.state) ? payload.state : "all";
  const category = typeof payload.category === "string" && categories.has(payload.category) ? payload.category : "all";
  const owner = payload.owner === "mine" || payload.owner === "unassigned" ? payload.owner : "all";
  const sort = typeof payload.sort === "string" && sorts.has(payload.sort) ? payload.sort : "updated";
  const query = typeof payload.q === "string" ? payload.q.trim().slice(0, 80) : "";
  let condition = eq(knowledgeDocuments.organizationId, organizationId);
  if (ids.length) condition = and(condition, inArray(knowledgeDocuments.id, ids)) ?? condition;
  if (state !== "all") condition = and(condition, eq(knowledgeDocuments.state, state as "draft" | "review" | "active" | "archived")) ?? condition;
  if (category !== "all") condition = and(condition, eq(knowledgeDocuments.category, category as "refund" | "damage" | "address" | "invoice")) ?? condition;
  if (owner === "mine") condition = and(condition, eq(knowledgeDocuments.ownerUserId, actor.id)) ?? condition;
  if (owner === "unassigned") condition = and(condition, isNull(knowledgeDocuments.ownerUserId)) ?? condition;
  if (query) {
    const fullTextIds = await searchKnowledgeIds(db, organizationId, query);
    const searchCondition = fullTextIds?.length
      ? inArray(knowledgeDocuments.id, fullTextIds)
      : or(like(knowledgeDocuments.title, `%${query}%`), like(knowledgeDocuments.content, `%${query}%`), like(knowledgeDocuments.ownerTeam, `%${query}%`), like(knowledgeDocuments.sourceTitle, `%${query}%`));
    condition = and(condition, searchCondition) ?? condition;
  }
  const documents = await db.select().from(knowledgeDocuments).where(condition).orderBy(sort === "coverage" ? desc(knowledgeDocuments.coverage) : sort === "risk" ? asc(knowledgeDocuments.risk) : sort === "category" ? asc(knowledgeDocuments.category) : desc(knowledgeDocuments.updatedAt), asc(knowledgeDocuments.id)).limit(5001);
  if (documents.length > 5000) return Response.json({ error: "当前筛选超过 5000 条，请缩小范围后导出" }, { status: 409 });
  const rows = [
    ["知识编号", "标题", "状态", "责任团队", "负责人", "服务域", "风险", "覆盖率", "有效期至", "最近更新"],
    ...documents.map((document) => [document.id, document.title, document.state, document.ownerTeam, document.ownerUserId ?? "未分配", document.category, document.risk, `${Math.round(document.coverage * 100)}%`, document.validUntil ?? "未设置", document.updatedAt]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.export", resourceType: "knowledge_document", resourceId: "filtered", result: "allowed", risk: "low", metadataJson: JSON.stringify({ email, rowCount: documents.length, selected: Boolean(ids.length), state, category, owner, query }) });
  return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="servicepilot-knowledge-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
