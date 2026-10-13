import { and, asc, count, desc, eq, gt, inArray, isNull, like, lte, or } from "drizzle-orm";
import { auditLogs, knowledgeDocuments, knowledgeSourceSnapshots, knowledgeVersions } from "../../../db/schema";
import { KNOWLEDGE_EDITOR_ROLES, canReadKnowledgeState, requireKnowledgeActor } from "../../../lib/knowledge-auth";
import { sha256Hex } from "../../../lib/content-hash";
import { knowledgeSourceFreshness, knowledgeSourceFreshnessLabel, knowledgeValidity, knowledgeValidityLabel } from "../../../lib/knowledge-validity";
import { detectKnowledgeConflicts } from "../../../lib/knowledge-conflicts";
import { searchKnowledgeIds, syncKnowledgeSearchIndex } from "../../../lib/knowledge-search";

export async function GET(request: Request) {
  const auth = await requireKnowledgeActor(request);
  if ("response" in auth) return auth.response;
  const { db, organizationId, actor } = auth.context;
  const state = new URL(request.url).searchParams.get("state");
  const category = new URL(request.url).searchParams.get("category");
  const owner = new URL(request.url).searchParams.get("owner");
  if (state && !["draft", "review", "active", "archived"].includes(state)) {
    return Response.json({ error: "Invalid state" }, { status: 400 });
  }
  if (state && !canReadKnowledgeState(actor.role, state)) {
    return Response.json({ error: "当前角色只能查看已生效知识" }, { status: 403 });
  }
  if (category && !["refund", "damage", "address", "invoice"].includes(category)) {
    return Response.json({ error: "Invalid category" }, { status: 400 });
  }
  if (owner && !["mine", "unassigned"].includes(owner)) return Response.json({ error: "Invalid owner" }, { status: 400 });
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
    const sort = url.searchParams.get("sort") ?? "updated";
    if (!["updated", "coverage", "risk", "category"].includes(sort)) return Response.json({ error: "Invalid sort" }, { status: 400 });
    let condition = eq(knowledgeDocuments.organizationId, organizationId);
    const now = new Date().toISOString();
    const effectiveWindow = and(or(isNull(knowledgeDocuments.validFrom), lte(knowledgeDocuments.validFrom, now)), or(isNull(knowledgeDocuments.validUntil), gt(knowledgeDocuments.validUntil, now))) ?? condition;
    if (!canReadKnowledgeState(actor.role, "draft")) condition = and(condition, eq(knowledgeDocuments.state, "active"), effectiveWindow) ?? condition;
    if (state) condition = and(condition, eq(knowledgeDocuments.state, state as "draft" | "review" | "active" | "archived")) ?? condition;
    if (category) condition = and(condition, eq(knowledgeDocuments.category, category as "refund" | "damage" | "address" | "invoice")) ?? condition;
    if (owner === "mine") condition = and(condition, eq(knowledgeDocuments.ownerUserId, actor.id)) ?? condition;
    if (owner === "unassigned") condition = and(condition, isNull(knowledgeDocuments.ownerUserId)) ?? condition;
    if (query) {
      const fullTextIds = await searchKnowledgeIds(db, organizationId, query);
      const searchCondition = fullTextIds?.length
        ? inArray(knowledgeDocuments.id, fullTextIds)
        : or(
          like(knowledgeDocuments.title, `%${query}%`),
          like(knowledgeDocuments.content, `%${query}%`),
          like(knowledgeDocuments.ownerTeam, `%${query}%`),
          like(knowledgeDocuments.sourceTitle, `%${query}%`),
        );
      condition = and(condition, searchCondition) ?? condition;
    }
    const documents = await db.select().from(knowledgeDocuments).where(condition).orderBy(sort === "coverage" ? desc(knowledgeDocuments.coverage) : sort === "risk" ? asc(knowledgeDocuments.risk) : sort === "category" ? asc(knowledgeDocuments.category) : desc(knowledgeDocuments.updatedAt), asc(knowledgeDocuments.id)).limit(limit).offset(offset);
    const snapshotRows = documents.length ? await db.select().from(knowledgeSourceSnapshots).where(and(eq(knowledgeSourceSnapshots.organizationId, organizationId), inArray(knowledgeSourceSnapshots.documentId, documents.map((document) => document.id)))).orderBy(desc(knowledgeSourceSnapshots.createdAt)) : [];
    const latestSnapshots = new Map<string, typeof snapshotRows[number]>();
    snapshotRows.forEach((snapshot) => { if (!latestSnapshots.has(snapshot.documentId)) latestSnapshots.set(snapshot.documentId, snapshot); });
    const [totalRow] = await db.select({ value: count() }).from(knowledgeDocuments).where(condition);
    const visibleCondition = !canReadKnowledgeState(actor.role, "draft") ? and(eq(knowledgeDocuments.state, "active"), effectiveWindow) : eq(knowledgeDocuments.organizationId, organizationId);
    const stateRows = await db.select({ state: knowledgeDocuments.state, value: count() }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, organizationId), visibleCondition)).groupBy(knowledgeDocuments.state);
    const stateCounts = Object.fromEntries(stateRows.map((row) => [row.state, row.value]));
    const sourceRows = await db.select({ sourceType: knowledgeDocuments.sourceType, value: count() }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, organizationId), visibleCondition)).groupBy(knowledgeDocuments.sourceType);
    const sourceCounts = Object.fromEntries(sourceRows.map((row) => [row.sourceType, row.value]));
    return Response.json({
      version: "2026.07-scale-2",
      total: totalRow.value,
      offset,
      limit,
      sort,
      stats: { total: Object.values(stateCounts).reduce((sum, value) => sum + value, 0), active: stateCounts.active ?? 0, review: stateCounts.review ?? 0, draft: stateCounts.draft ?? 0, archived: stateCounts.archived ?? 0, official: sourceCounts.official ?? 0, internalDemo: sourceCounts.internal_demo ?? 0 },
      documents: documents.map((document) => ({
        ...document,
        sourceFetchedAt: latestSnapshots.get(document.id)?.fetchedAt ?? null,
        sourceSyncStatus: latestSnapshots.get(document.id)?.syncStatus ?? null,
        sourceFreshnessStatus: knowledgeSourceFreshness(latestSnapshots.get(document.id)?.fetchedAt, latestSnapshots.get(document.id)?.syncStatus),
        sourceFreshnessLabel: knowledgeSourceFreshnessLabel[knowledgeSourceFreshness(latestSnapshots.get(document.id)?.fetchedAt, latestSnapshots.get(document.id)?.syncStatus)],
        validityStatus: knowledgeValidity(document.validFrom, document.validUntil),
        validityLabel: knowledgeValidityLabel[knowledgeValidity(document.validFrom, document.validUntil)],
        keywords: JSON.parse(document.keywordsJson) as string[],
        keywordsJson: undefined,
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected database error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireKnowledgeActor(request, KNOWLEDGE_EDITOR_ROLES);
  if ("response" in auth) return auth.response;
  const { db, organizationId, actor } = auth.context;
  let payload: { title?: string; content?: string; category?: string; ownerTeam?: string; keywords?: string[]; risk?: string; handoff?: boolean; sourceType?: string; sourceTitle?: string; sourceUrl?: string; validFrom?: string | null; validUntil?: string | null; changeSummary?: string };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const title = payload.title?.trim();
  const content = payload.content?.trim();
  const ownerTeam = payload.ownerTeam?.trim();
  if (!title || !content || !ownerTeam) return Response.json({ error: "title、content、ownerTeam 均为必填项" }, { status: 400 });
  if (!payload.category || !["refund", "damage", "address", "invoice"].includes(payload.category)) return Response.json({ error: "Invalid category" }, { status: 400 });
  if (!payload.risk || !["low", "medium", "high"].includes(payload.risk)) return Response.json({ error: "Invalid risk" }, { status: 400 });
  const sameCategory = await db.select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title, content: knowledgeDocuments.content, category: knowledgeDocuments.category }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, organizationId), eq(knowledgeDocuments.category, payload.category as "refund" | "damage" | "address" | "invoice")));
  const conflicts = detectKnowledgeConflicts({ title, content, category: payload.category }, sameCategory);
  if (conflicts.length) return Response.json({ error: "检测到重复或口径冲突，请先处理冲突后再保存", conflicts }, { status: 409 });
  const id = `KB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const now = new Date().toISOString();
  const keywords = Array.isArray(payload.keywords) ? payload.keywords.map((item) => item.trim()).filter(Boolean).slice(0, 20) : [];
  const values = { id, organizationId, title: title.slice(0, 160), version: "v1.0", ownerTeam: ownerTeam.slice(0, 80), content: content.slice(0, 8000), category: payload.category as "refund" | "damage" | "address" | "invoice", keywordsJson: JSON.stringify(keywords), risk: payload.risk as "low" | "medium" | "high", handoff: Boolean(payload.handoff), sourceType: (payload.sourceType && ["official", "internal_demo", "generated-internal-review"].includes(payload.sourceType) ? payload.sourceType : "internal_demo") as "official" | "internal_demo" | "generated-internal-review", sourceTitle: payload.sourceTitle?.trim().slice(0, 200) || null, sourceUrl: payload.sourceUrl?.trim().slice(0, 500) || null, state: "draft" as const, coverage: 0, validFrom: payload.validFrom || null, validUntil: payload.validUntil || null, isSynthetic: false, updatedAt: now };
  await db.insert(knowledgeDocuments).values(values);
  await syncKnowledgeSearchIndex(db, values);
  const versionId = `${id}-v1-0`;
  await db.insert(knowledgeVersions).values({ id: versionId, organizationId, documentId: id, version: "v1.0", title: values.title, ownerTeam: values.ownerTeam, content: values.content, category: values.category, keywordsJson: values.keywordsJson, risk: values.risk, handoff: values.handoff, sourceType: values.sourceType, sourceTitle: values.sourceTitle, sourceUrl: values.sourceUrl, state: "draft", coverage: 0, validFrom: values.validFrom, validUntil: values.validUntil, createdByUserId: actor.id, publishedByUserId: null, releasePercent: 0, changeSummary: payload.changeSummary?.trim().slice(0, 500) || "新建知识草稿", createdAt: now, publishedAt: null });
  await db.insert(knowledgeSourceSnapshots).values({ id: `SOURCE-${id}-v1-0`, organizationId, documentId: id, versionId, sourceType: values.sourceType, sourceTitle: values.sourceTitle, sourceUrl: values.sourceUrl, sourceVersion: "v1.0", contentHash: await sha256Hex(values.content), snapshotContent: values.content, syncStatus: "captured", fetchedAt: now, createdByUserId: actor.id, createdAt: now });
  await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.create", resourceType: "knowledge_document", resourceId: id, result: "allowed", risk: values.risk, metadataJson: JSON.stringify({ version: "v1.0", state: "draft" }) });
  return Response.json({ document: { ...values, keywords }, version: "v1.0" }, { status: 201 });
}
