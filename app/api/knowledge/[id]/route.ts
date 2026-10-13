import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, knowledgeConflicts, knowledgeDocuments, knowledgeSourceSnapshots, knowledgeVersions } from "../../../../db/schema";
import { KNOWLEDGE_EDITOR_ROLES, KNOWLEDGE_PUBLISHER_ROLES, findReadableKnowledge, requireKnowledgeActor } from "../../../../lib/knowledge-auth";
import { sha256Hex } from "../../../../lib/content-hash";
import { knowledgeValidity, knowledgeValidityLabel } from "../../../../lib/knowledge-validity";
import { detectKnowledgeConflicts } from "../../../../lib/knowledge-conflicts";
import { diffKnowledgeText } from "../../../../lib/knowledge-diff";
import { syncKnowledgeSearchIndex } from "../../../../lib/knowledge-search";

function parseKeywords(value: string) {
  try { return JSON.parse(value) as string[]; } catch { return []; }
}

function publicDocument(document: typeof knowledgeDocuments.$inferSelect) {
  const validityStatus = knowledgeValidity(document.validFrom, document.validUntil);
  return { ...document, validityStatus, validityLabel: knowledgeValidityLabel[validityStatus], keywords: parseKeywords(document.keywordsJson), keywordsJson: undefined };
}

function nextVersion(current: string) {
  const match = current.match(/^v(\d+)\.(\d+)$/);
  if (!match) return "v1.0";
  return `v${match[1]}.${Number(match[2]) + 1}`;
}

async function context(request: Request, id: string) {
  const auth = await requireKnowledgeActor(request);
  if ("response" in auth) return { error: auth.response } as const;
  const { db, organizationId, actor } = auth.context;
  const document = await findReadableKnowledge(db, organizationId, actor.role, id);
  if (!document) return { error: Response.json({ error: "Knowledge document not found" }, { status: 404 }) } as const;
  return { db, organizationId, actor, document } as const;
}

