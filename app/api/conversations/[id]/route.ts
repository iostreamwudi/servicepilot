import { and, asc, desc, eq, lt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { agentRuns, auditLogs, conversations, memberships, messages, users } from "../../../../db/schema";
import { tenantIdForRequest } from "../../../../lib/tenant";

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

const reopenReasons = new Set([
  "用户在72小时内再次咨询",
  "原问题未彻底解决",
  "补充信息后需要继续处理",
  "误结案，需要恢复跟进",
]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!authenticatedEmail(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const organizationId = tenantIdForRequest(request);
  if (!/^C-[A-Za-z0-9-]{1,80}$/.test(id)) return Response.json({ error: "conversationId is invalid" }, { status: 400 });
  const db = getDb();
  const [conversation] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.organizationId, organizationId))).limit(1);
  if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const url = new URL(request.url);
  const parsedLimit = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 10), 100) : 50;
  const before = url.searchParams.get("before")?.trim() || null;
  const messageWhere = before
    ? and(eq(messages.conversationId, id), lt(messages.createdAt, before))
    : eq(messages.conversationId, id);
  const newestFirst = await db.select({ id: messages.id, senderType: messages.senderType, content: messages.content, citationsJson: messages.citationsJson, toolTraceJson: messages.toolTraceJson, traceId: messages.traceId, sourceType: messages.sourceType, sourceId: messages.sourceId, isSynthetic: messages.isSynthetic, createdAt: messages.createdAt }).from(messages).where(messageWhere).orderBy(desc(messages.createdAt)).limit(limit + 1);
  const hasMore = newestFirst.length > limit;
  const turns = [...newestFirst.slice(0, limit)].reverse();
  const nextBefore = turns[0]?.createdAt ?? null;
  const [latestRun] = await db.select().from(agentRuns).where(and(eq(agentRuns.organizationId, organizationId), eq(agentRuns.conversationId, id))).orderBy(desc(agentRuns.createdAt)).limit(1);
  const normalizedTurns = turns.map((turn) => ({ id: turn.id, senderType: turn.senderType, content: turn.content, traceId: turn.traceId, sourceType: turn.sourceType, sourceId: turn.sourceId, isSynthetic: turn.isSynthetic, createdAt: turn.createdAt, trace: turn.senderType === "ai" ? parseJson<Array<Record<string, unknown>>>(turn.toolTraceJson, []) : [] }));
  return Response.json({ conversation: { id: conversation.id, customerName: conversation.customerName, channel: conversation.channel, status: conversation.status, topic: conversation.topic, updatedAt: conversation.updatedAt, resolutionCategory: conversation.resolutionCategory, resolutionSummary: conversation.resolutionSummary, customerConfirmed: conversation.customerConfirmed === true, resolvedByEmail: conversation.resolvedByEmail, resolvedAt: conversation.resolvedAt, reopenCount: conversation.reopenCount, lastReopenedAt: conversation.lastReopenedAt, lastReopenedByEmail: conversation.lastReopenedByEmail, lastReopenReason: conversation.lastReopenReason, priority: conversation.priority, slaPolicy: conversation.slaPolicy, slaStartedAt: conversation.slaStartedAt, slaDueAt: conversation.slaDueAt, riskSource: conversation.riskSource }, messages: normalizedTurns, agentRun: latestRun ? { traceId: latestRun.traceId, model: latestRun.model, mode: latestRun.mode, status: latestRun.status, failureCode: latestRun.failureCode, latencyMs: latestRun.latencyMs, trace: parseJson<Array<Record<string, unknown>>>(latestRun.traceJson, []) } : null, pagination: { limit, returned: normalizedTurns.length, hasMore, nextBefore } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const organizationId = tenantIdForRequest(request);
  if (!/^C-[A-Za-z0-9-]{1,80}$/.test(id)) return Response.json({ error: "conversationId is invalid" }, { status: 400 });
  let payload: { action?: unknown; content?: unknown; assigneeId?: unknown; resolution?: unknown; resolutionSummary?: unknown; customerConfirmed?: unknown; reopenReason?: unknown };
  try { payload = await request.json() as { action?: unknown; content?: unknown; assigneeId?: unknown; resolution?: unknown; resolutionSummary?: unknown; customerConfirmed?: unknown; reopenReason?: unknown }; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const action = payload.action;
  const db = getDb();
  const [conversation] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.organizationId, organizationId))).limit(1);
  if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const now = new Date().toISOString();
  if (action === "claim") {
    await db.update(conversations).set({ status: "human_active", updatedAt: now }).where(eq(conversations.id, id));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorType: "user", action: "conversation.claim", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email }) });
    return Response.json({ ok: true, status: "处理中" });
  }
  if (action === "reply") {
    if (typeof payload.content !== "string" || !payload.content.trim()) return Response.json({ error: "content is required" }, { status: 400 });
    const traceId = request.headers.get("x-trace-id") || crypto.randomUUID();
    await db.insert(messages).values({ id: `M-${crypto.randomUUID()}`, conversationId: id, senderType: "agent", content: payload.content.trim().slice(0, 500), citationsJson: "[]", toolTraceJson: "[]", traceId, sourceType: "production", sourceId: `human:${email}`, isSynthetic: false, createdAt: now });
    await db.update(conversations).set({ status: "human_active", updatedAt: now }).where(eq(conversations.id, id));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorType: "user", action: "conversation.reply", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, contentLength: payload.content.trim().length }) });
    return Response.json({ ok: true, status: "处理中" });
  }
  if (action === "internal_note") {
    if (typeof payload.content !== "string" || !payload.content.trim()) return Response.json({ error: "content is required" }, { status: 400 });
    const content = payload.content.trim().slice(0, 2000);
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorType: "user", action: "conversation.internal_note", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, content }) });
    return Response.json({ ok: true, status: "已保存", visibility: "internal" });
  }
  if (action === "summary_feedback") {
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorType: "user", action: "conversation.summary_feedback", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, feedbackType: "summary_inaccurate" }) });
    return Response.json({ ok: true, status: "已记录" });
  }
  if (action === "suggestion_feedback") {
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorType: "user", action: "conversation.suggestion_feedback", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, feedbackType: "suggestion_not_helpful" }) });
    return Response.json({ ok: true, status: "已记录" });
  }
  if (action === "next_action_request") {
    if (typeof payload.content !== "string" || !payload.content.trim()) return Response.json({ error: "content is required" }, { status: 400 });
    const requestedAction = payload.content.trim().slice(0, 200);
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorType: "user", action: "conversation.next_action_request", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, requestedAction }) });
    return Response.json({ ok: true, status: "已发起核验", requestedAction });
  }
  if (action === "supervisor_escalation_request") {
    if (typeof payload.content !== "string" || !payload.content.trim()) return Response.json({ error: "content is required" }, { status: 400 });
    const reason = payload.content.trim().slice(0, 200);
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorType: "user", action: "conversation.supervisor_escalation_request", resourceType: "conversation", resourceId: id, result: "allowed", risk: "high", metadataJson: JSON.stringify({ actorEmail: email, reason }) });
    return Response.json({ ok: true, status: "已提交升级请求", reason });
  }
  if (action === "set_presence") {
    if (payload.content !== "busy" && payload.content !== "available") return Response.json({ error: "presence must be busy or available" }, { status: 400 });
    const actionName = payload.content === "busy" ? "agent.presence.busy" : "agent.presence.available";
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorType: "user", action: actionName, resourceType: "workspace_presence", resourceId: email, result: "allowed", risk: "low", metadataJson: JSON.stringify({ actorEmail: email, presence: payload.content }) });
    return Response.json({ ok: true, presence: payload.content });
  }
  if (action === "transfer") {
    if (typeof payload.assigneeId !== "string" || !payload.assigneeId.trim()) return Response.json({ error: "assigneeId is required" }, { status: 400 });
    const [assignee] = await db.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users).innerJoin(memberships, eq(memberships.userId, users.id)).where(and(eq(users.id, payload.assigneeId.trim()), eq(memberships.organizationId, organizationId))).limit(1);
    if (!assignee) return Response.json({ error: "指定负责人不在当前工作空间" }, { status: 400 });
    await db.update(conversations).set({ assignedUserId: assignee.id, status: "human_active", updatedAt: now }).where(eq(conversations.id, id));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorType: "user", action: "conversation.transfer", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, fromAssigneeId: conversation.assignedUserId, toAssigneeId: assignee.id, toAssigneeEmail: assignee.email }) });
    return Response.json({ ok: true, status: "处理中", assignee: { id: assignee.id, displayName: assignee.displayName, email: assignee.email } });
  }
  if (action === "resolve") {
    if (typeof payload.resolution !== "string" || !payload.resolution.trim()) return Response.json({ error: "resolution is required" }, { status: 400 });
    if (typeof payload.resolutionSummary !== "string" || !payload.resolutionSummary.trim()) return Response.json({ error: "resolutionSummary is required" }, { status: 400 });
    if (payload.customerConfirmed !== true) return Response.json({ error: "customerConfirmed must be true" }, { status: 400 });
    const resolution = payload.resolution.trim().slice(0, 120);
    const resolutionSummary = payload.resolutionSummary.trim().slice(0, 1000);
    await db.update(conversations).set({ status: "resolved", resolutionCategory: resolution, resolutionSummary, customerConfirmed: true, resolvedByEmail: email, resolvedAt: now, updatedAt: now }).where(eq(conversations.id, id));
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorType: "user", action: "conversation.resolve", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, resolution, resolutionSummary, customerConfirmed: true }) });
    return Response.json({ ok: true, status: "已解决", resolution, resolutionSummary, customerConfirmed: true, resolvedByEmail: email, resolvedAt: now });
  }
  if (action === "reopen") {
    if (conversation.status !== "resolved") return Response.json({ error: "只有已解决会话可以重新打开，请先刷新当前状态" }, { status: 409 });
    if (typeof payload.reopenReason !== "string" || !reopenReasons.has(payload.reopenReason.trim())) return Response.json({ error: "reopenReason is required" }, { status: 400 });
    const reopenReason = payload.reopenReason.trim();
    const reopenCount = (conversation.reopenCount ?? 0) + 1;
    const updated = await db.update(conversations).set({ status: "human_active", customerConfirmed: false, reopenCount, lastReopenedAt: now, lastReopenedByEmail: email, lastReopenReason: reopenReason, updatedAt: now }).where(and(eq(conversations.id, id), eq(conversations.organizationId, organizationId), eq(conversations.status, "resolved")));
    if (!updated.changes) return Response.json({ error: "会话状态已变化，请刷新后重试" }, { status: 409 });
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorType: "user", action: "conversation.reopen", resourceType: "conversation", resourceId: id, result: "allowed", risk: conversation.risk === "high" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, previousStatus: conversation.status, previousResolutionCategory: conversation.resolutionCategory, previousResolutionSummary: conversation.resolutionSummary, previousResolvedAt: conversation.resolvedAt, reopenReason, reopenCount }) });
    return Response.json({ ok: true, status: "处理中", reopenReason, reopenCount, lastReopenedAt: now, lastReopenedByEmail: email, customerConfirmed: false });
  }
  return Response.json({ error: "Unsupported conversation action" }, { status: 400 });
}
