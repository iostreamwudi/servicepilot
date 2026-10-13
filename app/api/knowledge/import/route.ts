import { and, eq } from "drizzle-orm";
import { auditLogs, knowledgeDocuments, knowledgeSourceSnapshots, knowledgeVersions } from "../../../../db/schema";
import { KNOWLEDGE_EDITOR_ROLES, requireKnowledgeActor } from "../../../../lib/knowledge-auth";
import { sha256Hex } from "../../../../lib/content-hash";
import { detectKnowledgeConflicts } from "../../../../lib/knowledge-conflicts";
import { syncKnowledgeSearchIndex } from "../../../../lib/knowledge-search";

type SourceType = "official" | "internal_demo" | "generated-internal-review";

function splitSource(content: string) {
  return content.split(/\n(?=\s*#{1,3}\s)|\n{2,}/u).map((chunk) => chunk.trim()).filter(Boolean).slice(0, 20).map((chunk, index) => {
    const heading = chunk.match(/^#{1,3}\s*(.+)$/m)?.[1]?.trim();
    return { title: heading || `导入知识片段 ${index + 1}`, content: heading ? chunk.replace(/^#{1,3}\s*.+\n?/m, "").trim() : chunk };
  }).filter((item) => item.content.length >= 12);
}

export async function POST(request: Request) {
  const auth = await requireKnowledgeActor(request, KNOWLEDGE_EDITOR_ROLES);
  if ("response" in auth) return auth.response;
  const { db, organizationId, actor } = auth.context;
  let payload: { sourceType?: string; sourceTitle?: string; sourceUrl?: string; ownerTeam?: string; category?: string; content?: string; validFrom?: string | null; validUntil?: string | null };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const sourceTitle = payload.sourceTitle?.trim();
  const sourceContent = payload.content?.trim();
  const ownerTeam = payload.ownerTeam?.trim();
  if (!sourceTitle || !sourceContent || !ownerTeam) return Response.json({ error: "来源名称、资料内容和责任团队均为必填项" }, { status: 400 });
  if (!payload.category || !["refund", "damage", "address", "invoice"].includes(payload.category)) return Response.json({ error: "Invalid category" }, { status: 400 });
  const sourceType: SourceType = payload.sourceType === "official" ? "official" : payload.sourceType === "generated-internal-review" ? "generated-internal-review" : "internal_demo";
  const chunks = splitSource(sourceContent);
  if (!chunks.length) return Response.json({ error: "资料内容无法拆分为可审核知识片段，请补充至少 12 个字的正文" }, { status: 400 });
  const existing = await db.select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title, content: knowledgeDocuments.content, category: knowledgeDocuments.category }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, organizationId), eq(knowledgeDocuments.category, payload.category as "refund" | "damage" | "address" | "invoice")));
  const now = new Date().toISOString();
  const created: Array<{ id: string; title: string; version: string; state: string }> = [];
  const conflicts: Array<{ title: string; reason: string; kind: string; severity: string }> = [];
  for (const chunk of chunks) {
    const title = chunk.title.slice(0, 160);
    const detected = detectKnowledgeConflicts({ title, content: chunk.content, category: payload.category }, existing);
    if (detected.length) { conflicts.push(...detected.map((item) => ({ title, reason: item.reason, kind: item.kind, severity: item.severity }))); continue; }
    const id = `KB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const values = { id, organizationId, title, version: "v1.0", ownerTeam: ownerTeam.slice(0, 80), ownerUserId: actor.id, content: chunk.content.slice(0, 8000), category: payload.category as "refund" | "damage" | "address" | "invoice", keywordsJson: JSON.stringify([]), risk: "medium" as const, handoff: false, sourceType, sourceTitle: `${sourceTitle} · ${title}`.slice(0, 200), sourceUrl: payload.sourceUrl?.trim().slice(0, 500) || null, state: "draft" as const, coverage: 0, validFrom: payload.validFrom || null, validUntil: payload.validUntil || null, isSynthetic: false, updatedAt: now };
    await db.insert(knowledgeDocuments).values(values);
    await syncKnowledgeSearchIndex(db, values);
    const versionId = `${id}-v1-0`;
    await db.insert(knowledgeVersions).values({ id: versionId, organizationId, documentId: id, version: "v1.0", title, ownerTeam: values.ownerTeam, content: values.content, category: values.category, keywordsJson: values.keywordsJson, risk: values.risk, handoff: values.handoff, sourceType, sourceTitle: values.sourceTitle, sourceUrl: values.sourceUrl, state: "draft", coverage: 0, validFrom: values.validFrom, validUntil: values.validUntil, createdByUserId: actor.id, publishedByUserId: null, releasePercent: 0, changeSummary: "批量导入生成的知识草稿", createdAt: now, publishedAt: null });
    await db.insert(knowledgeSourceSnapshots).values({ id: `SOURCE-${id}-v1-0`, organizationId, documentId: id, versionId, sourceType, sourceTitle: values.sourceTitle, sourceUrl: values.sourceUrl, sourceVersion: "import-1", contentHash: await sha256Hex(values.content), snapshotContent: values.content, syncStatus: "captured", fetchedAt: now, createdByUserId: actor.id, createdAt: now });
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.import", resourceType: "knowledge_document", resourceId: id, result: "allowed", risk: values.risk, metadataJson: JSON.stringify({ sourceTitle, sourceType, version: "v1.0", state: "draft" }) });
    existing.push({ id, title, content: values.content, category: values.category });
    created.push({ id, title, version: "v1.0", state: "draft" });
  }
  return Response.json({ error: created.length ? undefined : "导入内容全部因重复或口径冲突而跳过，请先处理冲突", source: { title: sourceTitle, type: sourceType, contentHash: await sha256Hex(sourceContent), chunkCount: chunks.length }, created, conflicts, skipped: chunks.length - created.length }, { status: created.length ? 201 : 409 });
}
