import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, memberships, tickets, users } from "../../../../db/schema";
import { actorFor, authenticatedEmail, isSupervisor } from "../../../../lib/request-auth";
import { tenantIdForRequest } from "../../../../lib/tenant";
import { canTransition, isTerminalState, slaStatus, ticketPriorities, ticketSlaPolicy, ticketStates } from "../../../../lib/ticket-policy";

function validId(id: string) { return /^T-[A-Za-z0-9-]{1,120}$/.test(id); }

function enrichTicket<T extends { priority: typeof ticketPriorities[number]; state: typeof ticketStates[number]; slaDueAt: string; resolvedAt?: string | null }>(ticket: T) {
  const policy = ticketSlaPolicy(ticket.priority);
  const slaState = slaStatus(ticket.slaDueAt, ticket.state);
  const dueAt = new Date(ticket.slaDueAt).getTime();
  const resolvedAt = ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : Number.NaN;
  const slaExplanation = slaState === "unknown" ? "缺少有效截止时间，暂不参与 SLA 风险判断" : slaState === "completed" ? (!Number.isFinite(resolvedAt) ? "工单已完成，但缺少解决时间，无法判断是否按时完成" : resolvedAt <= dueAt ? "已在 SLA 截止时间前解决" : "解决时间晚于 SLA 截止时间") : slaState === "overdue" ? ticket.state === "unassigned" ? "尚未领取，当前没有责任人" : ticket.state === "waiting_customer" ? "等待用户状态仍计入当前 SLA 策略" : "尚未解决，已超过 SLA 截止时间" : slaState === "due_soon" ? "距离 SLA 截止时间不足 30 分钟" : "距离 SLA 截止时间超过 30 分钟";
  return { ...ticket, slaState, slaPolicy: policy.label, slaPolicyId: policy.id, slaPolicyMinutes: policy.minutes, slaSource: policy.source, slaTimeZone: "UTC", slaPaused: false, slaPauseReason: "当前优先级策略未启用按等待用户自动暂停 SLA", slaExplanation };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!authenticatedEmail(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  if (!validId(id)) return Response.json({ error: "ticketId is invalid" }, { status: 400 });
  const db = getDb();
  const organizationId = tenantIdForRequest(request);
  const actor = await actorFor(db, organizationId, authenticatedEmail(request)!);
  if (!actor) return Response.json({ error: "当前账号没有该工作空间的工单权限" }, { status: 403 });
  const [ticket] = await db.select({
    id: tickets.id, organizationId: tickets.organizationId, conversationId: tickets.conversationId,
    title: tickets.title, customerName: tickets.customerName, priority: tickets.priority, state: tickets.state,
    ownerUserId: tickets.ownerUserId, ownerName: users.displayName, ownerEmail: users.email,
    teamKey: tickets.teamKey, slaStartedAt: tickets.slaStartedAt, slaDueAt: tickets.slaDueAt, firstResponseAt: tickets.firstResponseAt, resolvedAt: tickets.resolvedAt, closedAt: tickets.closedAt,
    resolutionCategory: tickets.resolutionCategory, resolutionSummary: tickets.resolutionSummary, reopenCount: tickets.reopenCount, lastReopenReason: tickets.lastReopenReason, triggerReason: tickets.triggerReason, summary: tickets.summary,
    sourceType: tickets.sourceType, sourceId: tickets.sourceId, traceId: tickets.traceId,
    createdAt: tickets.createdAt, updatedAt: tickets.updatedAt, isSynthetic: tickets.isSynthetic,
  }).from(tickets).leftJoin(users, eq(tickets.ownerUserId, users.id)).where(and(eq(tickets.id, id), eq(tickets.organizationId, organizationId))).limit(1);
  if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
  const events = await db.select({ id: auditLogs.id, action: auditLogs.action, actorUserId: auditLogs.actorUserId, result: auditLogs.result, metadataJson: auditLogs.metadataJson, createdAt: auditLogs.createdAt }).from(auditLogs).where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.resourceType, "ticket"), eq(auditLogs.resourceId, id))).orderBy(desc(auditLogs.createdAt)).limit(100);
  const notes = events.filter((event) => event.action === "ticket.note").map((event) => {
    let metadata: { content?: string; actorName?: string } = {};
    try { metadata = JSON.parse(event.metadataJson) as typeof metadata; } catch { /* keep malformed audit data visible without breaking detail */ }
    return { id: event.id, content: metadata.content ?? "", actorName: metadata.actorName ?? event.actorUserId ?? "系统", createdAt: event.createdAt };
  }).filter((note) => note.content);
  const takeoverEvent = events.find((event) => event.action === "ticket.claim" || event.action === "ticket.assign");
  return Response.json({ ticket: enrichTicket({ ...ticket, takeoverAt: takeoverEvent?.createdAt ?? null }), notes, events, slaFacts: { state: slaStatus(ticket.slaDueAt, ticket.state), policy: ticketSlaPolicy(ticket.priority), startedAt: ticket.slaStartedAt, takeoverAt: takeoverEvent?.createdAt ?? null, firstResponseAt: ticket.firstResponseAt, resolvedAt: ticket.resolvedAt, closedAt: ticket.closedAt, paused: false, pauseReason: "当前优先级策略未启用按等待用户自动暂停 SLA", timeZone: "UTC" }, actor: { id: actor.id, displayName: actor.displayName, role: actor.role } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  if (!validId(id)) return Response.json({ error: "ticketId is invalid" }, { status: 400 });
  let payload: { action?: string; state?: string; priority?: string; ownerUserId?: string | null; ownerEmail?: string; title?: string; summary?: string; content?: string; resolutionCategory?: string; resolutionSummary?: string; reopenReason?: string; closeReason?: string };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const db = getDb();
  const organizationId = tenantIdForRequest(request);
  const [current] = await db.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.organizationId, organizationId))).limit(1);
  if (!current) return Response.json({ error: "Ticket not found" }, { status: 404 });
  const actor = await actorFor(db, organizationId, email);
  if (!actor) return Response.json({ error: "当前账号没有该工作空间的工单权限" }, { status: 403 });
  const now = new Date().toISOString();
  let changes: Record<string, unknown> = { updatedAt: now };
  const action = payload.action;
  if (action === "claim") {
    if (current.state !== "unassigned") return Response.json({ error: "只有待领取工单可以领取" }, { status: 409 });
    changes = { ...changes, ownerUserId: actor.id, state: "in_progress" };
  } else if (action === "assign") {
    if (!isSupervisor(actor.role)) return Response.json({ error: "分配负责人需要主管权限；一线客服可以领取工单" }, { status: 403 });
    if (!payload.ownerEmail?.trim()) return Response.json({ error: "ownerEmail is required" }, { status: 400 });
    const [owner] = await db.select({ id: users.id }).from(users).innerJoin(memberships, eq(memberships.userId, users.id)).where(and(eq(users.email, payload.ownerEmail.trim()), eq(memberships.organizationId, organizationId))).limit(1);
    if (!owner) return Response.json({ error: "指定负责人不在当前工作空间" }, { status: 400 });
    changes = { ...changes, ownerUserId: owner.id, state: current.state === "unassigned" ? "in_progress" : current.state };
  } else if (action === "update") {
    if (payload.state && !ticketStates.includes(payload.state as typeof ticketStates[number])) return Response.json({ error: "invalid state" }, { status: 400 });
    if (payload.priority && !ticketPriorities.includes(payload.priority as typeof ticketPriorities[number])) return Response.json({ error: "invalid priority" }, { status: 400 });
    if (payload.state && !canTransition(current.state, payload.state as typeof ticketStates[number])) return Response.json({ error: `不允许从${current.state}直接切换到${payload.state}` }, { status: 409 });
    if (payload.state && payload.state !== current.state && (payload.state === "resolved" || payload.state === "closed")) return Response.json({ error: "解决和关闭必须通过结构化操作完成" }, { status: 409 });
    if (payload.state && !isSupervisor(actor.role) && payload.state === "closed") return Response.json({ error: "关闭工单需要主管权限" }, { status: 403 });
    if (payload.priority && payload.priority !== current.priority && !isSupervisor(actor.role) && (payload.priority === "P1" || current.priority === "P1")) return Response.json({ error: "P1 优先级变更需要主管权限" }, { status: 403 });
    if (payload.title !== undefined && !payload.title.trim()) return Response.json({ error: "title cannot be empty" }, { status: 400 });
    changes = { ...changes, ...(payload.state ? { state: payload.state } : {}), ...(payload.priority ? { priority: payload.priority } : {}), ...(payload.title !== undefined ? { title: payload.title.trim().slice(0, 160) } : {}), ...(payload.summary !== undefined ? { summary: payload.summary.trim().slice(0, 2000) } : {}) };
  } else if (action === "resolve") {
    if (current.state !== "in_progress" && current.state !== "waiting_customer") return Response.json({ error: "只有处理中或等待用户的工单可以标记为已解决" }, { status: 409 });
    if (!payload.resolutionCategory?.trim() || !payload.resolutionSummary?.trim()) return Response.json({ error: "结案必须填写解决分类和摘要" }, { status: 400 });
    changes = { ...changes, state: "resolved", firstResponseAt: current.firstResponseAt ?? now, resolvedAt: now, resolutionCategory: payload.resolutionCategory.trim().slice(0, 120), resolutionSummary: payload.resolutionSummary.trim().slice(0, 2000) };
  } else if (action === "close") {
    if (!isSupervisor(actor.role)) return Response.json({ error: "关闭工单需要主管权限" }, { status: 403 });
    if (current.state !== "resolved") return Response.json({ error: "只有已解决工单可以关闭" }, { status: 409 });
    if (!payload.closeReason?.trim()) return Response.json({ error: "关闭工单必须填写原因" }, { status: 400 });
    changes = { ...changes, state: "closed", closedAt: now };
  } else if (action === "reopen") {
    if (!isTerminalState(current.state)) return Response.json({ error: "只有已解决或已关闭工单可以重新打开" }, { status: 409 });
    if (!payload.reopenReason?.trim()) return Response.json({ error: "重新打开必须填写原因" }, { status: 400 });
    changes = { ...changes, state: "in_progress", resolvedAt: null, closedAt: null, reopenCount: (current.reopenCount ?? 0) + 1, lastReopenReason: payload.reopenReason.trim().slice(0, 240), slaStartedAt: now, slaDueAt: new Date(Date.now() + (current.priority === "P1" ? 60 : current.priority === "P2" ? 240 : 1440) * 60_000).toISOString() };
  } else if (action === "add_note") {
    if (!payload.content?.trim()) return Response.json({ error: "content is required" }, { status: 400 });
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "ticket.note", resourceType: "ticket", resourceId: id, result: "allowed", risk: current.priority === "P1" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, actorName: actor.displayName, content: payload.content.trim().slice(0, 2000), visibility: "internal" }) });
    await db.update(tickets).set({ updatedAt: now }).where(eq(tickets.id, id));
    return Response.json({ ok: true, action, ticket: { ...current, updatedAt: now } });
  } else {
    return Response.json({ error: "Unsupported ticket action" }, { status: 400 });
  }
  await db.update(tickets).set(changes as Partial<typeof tickets.$inferInsert>).where(eq(tickets.id, id));
  await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: `ticket.${action}`, resourceType: "ticket", resourceId: id, result: "allowed", risk: current.priority === "P1" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, fromState: current.state, toState: changes.state ?? current.state, fromPriority: current.priority, toPriority: changes.priority ?? current.priority, closeReason: payload.closeReason?.trim() || undefined, reopenReason: payload.reopenReason?.trim() || undefined }) });
  const [updated] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  return Response.json({ ok: true, action, ticket: updated });
}