async function snapshotCurrent(db: ReturnType<typeof getDb>, organizationId: string, document: typeof knowledgeDocuments.$inferSelect, actorId: string) {
  const [existing] = await db.select({ id: knowledgeVersions.id }).from(knowledgeVersions).where(and(eq(knowledgeVersions.documentId, document.id), eq(knowledgeVersions.version, document.version))).limit(1);
  if (existing) return;
  const versionId = `${document.id}-${document.version.replace(/[^a-z0-9]+/gi, "-")}`;
  await db.insert(knowledgeVersions).values({ id: versionId, organizationId, documentId: document.id, version: document.version, title: document.title, ownerTeam: document.ownerTeam, content: document.content, category: document.category, keywordsJson: document.keywordsJson, risk: document.risk, handoff: document.handoff, sourceType: document.sourceType, sourceTitle: document.sourceTitle, sourceUrl: document.sourceUrl, state: document.state, coverage: document.coverage, validFrom: document.validFrom, validUntil: document.validUntil, createdByUserId: actorId, publishedByUserId: null, releasePercent: document.state === "active" ? 100 : 0, changeSummary: "发布前历史版本快照", publishedAt: document.state === "active" ? document.updatedAt : null });
  await db.insert(knowledgeSourceSnapshots).values({ id: `SOURCE-${document.id}-${document.version.replace(/[^a-z0-9]+/gi, "-")}`, organizationId, documentId: document.id, versionId, sourceType: document.sourceType, sourceTitle: document.sourceTitle, sourceUrl: document.sourceUrl, sourceVersion: document.version, contentHash: await sha256Hex(document.content), snapshotContent: document.content, syncStatus: "captured", fetchedAt: document.updatedAt, createdByUserId: actorId, createdAt: document.updatedAt });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await context(request, id);
  if ("error" in result) return result.error;
  const versions = await result.db.select().from(knowledgeVersions).where(and(eq(knowledgeVersions.documentId, id), eq(knowledgeVersions.organizationId, result.organizationId))).orderBy(desc(knowledgeVersions.createdAt));
  const [sourceSnapshot] = await result.db.select().from(knowledgeSourceSnapshots).where(and(eq(knowledgeSourceSnapshots.documentId, id), eq(knowledgeSourceSnapshots.organizationId, result.organizationId))).orderBy(desc(knowledgeSourceSnapshots.createdAt)).limit(1);
  const sameCategory = await result.db.select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title, content: knowledgeDocuments.content, category: knowledgeDocuments.category }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, result.organizationId), eq(knowledgeDocuments.category, result.document.category)));
  const detectedConflicts = detectKnowledgeConflicts({ id, title: result.document.title, content: result.document.content, category: result.document.category }, sameCategory);
  for (const conflict of detectedConflicts) {
    await result.db.insert(knowledgeConflicts).values({
      id: `KC-${id}-${conflict.documentId}-${conflict.kind}`,
      organizationId: result.organizationId,
      documentId: id,
      conflictingDocumentId: conflict.documentId,
      kind: conflict.kind,
      severity: conflict.severity,
      status: "open",
      title: conflict.title,
      reason: conflict.reason,
      scope: "同服务域",
      ownerUserId: result.actor.id,
      resolutionNote: "",
      resolvedByUserId: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    }).onConflictDoNothing();
  }
  const conflicts = await result.db.select().from(knowledgeConflicts).where(and(eq(knowledgeConflicts.documentId, id), eq(knowledgeConflicts.organizationId, result.organizationId))).orderBy(desc(knowledgeConflicts.createdAt));
  const auditEvidence = await result.db.select({ id: auditLogs.id, action: auditLogs.action, actorUserId: auditLogs.actorUserId, result: auditLogs.result, risk: auditLogs.risk, metadataJson: auditLogs.metadataJson, createdAt: auditLogs.createdAt }).from(auditLogs).where(and(eq(auditLogs.organizationId, result.organizationId), or(eq(auditLogs.resourceId, id), inArray(auditLogs.resourceId, conflicts.map((conflict) => conflict.id))))).orderBy(desc(auditLogs.createdAt)).limit(30);
  const compareVersionId = new URL(request.url).searchParams.get("compareVersionId");
  const compareVersion = versions.find((version) => version.id === compareVersionId);
  const versionDiff = compareVersion ? { versionId: compareVersion.id, version: compareVersion.version, lines: diffKnowledgeText(compareVersion.content, result.document.content) } : null;
  return Response.json({ document: publicDocument(result.document), versions: versions.map((version) => ({ ...version, keywords: parseKeywords(version.keywordsJson), keywordsJson: undefined })), sourceSnapshot: sourceSnapshot ?? null, conflicts, auditEvidence, versionDiff });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await context(request, id);
  if ("error" in result) return result.error;
  let payload: { action?: string; title?: string; content?: string; ownerTeam?: string; category?: string; keywords?: string[]; risk?: string; handoff?: boolean; sourceTitle?: string; sourceUrl?: string; validFrom?: string | null; validUntil?: string | null; changeSummary?: string; releasePercent?: number; versionId?: string; conflictId?: string; conflictStatus?: string; resolutionNote?: string; mergedContent?: string };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const action = payload.action;
  const { db, organizationId, actor, document } = result;
  if (action === "resolve_conflict") {
    if (!KNOWLEDGE_EDITOR_ROLES.includes(actor.role as (typeof KNOWLEDGE_EDITOR_ROLES)[number])) return Response.json({ error: "当前角色无权处理知识冲突" }, { status: 403 });
    if (!payload.conflictId || !["resolved", "false_positive"].includes(payload.conflictStatus ?? "")) return Response.json({ error: "conflictId、conflictStatus 参数无效" }, { status: 400 });
    const resolutionNote = payload.resolutionNote?.trim().slice(0, 500);
    if (!resolutionNote) return Response.json({ error: "处理冲突必须填写说明" }, { status: 400 });
    const [conflict] = await db.select().from(knowledgeConflicts).where(and(eq(knowledgeConflicts.id, payload.conflictId), eq(knowledgeConflicts.documentId, id), eq(knowledgeConflicts.organizationId, organizationId))).limit(1);
    if (!conflict) return Response.json({ error: "冲突记录不存在或不属于当前工作区" }, { status: 404 });
    const now = new Date().toISOString();
    await db.update(knowledgeConflicts).set({ status: payload.conflictStatus as "resolved" | "false_positive", resolutionNote, resolvedByUserId: actor.id, resolvedAt: now }).where(and(eq(knowledgeConflicts.id, conflict.id), eq(knowledgeConflicts.organizationId, organizationId)));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.conflict.resolve", resourceType: "knowledge_conflict", resourceId: conflict.id, result: "allowed", risk: conflict.severity, metadataJson: JSON.stringify({ documentId: id, conflictingDocumentId: conflict.conflictingDocumentId, kind: conflict.kind, status: payload.conflictStatus, scope: conflict.scope, resolutionNote }) });
    const [updatedConflict] = await db.select().from(knowledgeConflicts).where(eq(knowledgeConflicts.id, conflict.id)).limit(1);
    return Response.json({ ok: true, conflict: updatedConflict });
  }
  if (action === "merge_conflict") {
    if (!KNOWLEDGE_EDITOR_ROLES.includes(actor.role as (typeof KNOWLEDGE_EDITOR_ROLES)[number])) return Response.json({ error: "当前角色无权合并知识冲突" }, { status: 403 });
    if (!payload.conflictId) return Response.json({ error: "conflictId 参数无效" }, { status: 400 });
    const mergedContent = payload.mergedContent?.trim();
    const resolutionNote = payload.resolutionNote?.trim().slice(0, 500);
    if (!mergedContent) return Response.json({ error: "合并内容不能为空" }, { status: 400 });
    if (!resolutionNote) return Response.json({ error: "合并冲突必须填写说明" }, { status: 400 });
    if (mergedContent.length > 8000) return Response.json({ error: "合并内容不能超过 8000 字" }, { status: 400 });
    const [conflict] = await db.select().from(knowledgeConflicts).where(and(eq(knowledgeConflicts.id, payload.conflictId), eq(knowledgeConflicts.documentId, id), eq(knowledgeConflicts.organizationId, organizationId))).limit(1);
    if (!conflict) return Response.json({ error: "冲突记录不存在或不属于当前工作区" }, { status: 404 });
    const [sourceDocument] = await db.select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, conflict.conflictingDocumentId), eq(knowledgeDocuments.organizationId, organizationId))).limit(1);
    if (!sourceDocument) return Response.json({ error: "冲突来源知识不存在" }, { status: 404 });
    await snapshotCurrent(db, organizationId, document, actor.id);
    const version = nextVersion(document.version);
    const now = new Date().toISOString();
    const versionId = `${id}-${crypto.randomUUID()}`;
    await db.insert(knowledgeVersions).values({ id: versionId, organizationId, documentId: id, version, title: document.title, ownerTeam: document.ownerTeam, content: mergedContent, category: document.category, keywordsJson: document.keywordsJson, risk: document.risk, handoff: document.handoff, sourceType: document.sourceType, sourceTitle: document.sourceTitle, sourceUrl: document.sourceUrl, state: "draft", coverage: document.coverage, validFrom: document.validFrom, validUntil: document.validUntil, createdByUserId: actor.id, publishedByUserId: null, releasePercent: 0, changeSummary: `合并「${sourceDocument.title}」后的草稿`, createdAt: now, publishedAt: null });
    await db.insert(knowledgeSourceSnapshots).values({ id: `SOURCE-${versionId}`, organizationId, documentId: id, versionId, sourceType: document.sourceType, sourceTitle: document.sourceTitle, sourceUrl: document.sourceUrl, sourceVersion: version, contentHash: await sha256Hex(mergedContent), snapshotContent: mergedContent, syncStatus: "captured", fetchedAt: now, createdByUserId: actor.id, createdAt: now });
    await db.update(knowledgeDocuments).set({ version, content: mergedContent, state: "draft", updatedAt: now }).where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.organizationId, organizationId)));
    await db.update(knowledgeConflicts).set({ status: "resolved", resolutionNote, resolvedByUserId: actor.id, resolvedAt: now }).where(and(eq(knowledgeConflicts.id, conflict.id), eq(knowledgeConflicts.organizationId, organizationId)));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.conflict.merge", resourceType: "knowledge_conflict", resourceId: conflict.id, result: "allowed", risk: conflict.severity, metadataJson: JSON.stringify({ documentId: id, conflictingDocumentId: conflict.conflictingDocumentId, sourceTitle: sourceDocument.title, version, resolutionNote }) });
    const [updated] = await db.select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.organizationId, organizationId))).limit(1);
    if (updated) await syncKnowledgeSearchIndex(db, updated);
    return Response.json({ ok: true, document: updated ? publicDocument(updated) : undefined, version, conflictStatus: "resolved" });
  }
  if (action === "save_draft") {
    if (!KNOWLEDGE_EDITOR_ROLES.includes(actor.role as (typeof KNOWLEDGE_EDITOR_ROLES)[number])) return Response.json({ error: "当前角色无权编辑知识资产" }, { status: 403 });
    const title = payload.title?.trim() || document.title;
    const content = payload.content?.trim();
    if (!content) return Response.json({ error: "content is required" }, { status: 400 });
    const sameCategory = await db.select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title, content: knowledgeDocuments.content, category: knowledgeDocuments.category }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, organizationId), eq(knowledgeDocuments.category, (payload.category || document.category) as "refund" | "damage" | "address" | "invoice")));
    const conflicts = detectKnowledgeConflicts({ id, title, content, category: payload.category || document.category }, sameCategory);
    if (conflicts.length) {
      const conflictIds = conflicts.map((conflict) => `KC-${id}-${conflict.documentId}-${conflict.kind}`);
      const recorded = await db.select({ id: knowledgeConflicts.id, status: knowledgeConflicts.status }).from(knowledgeConflicts).where(and(eq(knowledgeConflicts.documentId, id), eq(knowledgeConflicts.organizationId, organizationId), inArray(knowledgeConflicts.id, conflictIds)));
      const unresolved = conflicts.filter((conflict) => recorded.find((item) => item.id === `KC-${id}-${conflict.documentId}-${conflict.kind}`)?.status !== "resolved" && recorded.find((item) => item.id === `KC-${id}-${conflict.documentId}-${conflict.kind}`)?.status !== "false_positive");
      if (unresolved.length) return Response.json({ error: "检测到重复或口径冲突，请先处理冲突后再保存", conflicts }, { status: 409 });
    }
    await snapshotCurrent(db, organizationId, document, actor.id);
    const version = nextVersion(document.version);
    const now = new Date().toISOString();
    const keywords = Array.isArray(payload.keywords) ? payload.keywords.map((item) => item.trim()).filter(Boolean).slice(0, 20) : parseKeywords(document.keywordsJson);
    const values = { organizationId, documentId: id, version, title: title.slice(0, 160), ownerTeam: (payload.ownerTeam?.trim() || document.ownerTeam).slice(0, 80), content: content.slice(0, 8000), category: (payload.category || document.category) as "refund" | "damage" | "address" | "invoice", keywordsJson: JSON.stringify(keywords), risk: (payload.risk || document.risk) as "low" | "medium" | "high", handoff: payload.handoff ?? document.handoff, sourceType: document.sourceType, sourceTitle: payload.sourceTitle?.trim() || document.sourceTitle, sourceUrl: payload.sourceUrl?.trim() || document.sourceUrl, state: "draft" as const, coverage: document.coverage, validFrom: payload.validFrom === undefined ? document.validFrom : payload.validFrom, validUntil: payload.validUntil === undefined ? document.validUntil : payload.validUntil, createdByUserId: actor.id, publishedByUserId: null, releasePercent: 0, changeSummary: payload.changeSummary?.trim().slice(0, 500) || "修订知识内容", createdAt: now, publishedAt: null };
    const versionId = `${id}-${crypto.randomUUID()}`;
    await db.insert(knowledgeVersions).values({ id: versionId, ...values });
    await db.insert(knowledgeSourceSnapshots).values({ id: `SOURCE-${versionId}`, organizationId, documentId: id, versionId, sourceType: values.sourceType, sourceTitle: values.sourceTitle, sourceUrl: values.sourceUrl, sourceVersion: version, contentHash: await sha256Hex(values.content), snapshotContent: values.content, syncStatus: "captured", fetchedAt: now, createdByUserId: actor.id, createdAt: now });
    await db.update(knowledgeDocuments).set({ title: values.title, version, ownerTeam: values.ownerTeam, content: values.content, category: values.category, keywordsJson: values.keywordsJson, risk: values.risk, handoff: values.handoff, sourceTitle: values.sourceTitle, sourceUrl: values.sourceUrl, state: "draft", validFrom: values.validFrom, validUntil: values.validUntil, updatedAt: now }).where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.organizationId, organizationId)));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.version.create", resourceType: "knowledge_document", resourceId: id, result: "allowed", risk: values.risk, metadataJson: JSON.stringify({ version, previousVersion: document.version, state: "draft" }) });
    const [updated] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id)).limit(1);
    if (!updated) return Response.json({ error: "Knowledge document update failed" }, { status: 500 });
    await syncKnowledgeSearchIndex(db, updated);
    return Response.json({ document: publicDocument(updated), version });
  }
  if (action === "claim") {
    if (!KNOWLEDGE_EDITOR_ROLES.includes(actor.role as (typeof KNOWLEDGE_EDITOR_ROLES)[number])) return Response.json({ error: "当前角色无权认领知识资产" }, { status: 403 });
    if (document.state === "archived") return Response.json({ error: "已归档知识不能认领" }, { status: 409 });
    if (document.ownerUserId && document.ownerUserId !== actor.id) return Response.json({ error: "这条知识已被其他负责人认领" }, { status: 409 });
    const now = new Date().toISOString();
    await db.update(knowledgeDocuments).set({ ownerUserId: actor.id, updatedAt: now }).where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.organizationId, organizationId)));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.claim", resourceType: "knowledge_document", resourceId: id, result: "allowed", risk: document.risk, metadataJson: JSON.stringify({ version: document.version, ownerUserId: actor.id }) });
    const [updated] = await db.select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.organizationId, organizationId))).limit(1);
    return Response.json({ ok: true, document: updated ? publicDocument(updated) : undefined, ownerUserId: actor.id });
  }
  if (action === "submit_review") {
    if (!KNOWLEDGE_EDITOR_ROLES.includes(actor.role as (typeof KNOWLEDGE_EDITOR_ROLES)[number])) return Response.json({ error: "当前角色无权提交复核" }, { status: 403 });
    if (document.state !== "draft") return Response.json({ error: "只有草稿可以提交复核" }, { status: 409 });
    await db.update(knowledgeDocuments).set({ state: "review", updatedAt: new Date().toISOString() }).where(eq(knowledgeDocuments.id, id));
    await db.update(knowledgeVersions).set({ state: "review" }).where(and(eq(knowledgeVersions.documentId, id), eq(knowledgeVersions.version, document.version)));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.review.submit", resourceType: "knowledge_document", resourceId: id, result: "allowed", risk: document.risk, metadataJson: JSON.stringify({ version: document.version }) });
    return Response.json({ ok: true, state: "review", version: document.version });
  }
  if (action === "publish") {
    if (!KNOWLEDGE_PUBLISHER_ROLES.includes(actor.role as (typeof KNOWLEDGE_PUBLISHER_ROLES)[number])) return Response.json({ error: "当前角色无权发布知识资产" }, { status: 403 });
    if (document.state !== "review") return Response.json({ error: "只有待复核版本可以发布" }, { status: 409 });
    const releasePercent = Math.min(Math.max(Number(payload.releasePercent ?? 10) || 10, 1), 100);
    const now = new Date().toISOString();
    await db.update(knowledgeVersions).set({ state: "archived", releasePercent: 0 }).where(and(eq(knowledgeVersions.documentId, id), eq(knowledgeVersions.state, "active")));
    await db.update(knowledgeVersions).set({ state: "active", releasePercent, publishedByUserId: actor.id, publishedAt: now }).where(and(eq(knowledgeVersions.documentId, id), eq(knowledgeVersions.version, document.version)));
    await db.update(knowledgeDocuments).set({ state: "active", updatedAt: now }).where(eq(knowledgeDocuments.id, id));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.publish", resourceType: "knowledge_document", resourceId: id, result: "allowed", risk: document.risk, metadataJson: JSON.stringify({ version: document.version, releasePercent }) });
    return Response.json({ ok: true, state: "active", version: document.version, releasePercent });
  }
  if (action === "rollback") {
    if (!KNOWLEDGE_PUBLISHER_ROLES.includes(actor.role as (typeof KNOWLEDGE_PUBLISHER_ROLES)[number])) return Response.json({ error: "当前角色无权回滚知识资产" }, { status: 403 });
    const [target] = await db.select().from(knowledgeVersions).where(and(eq(knowledgeVersions.id, payload.versionId || ""), eq(knowledgeVersions.documentId, id), eq(knowledgeVersions.organizationId, organizationId))).limit(1);
    if (!target) return Response.json({ error: "目标历史版本不存在" }, { status: 404 });
    if (target.version === document.version) return Response.json({ error: "不能回滚到当前版本" }, { status: 409 });
    const now = new Date().toISOString();
    await db.update(knowledgeVersions).set({ state: "rolled_back", releasePercent: 0 }).where(and(eq(knowledgeVersions.documentId, id), eq(knowledgeVersions.state, "active")));
    await db.update(knowledgeVersions).set({ state: "active", releasePercent: 100, publishedByUserId: actor.id, publishedAt: now }).where(eq(knowledgeVersions.id, target.id));
    await db.update(knowledgeDocuments).set({ title: target.title, version: target.version, ownerTeam: target.ownerTeam, content: target.content, category: target.category, keywordsJson: target.keywordsJson, risk: target.risk, handoff: target.handoff, sourceType: target.sourceType, sourceTitle: target.sourceTitle, sourceUrl: target.sourceUrl, state: "active", coverage: target.coverage, validFrom: target.validFrom, validUntil: target.validUntil, updatedAt: now }).where(eq(knowledgeDocuments.id, id));
    await syncKnowledgeSearchIndex(db, { ...document, ...target, organizationId });
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.rollback", resourceType: "knowledge_document", resourceId: id, result: "allowed", risk: target.risk, metadataJson: JSON.stringify({ version: target.version, fromVersion: document.version }) });
    return Response.json({ ok: true, state: "active", version: target.version, rolledBackFrom: document.version });
  }
  return Response.json({ error: "Unsupported knowledge action" }, { status: 400 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await context(request, id);
  if ("error" in result) return result.error;
  if (!KNOWLEDGE_EDITOR_ROLES.includes(result.actor.role as (typeof KNOWLEDGE_EDITOR_ROLES)[number])) return Response.json({ error: "当前角色无权归档知识资产" }, { status: 403 });
  const now = new Date().toISOString();
  await result.db.update(knowledgeDocuments).set({ state: "archived", updatedAt: now }).where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.organizationId, result.organizationId)));
  await result.db.update(knowledgeVersions).set({ state: "archived", releasePercent: 0 }).where(and(eq(knowledgeVersions.documentId, id), eq(knowledgeVersions.organizationId, result.organizationId), eq(knowledgeVersions.state, "active")));
  await result.db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId: result.organizationId, actorUserId: result.actor.id, actorType: "user", action: "knowledge.archive", resourceType: "knowledge_document", resourceId: id, result: "allowed", risk: result.document.risk, metadataJson: JSON.stringify({ version: result.document.version }) });
  return Response.json({ ok: true, state: "archived", version: result.document.version });
}
