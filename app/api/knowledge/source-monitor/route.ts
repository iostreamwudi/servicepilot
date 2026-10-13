import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { agentRuns, auditLogs, knowledgeConflicts, knowledgeDocuments, knowledgeFeedback, knowledgeSourceRefreshRequests, knowledgeSourceSnapshots, users } from "../../../../db/schema";
import { KNOWLEDGE_EDITOR_ROLES, requireKnowledgeActor } from "../../../../lib/knowledge-auth";
import { knowledgeSourceFreshness, knowledgeSourceFreshnessLabel, knowledgeValidity, knowledgeValidityLabel } from "../../../../lib/knowledge-validity";

const requestStatuses = ["open", "queued"] as const;

function parsedKnowledgeIds(value: string): string[] {
  try { const items = JSON.parse(value) as Array<{ id?: string }>; return Array.isArray(items) ? items.map((item) => item.id).filter((id): id is string => Boolean(id)) : []; } catch { return []; }
}

export async function GET(request: Request) {
  const auth = await requireKnowledgeActor(request, KNOWLEDGE_EDITOR_ROLES);
  if ("response" in auth) return auth.response;
  const { db, organizationId } = auth.context;
  const documents = await db.select({ document: knowledgeDocuments, ownerName: users.displayName, ownerEmail: users.email }).from(knowledgeDocuments).leftJoin(users, eq(users.id, knowledgeDocuments.ownerUserId)).where(eq(knowledgeDocuments.organizationId, organizationId));
  const snapshots = await db.select().from(knowledgeSourceSnapshots).where(eq(knowledgeSourceSnapshots.organizationId, organizationId)).orderBy(desc(knowledgeSourceSnapshots.createdAt));
  const latestSnapshots = new Map<string, typeof snapshots[number]>();
  snapshots.forEach((snapshot) => { if (!latestSnapshots.has(snapshot.documentId)) latestSnapshots.set(snapshot.documentId, snapshot); });
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const [requests, feedbackRows, conflictRows, runRows] = await Promise.all([
    db.select().from(knowledgeSourceRefreshRequests).where(and(eq(knowledgeSourceRefreshRequests.organizationId, organizationId), inArray(knowledgeSourceRefreshRequests.status, requestStatuses))),
    db.select({ knowledgeId: knowledgeFeedback.knowledgeId }).from(knowledgeFeedback).where(and(eq(knowledgeFeedback.organizationId, organizationId), inArray(knowledgeFeedback.status, ["open", "in_review"]))),
    db.select({ documentId: knowledgeConflicts.documentId }).from(knowledgeConflicts).where(and(eq(knowledgeConflicts.organizationId, organizationId), eq(knowledgeConflicts.status, "open"))),
    db.select({ knowledgeJson: agentRuns.knowledgeJson }).from(agentRuns).where(and(eq(agentRuns.organizationId, organizationId), gte(agentRuns.createdAt, since))).limit(5000),
  ]);
  const pendingByDocument = new Map(requests.map((item) => [item.knowledgeId, item]));
  const feedbackByDocument = new Map<string, number>();
  feedbackRows.forEach((row) => feedbackByDocument.set(row.knowledgeId, (feedbackByDocument.get(row.knowledgeId) ?? 0) + 1));
  const conflictByDocument = new Map<string, number>();
  conflictRows.forEach((row) => conflictByDocument.set(row.documentId, (conflictByDocument.get(row.documentId) ?? 0) + 1));
  const hitByDocument = new Set(runRows.flatMap((row) => parsedKnowledgeIds(row.knowledgeJson)));
  const alerts = documents.flatMap(({ document, ownerName, ownerEmail }) => {
    if (document.state === "archived") return [];
    const snapshot = latestSnapshots.get(document.id);
    const freshnessStatus = knowledgeSourceFreshness(snapshot?.fetchedAt, snapshot?.syncStatus);
    const validityStatus = knowledgeValidity(document.validFrom, document.validUntil);
    const reasons: string[] = [];
    if (freshnessStatus === "failed") reasons.push("来源同步失败");
    if (freshnessStatus === "stale") reasons.push("来源已陈旧");
    if (freshnessStatus === "aging") reasons.push("来源需要复核");
    if (freshnessStatus === "unavailable") reasons.push("暂无来源快照");
    if (validityStatus === "expired") reasons.push("知识已过期");
    if (validityStatus === "expiring") reasons.push("知识即将到期");
    const feedbackCount = feedbackByDocument.get(document.id) ?? 0;
    const conflictCount = conflictByDocument.get(document.id) ?? 0;
    if (feedbackCount) reasons.push(`${feedbackCount} 条待处理反馈`);
    if (conflictCount) reasons.push(`${conflictCount} 条冲突未处理`);
    if (document.state === "active" && !hitByDocument.has(document.id)) reasons.push("近90天无命中");
    if (!reasons.length) return [];
    return [{ id: `${document.id}:${freshnessStatus}:${validityStatus}:${feedbackCount}:${conflictCount}:${hitByDocument.has(document.id)}`, knowledgeId: document.id, title: document.title, state: document.state, ownerUserId: document.ownerUserId, ownerName: ownerName ?? "待分配", ownerEmail: ownerEmail ?? null, sourceTitle: document.sourceTitle, sourceUrl: document.sourceUrl, sourceFetchedAt: snapshot?.fetchedAt ?? null, sourceSyncStatus: snapshot?.syncStatus ?? null, sourceFreshnessStatus: freshnessStatus, sourceFreshnessLabel: knowledgeSourceFreshnessLabel[freshnessStatus], validityStatus, validityLabel: knowledgeValidityLabel[validityStatus], validUntil: document.validUntil, reasons, severity: freshnessStatus === "failed" || freshnessStatus === "unavailable" || validityStatus === "expired" || conflictCount > 0 || feedbackCount >= 3 ? "high" : freshnessStatus === "stale" || validityStatus === "expiring" || feedbackCount > 0 || (document.state === "active" && !hitByDocument.has(document.id)) ? "medium" : "low", pendingRequest: pendingByDocument.get(document.id) ?? null }];
  }).sort((a, b) => (a.severity === "high" ? 0 : a.severity === "medium" ? 1 : 2) - (b.severity === "high" ? 0 : b.severity === "medium" ? 1 : 2) || a.title.localeCompare(b.title, "zh-CN"));
  return Response.json({ generatedAt: new Date().toISOString(), summary: { total: alerts.length, high: alerts.filter((item) => item.severity === "high").length, medium: alerts.filter((item) => item.severity === "medium").length, aging: alerts.filter((item) => item.sourceFreshnessStatus === "aging").length, stale: alerts.filter((item) => item.sourceFreshnessStatus === "stale").length, failed: alerts.filter((item) => item.sourceFreshnessStatus === "failed").length, unavailable: alerts.filter((item) => item.sourceFreshnessStatus === "unavailable").length, expiring: alerts.filter((item) => item.validityStatus === "expiring").length, expired: alerts.filter((item) => item.validityStatus === "expired").length, noHit: alerts.filter((item) => item.reasons.includes("近90天无命中")).length, feedback: alerts.filter((item) => item.reasons.some((reason) => reason.includes("待处理反馈"))).length, conflicts: alerts.filter((item) => item.reasons.some((reason) => reason.includes("冲突未处理"))).length, pendingRefreshRequests: requests.length }, alerts: alerts.slice(0, 100) });
}

