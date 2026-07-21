import { and, asc, count, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { knowledgeDocuments } from "../../../db/schema";

const ORG_ID = "org-qingyu";

function authenticated(request: Request) {
  const host = new URL(request.url).hostname;
  return Boolean(request.headers.get("oai-authenticated-user-email")) || host === "localhost" || host === "127.0.0.1";
}

export async function GET(request: Request) {
  if (!authenticated(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const state = new URL(request.url).searchParams.get("state");
  if (state && !["draft", "review", "active", "archived"].includes(state)) {
    return Response.json({ error: "Invalid state" }, { status: 400 });
  }
  try {
    const db = getDb();
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
    let condition = eq(knowledgeDocuments.organizationId, ORG_ID);
    if (state) condition = and(condition, eq(knowledgeDocuments.state, state as "draft" | "review" | "active" | "archived")) ?? condition;
    if (query) condition = and(condition, or(
      like(knowledgeDocuments.title, `%${query}%`),
      like(knowledgeDocuments.content, `%${query}%`),
      like(knowledgeDocuments.ownerTeam, `%${query}%`),
      like(knowledgeDocuments.sourceTitle, `%${query}%`),
    )) ?? condition;
    const documents = await db.select().from(knowledgeDocuments).where(condition).orderBy(asc(knowledgeDocuments.category), asc(knowledgeDocuments.id)).limit(limit).offset(offset);
    const [totalRow] = await db.select({ value: count() }).from(knowledgeDocuments).where(condition);
    const stateRows = await db.select({ state: knowledgeDocuments.state, value: count() }).from(knowledgeDocuments).where(eq(knowledgeDocuments.organizationId, ORG_ID)).groupBy(knowledgeDocuments.state);
    const stateCounts = Object.fromEntries(stateRows.map((row) => [row.state, row.value]));
    const sourceRows = await db.select({ sourceType: knowledgeDocuments.sourceType, value: count() }).from(knowledgeDocuments).where(eq(knowledgeDocuments.organizationId, ORG_ID)).groupBy(knowledgeDocuments.sourceType);
    const sourceCounts = Object.fromEntries(sourceRows.map((row) => [row.sourceType, row.value]));
    return Response.json({
      version: "2026.07-scale-2",
      total: totalRow.value,
      offset,
      limit,
      stats: { total: Object.values(stateCounts).reduce((sum, value) => sum + value, 0), active: stateCounts.active ?? 0, review: stateCounts.review ?? 0, draft: stateCounts.draft ?? 0, archived: stateCounts.archived ?? 0, official: sourceCounts.official ?? 0, internalDemo: sourceCounts.internal_demo ?? 0 },
      documents: documents.map((document) => ({
        ...document,
        keywords: JSON.parse(document.keywordsJson) as string[],
        keywordsJson: undefined,
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected database error" }, { status: 500 });
  }
}
