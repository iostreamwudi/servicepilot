import { and, desc, eq, gte } from "drizzle-orm";
import { agentRuns, auditLogs, conversations, knowledgeDocuments, knowledgeVersions, messages } from "../../../../db/schema";
import { requireKnowledgeActor } from "../../../../lib/knowledge-auth";

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

type KnowledgeRun = { id?: string; version?: string; confidence?: number };
type Citation = { id?: string };

export async function GET(request: Request) {
  const auth = await requireKnowledgeActor(request);
  if ("response" in auth) return auth.response;
  const { db, organizationId } = auth.context;
  const url = new URL(request.url);
  const knowledgeId = url.searchParams.get("knowledgeId")?.trim();
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30) || 30, 7), 90);
  if (!knowledgeId) return Response.json({ error: "knowledgeId is required" }, { status: 400 });
  const [document] = await db.select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title, version: knowledgeDocuments.version }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, knowledgeId), eq(knowledgeDocuments.organizationId, organizationId))).limit(1);
  if (!document) return Response.json({ error: "Knowledge document not found" }, { status: 404 });
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const [runs, aiMessages, feedback, versions] = await Promise.all([
    db.select().from(agentRuns).where(and(eq(agentRuns.organizationId, organizationId), gte(agentRuns.createdAt, since))).orderBy(desc(agentRuns.createdAt)).limit(5000),
    db.select({ conversationId: messages.conversationId, citationsJson: messages.citationsJson, createdAt: messages.createdAt }).from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id)).where(and(eq(conversations.organizationId, organizationId), eq(messages.senderType, "ai"), gte(messages.createdAt, since))).orderBy(desc(messages.createdAt)).limit(5000),
    db.select({ id: auditLogs.id, metadataJson: auditLogs.metadataJson, createdAt: auditLogs.createdAt }).from(auditLogs).where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.action, "knowledge.feedback"), eq(auditLogs.resourceId, knowledgeId), gte(auditLogs.createdAt, since))).orderBy(desc(auditLogs.createdAt)).limit(5000),
    db.select({ id: knowledgeVersions.id, version: knowledgeVersions.version, state: knowledgeVersions.state, createdAt: knowledgeVersions.createdAt }).from(knowledgeVersions).where(and(eq(knowledgeVersions.organizationId, organizationId), eq(knowledgeVersions.documentId, knowledgeId))).orderBy(desc(knowledgeVersions.createdAt)).limit(20),
  ]);
  const matchedRuns = runs.filter((run) => parseJson<KnowledgeRun[]>(run.knowledgeJson, []).some((item) => item.id === knowledgeId));
  const zeroResultRuns = runs.filter((run) => parseJson<KnowledgeRun[]>(run.knowledgeJson, []).length === 0);
  const citationMessages = aiMessages.filter((message) => parseJson<Citation[]>(message.citationsJson, []).some((citation) => citation.id === knowledgeId));
  const relatedConversationIds = new Set(matchedRuns.map((run) => run.conversationId).filter((id): id is string => Boolean(id)));
  const versionStats = new Map<string, { version: string; hitCount: number; handoffCount: number; totalTokens: number; latencyMs: number }>();
  for (const run of matchedRuns) {
    const version = parseJson<KnowledgeRun[]>(run.knowledgeJson, []).find((item) => item.id === knowledgeId)?.version ?? "未知版本";
    const current = versionStats.get(version) ?? { version, hitCount: 0, handoffCount: 0, totalTokens: 0, latencyMs: 0 };
    current.hitCount += 1;
    current.handoffCount += run.handoff ? 1 : 0;
    current.totalTokens += run.totalTokens ?? 0;
    current.latencyMs += run.latencyMs ?? 0;
    versionStats.set(version, current);
  }
  const versionComparison = [...versionStats.values()].map((item) => ({ ...item, handoffRate: item.hitCount ? item.handoffCount / item.hitCount : 0, averageLatencyMs: item.hitCount ? Math.round(item.latencyMs / item.hitCount) : 0 })).sort((a, b) => b.hitCount - a.hitCount);
  const hitCount = matchedRuns.length;
  const totalRuns = runs.length;
  const feedbackCount = feedback.length;
  const promptTokens = matchedRuns.reduce((sum, run) => sum + (run.promptTokens ?? 0), 0);
  const completionTokens = matchedRuns.reduce((sum, run) => sum + (run.completionTokens ?? 0), 0);
  return Response.json({
    document,
    window: { days, since, until: new Date().toISOString() },
    metrics: {
      hitCount,
      totalRuns,
      zeroResultCount: zeroResultRuns.length,
      zeroResultRate: totalRuns ? zeroResultRuns.length / totalRuns : 0,
      citationCount: citationMessages.length,
      citationRate: hitCount ? citationMessages.length / hitCount : 0,
      feedbackCount,
      negativeFeedbackRate: hitCount ? feedbackCount / hitCount : 0,
      handoffCount: matchedRuns.filter((run) => Boolean(run.handoff)).length,
      handoffRate: hitCount ? matchedRuns.filter((run) => Boolean(run.handoff)).length / hitCount : 0,
      relatedConversationCount: relatedConversationIds.size,
    },
    versionComparison,
    versions,
    costImpact: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, estimatedUsd: null, note: "当前工作区未配置模型单价，仅展示真实 token 消耗和延迟。" },
  });
}
