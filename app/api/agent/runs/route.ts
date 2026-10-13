import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { agentRuns } from "../../../../db/schema";
import { tenantIdForRequest } from "../../../../lib/tenant";

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

function parseJson(value: string) {
  try { return JSON.parse(value); } catch { return []; }
}

export async function GET(request: Request) {
  if (!authenticatedEmail(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const url = new URL(request.url);
  const traceId = url.searchParams.get("traceId")?.trim();
  const conversationId = url.searchParams.get("conversationId")?.trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);
  const organizationId = tenantIdForRequest(request);
  const db = getDb();
  const condition = traceId ? and(eq(agentRuns.organizationId, organizationId), eq(agentRuns.traceId, traceId)) : conversationId ? and(eq(agentRuns.organizationId, organizationId), eq(agentRuns.conversationId, conversationId)) : eq(agentRuns.organizationId, organizationId);
  const rows = await db.select().from(agentRuns).where(condition).orderBy(desc(agentRuns.createdAt)).limit(limit);
  return Response.json({ runs: rows.map((row) => ({ ...row, knowledge: parseJson(row.knowledgeJson), toolCalls: parseJson(row.toolCallsJson), trace: parseJson(row.traceJson) })) });
}