export async function POST(request: Request) {
  const auth = await requireKnowledgeActor(request, KNOWLEDGE_EDITOR_ROLES);
  if ("response" in auth) return auth.response;
  const { db, organizationId, actor, email } = auth.context;
  let payload: { knowledgeId?: string; reason?: string };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "申请参数格式不正确" }, { status: 400 }); }
  const knowledgeId = payload.knowledgeId?.trim();
  const reason = payload.reason?.trim().slice(0, 500);
  if (!knowledgeId || !reason) return Response.json({ error: "知识编号和重新同步原因均为必填" }, { status: 400 });
  const [document] = await db.select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title, ownerUserId: knowledgeDocuments.ownerUserId }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, knowledgeId), eq(knowledgeDocuments.organizationId, organizationId))).limit(1);
  if (!document) return Response.json({ error: "知识不存在或不属于当前工作空间" }, { status: 404 });
  const [pending] = await db.select({ id: knowledgeSourceRefreshRequests.id }).from(knowledgeSourceRefreshRequests).where(and(eq(knowledgeSourceRefreshRequests.organizationId, organizationId), eq(knowledgeSourceRefreshRequests.knowledgeId, knowledgeId), inArray(knowledgeSourceRefreshRequests.status, requestStatuses))).limit(1);
  if (pending) return Response.json({ error: "该知识已有待处理的重新同步请求", requestId: pending.id }, { status: 409 });
  const now = new Date().toISOString();
  const id = `KSR-${crypto.randomUUID()}`;
  await db.insert(knowledgeSourceRefreshRequests).values({ id, organizationId, knowledgeId, requestedByUserId: actor.id, ownerUserId: document.ownerUserId, reason, status: "open", note: "已进入来源治理队列，等待责任人或连接器处理。", createdAt: now, updatedAt: now });
  await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "knowledge.source_refresh.request", resourceType: "knowledge_source_refresh_request", resourceId: id, result: "allowed", risk: "medium", metadataJson: JSON.stringify({ email, knowledgeId, ownerUserId: document.ownerUserId, reason }) });
  return Response.json({ request: { id, knowledgeId, title: document.title, ownerUserId: document.ownerUserId, status: "open", createdAt: now } }, { status: 201 });
}
