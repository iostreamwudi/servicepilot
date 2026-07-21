import { and, asc, eq } from "drizzle-orm";
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
    const condition = state
      ? and(eq(knowledgeDocuments.organizationId, ORG_ID), eq(knowledgeDocuments.state, state as "draft" | "review" | "active" | "archived"))
      : eq(knowledgeDocuments.organizationId, ORG_ID);
    const documents = await db.select().from(knowledgeDocuments).where(condition).orderBy(asc(knowledgeDocuments.category), asc(knowledgeDocuments.id));
    return Response.json({
      version: "2026.07",
      total: documents.length,
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
