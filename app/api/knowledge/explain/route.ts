import { and, desc, eq, gte } from "drizzle-orm";
import { agentRuns, knowledgeDocuments } from "../../../../db/schema";
import { requireKnowledgeActor } from "../../../../lib/knowledge-auth";
import { deriveKnowledgeBusinessMetadata, parentIdForDocument } from "../../../../lib/retrieval";

type KnowledgeRun = { id?: string; title?: string; version?: string; confidence?: number };
type TraceStep = { type?: string; label?: string; indexVersion?: string; rerankProvider?: string; filterReasons?: string[] };

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

export async function GET(request: Request) {
  const auth = await requireKnowledgeActor(request);
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const knowledgeId = url.searchParams.get("knowledgeId")?.trim();
  if (!knowledgeId) return Response.json({ error: "knowledgeId is required" }, { status: 400 });
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 90) || 90, 7), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { db, organizationId } = auth.context;
  const [document] = await db.select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title, version: knowledgeDocuments.version, category: knowledgeDocuments.category, keywordsJson: knowledgeDocuments.keywordsJson, state: knowledgeDocuments.state, validFrom: knowledgeDocuments.validFrom, validUntil: knowledgeDocuments.validUntil, sourceTitle: knowledgeDocuments.sourceTitle, sourceUrl: knowledgeDocuments.sourceUrl }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, knowledgeId), eq(knowledgeDocuments.organizationId, organizationId))).limit(1);
  if (!document) return Response.json({ error: "知识资产不存在或不可见" }, { status: 404 });
  const runs = await db.select({ id: agentRuns.id, query: agentRuns.query, intent: agentRuns.intent, knowledgeJson: agentRuns.knowledgeJson, traceJson: agentRuns.traceJson, createdAt: agentRuns.createdAt }).from(agentRuns).where(and(eq(agentRuns.organizationId, organizationId), gte(agentRuns.createdAt, since))).orderBy(desc(agentRuns.createdAt)).limit(5000);
  const matchedRuns = runs.filter((run) => parseJson<KnowledgeRun[]>(run.knowledgeJson, []).some((item) => item.id === knowledgeId));
  const keywords = parseJson<string[]>(document.keywordsJson, []).filter(Boolean);
  const keywordHits = new Map<string, number>();
  const intents = new Map<string, number>();
  const queries: string[] = [];
  const indexVersions = new Set<string>();
  const retrievalEvidence = new Map<string, { label: string; count: number; indexVersion?: string; provider?: string }>();
  for (const run of matchedRuns) {
    if (run.intent) intents.set(run.intent, (intents.get(run.intent) ?? 0) + 1);
    const normalizedQuery = run.query.toLowerCase().replace(/\s+/g, "");
    for (const keyword of keywords) if (normalizedQuery.includes(keyword.toLowerCase().replace(/\s+/g, ""))) keywordHits.set(keyword, (keywordHits.get(keyword) ?? 0) + 1);
    if (queries.length < 5 && run.query.trim()) queries.push(run.query.trim());
    for (const step of parseJson<TraceStep[]>(run.traceJson, [])) {
      if (!step.type?.startsWith("retrieval") || !step.label) continue;
      if (step.indexVersion) indexVersions.add(step.indexVersion);
      const current = retrievalEvidence.get(step.label);
      retrievalEvidence.set(step.label, current ? { ...current, count: current.count + 1 } : { label: step.label, count: 1, indexVersion: step.indexVersion, provider: step.rerankProvider });
    }
  }
  const businessMetadata = deriveKnowledgeBusinessMetadata({ id: document.id, title: document.title, content: `${document.title}；${keywords.join("、")}`, category: document.category });
  return Response.json({
    document: { id: document.id, title: document.title, version: document.version, state: document.state, category: document.category, sourceTitle: document.sourceTitle, sourceUrl: document.sourceUrl },
    window: { days, since, until: new Date().toISOString() },
    explanation: {
      hitRuns: matchedRuns.length,
      averageConfidence: matchedRuns.length ? matchedRuns.reduce((sum, run) => sum + (parseJson<KnowledgeRun[]>(run.knowledgeJson, []).find((item) => item.id === knowledgeId)?.confidence ?? 0), 0) / matchedRuns.length : 0,
      keywordHits: [...keywordHits.entries()].sort((left, right) => right[1] - left[1]).map(([keyword, count]) => ({ keyword, count })),
      intents: [...intents.entries()].sort((left, right) => right[1] - left[1]).map(([intent, count]) => ({ intent, count })),
      queries,
      retrievalEvidence: [...retrievalEvidence.values()].sort((left, right) => right.count - left.count).slice(0, 8),
      indexVersions: [...indexVersions],
    },
    governance: {
      parentId: parentIdForDocument(document.id),
      relation: businessMetadata.relation,
      businessActions: businessMetadata.businessActions,
      conditionSignals: businessMetadata.conditionSignals,
      filterNotes: [
        "候选只来自当前组织的有效运行记录",
        document.state !== "active" ? "当前知识不是线上 active 状态" : null,
        document.validFrom && new Date(document.validFrom).getTime() > Date.now() ? "知识尚未到生效时间" : null,
        document.validUntil && new Date(document.validUntil).getTime() <= Date.now() ? "知识已超过有效期" : null,
      ].filter(Boolean),
    },
  });
}
