import { and, count, desc, eq, gt, inArray, like, lt, isNull, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, conversations, memberships, tickets, users } from "../../../db/schema";
import { TEST_ORG_ID, tenantIdForRequest } from "../../../lib/tenant";
import { actorFor, authenticatedEmail, isSupervisor } from "../../../lib/request-auth";
import { canTransition, slaStatus, ticketPriorities, ticketSlaPolicy, ticketStates } from "../../../lib/ticket-policy";

function parsePage(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function explainSla(ticket: { state: typeof ticketStates[number]; slaDueAt: string | null; resolvedAt?: string | null }, now = Date.now()) {
  const state = slaStatus(ticket.slaDueAt, ticket.state, now);
  if (state === "unknown") return "缺少有效截止时间，暂不参与 SLA 风险判断";
  if (state === "completed") {
    if (!ticket.resolvedAt) return "工单已完成，但缺少解决时间，无法判断是否按时完成";
    return new Date(ticket.resolvedAt).getTime() <= new Date(ticket.slaDueAt!).getTime() ? "已在 SLA 截止时间前解决" : "解决时间晚于 SLA 截止时间";
  }
  if (state === "overdue") return ticket.state === "unassigned" ? "尚未领取，当前没有责任人" : ticket.state === "waiting_customer" ? "等待用户状态仍计入当前 SLA 策略" : "尚未解决，已超过 SLA 截止时间";
  if (state === "due_soon") return "距离 SLA 截止时间不足 30 分钟";
  return "距离 SLA 截止时间超过 30 分钟";
}

function enrichTicket<T extends { priority: typeof ticketPriorities[number]; state: typeof ticketStates[number]; slaDueAt: string; resolvedAt?: string | null }>(ticket: T, now = Date.now()) {
  const policy = ticketSlaPolicy(ticket.priority);
  return {
    ...ticket,
    slaState: slaStatus(ticket.slaDueAt, ticket.state, now),
    slaPolicy: policy.label,
    slaPolicyId: policy.id,
    slaPolicyMinutes: policy.minutes,
    slaSource: policy.source,
    slaTimeZone: "UTC",
    slaPaused: false,
    slaPauseReason: "当前优先级策略未启用按等待用户自动暂停 SLA",
    slaExplanation: explainSla(ticket, now),
  };
}

export async function GET(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const url = new URL(request.url);
  const page = parsePage(url.searchParams.get("page"), 1, 1, 10_000);
  const pageSize = parsePage(url.searchParams.get("pageSize"), 25, 5, 100);
  const state = url.searchParams.get("state");
  const priority = url.searchParams.get("priority");
  const view = url.searchParams.get("view") ?? "all";
  const owner = url.searchParams.get("owner");
  const team = url.searchParams.get("team");
  const channel = url.searchParams.get("channel");
  const category = url.searchParams.get("category");
  const sortParam = url.searchParams.get("sort");
  const sort = sortParam === "priority" || sortParam === "created" || sortParam === "sla" ? sortParam : "updated";
  const openOnly = url.searchParams.get("open") === "1";
  const query = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const organizationId = tenantIdForRequest(request);
  const filters = [eq(tickets.organizationId, organizationId)];
  const db = getDb();
  const actor = await actorFor(db, organizationId, email);
  if (!actor) return Response.json({ error: "当前账号没有该工作空间的工单权限" }, { status: 403 });
  if (state && ticketStates.includes(state as typeof ticketStates[number])) filters.push(eq(tickets.state, state as typeof ticketStates[number]));
  if (priority && ticketPriorities.includes(priority as typeof ticketPriorities[number])) filters.push(eq(tickets.priority, priority as typeof ticketPriorities[number]));
  if (owner === "unassigned") filters.push(isNull(tickets.ownerUserId));
  else if (owner) filters.push(eq(tickets.ownerUserId, owner));
  if (team === "unassigned") filters.push(isNull(tickets.teamKey));
  else if (team) filters.push(eq(tickets.teamKey, team));
  if (channel) filters.push(eq(conversations.channel, channel));
  if (category) filters.push(eq(conversations.topic, category));
  if (view === "mine") filters.push(eq(tickets.ownerUserId, actor.id));
  if (view === "unassigned") filters.push(isNull(tickets.ownerUserId));
  const openStates = or(eq(tickets.state, "unassigned"), eq(tickets.state, "in_progress"), eq(tickets.state, "waiting_customer"));
  if (openOnly) filters.push(openStates!);
  if (view === "overdue") filters.push(and(openStates, lt(tickets.slaDueAt, new Date().toISOString()))!);
  if (view === "due_soon") filters.push(and(openStates, lt(tickets.slaDueAt, new Date(Date.now() + 30 * 60_000).toISOString()), gt(tickets.slaDueAt, new Date().toISOString()))!);
  if (query) filters.push(or(like(tickets.id, `%${query}%`), like(tickets.title, `%${query}%`), like(tickets.customerName, `%${query}%`))!);
  const where = and(...filters);
  const [totalRow, rows, allForMetrics, assignees] = await Promise.all([
    db.select({ value: count() }).from(tickets).leftJoin(conversations, eq(tickets.conversationId, conversations.id)).where(where),
    db.select({
      id: tickets.id, organizationId: tickets.organizationId, conversationId: tickets.conversationId,
      title: tickets.title, customerName: tickets.customerName, priority: tickets.priority, state: tickets.state,
      ownerUserId: tickets.ownerUserId, ownerName: users.displayName, ownerEmail: users.email,
      teamKey: tickets.teamKey, slaStartedAt: tickets.slaStartedAt, slaDueAt: tickets.slaDueAt, firstResponseAt: tickets.firstResponseAt, resolvedAt: tickets.resolvedAt, closedAt: tickets.closedAt,
      channel: conversations.channel, category: conversations.topic,
      resolutionCategory: tickets.resolutionCategory, resolutionSummary: tickets.resolutionSummary, reopenCount: tickets.reopenCount, lastReopenReason: tickets.lastReopenReason, triggerReason: tickets.triggerReason, summary: tickets.summary,
      sourceType: tickets.sourceType, sourceId: tickets.sourceId, traceId: tickets.traceId,
      createdAt: tickets.createdAt, updatedAt: tickets.updatedAt, isSynthetic: tickets.isSynthetic,
    }).from(tickets).leftJoin(users, eq(tickets.ownerUserId, users.id)).leftJoin(conversations, eq(tickets.conversationId, conversations.id)).where(where).orderBy(sort === "priority" ? tickets.priority : sort === "created" ? desc(tickets.createdAt) : sort === "sla" ? tickets.slaDueAt : desc(tickets.updatedAt), desc(tickets.updatedAt), desc(tickets.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ priority: tickets.priority, state: tickets.state, ownerUserId: tickets.ownerUserId, slaDueAt: tickets.slaDueAt, resolvedAt: tickets.resolvedAt, createdAt: tickets.createdAt, updatedAt: tickets.updatedAt, isSynthetic: tickets.isSynthetic, teamKey: tickets.teamKey, channel: conversations.channel, category: conversations.topic }).from(tickets).leftJoin(conversations, eq(tickets.conversationId, conversations.id)).where(eq(tickets.organizationId, organizationId)),
    db.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users).innerJoin(memberships, eq(memberships.userId, users.id)).where(eq(memberships.organizationId, organizationId)).orderBy(users.displayName),
  ]);
  const total = Number(totalRow[0]?.value ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const dataAsOf = new Date().toISOString();
  const isOpen = (row: typeof allForMetrics[number]) => !["resolved", "closed"].includes(row.state);
  const now = Date.now();
  const viewCounts = {
    all: allForMetrics.length,
    mine: allForMetrics.filter((row) => row.ownerUserId === actor.id).length,
    unassigned: allForMetrics.filter((row) => row.ownerUserId === null).length,
    overdue: allForMetrics.filter((row) => isOpen(row) && new Date(row.slaDueAt).getTime() < now).length,
    due_soon: allForMetrics.filter((row) => isOpen(row) && new Date(row.slaDueAt).getTime() >= now && new Date(row.slaDueAt).getTime() < now + 30 * 60_000).length,
  };
  const filterCounts = {
    all: allForMetrics.length,
    unassigned: allForMetrics.filter((row) => row.state === "unassigned").length,
    in_progress: allForMetrics.filter((row) => row.state === "in_progress").length,
    waiting_customer: allForMetrics.filter((row) => row.state === "waiting_customer").length,
    P1: allForMetrics.filter((row) => row.priority === "P1").length,
    P2: allForMetrics.filter((row) => row.priority === "P2").length,
    P3: allForMetrics.filter((row) => row.priority === "P3").length,
    resolved: allForMetrics.filter((row) => row.state === "resolved").length,
    closed: allForMetrics.filter((row) => row.state === "closed").length,
  };
  const metricRows = allForMetrics.filter((row) => !row.isSynthetic);
  const metricResolved = metricRows.filter((row) => (row.state === "resolved" || row.state === "closed") && slaStatus(row.slaDueAt, row.state) !== "unknown");
  const metricWithinSla = metricResolved.filter((row) => Number.isFinite(new Date(row.resolvedAt ?? row.updatedAt).getTime()) && Number.isFinite(new Date(row.slaDueAt).getTime()) && new Date(row.resolvedAt ?? row.updatedAt).getTime() <= new Date(row.slaDueAt).getTime());
  const metricDurations = metricResolved.map((row) => new Date(row.resolvedAt ?? row.updatedAt).getTime() - new Date(row.createdAt).getTime()).filter((value) => Number.isFinite(value) && value >= 0);
  return Response.json({
    tickets: rows.map((ticket) => enrichTicket(ticket, now)),
    assignees,
    teams: Array.from(new Set(allForMetrics.map((row) => row.teamKey).filter((value): value is string => Boolean(value)))).sort(),
    channels: Array.from(new Set(allForMetrics.map((row) => row.channel).filter((value): value is string => Boolean(value)))).sort(),
    categories: Array.from(new Set(allForMetrics.map((row) => row.category).filter((value): value is string => Boolean(value)))).sort(),
    pagination: { page, pageSize, total, totalPages },
    actor: { id: actor.id, displayName: actor.displayName, role: actor.role },
    dataAsOf,
    dataScope: { organizationId, mode: organizationId === TEST_ORG_ID ? "test" : "production", syntheticCount: allForMetrics.filter((row) => row.isSynthetic).length, total: allForMetrics.length, kpiEligibleCount: metricRows.length, syntheticExcludedFromKpis: allForMetrics.length - metricRows.length },
    viewCounts,
    filterCounts,
    summary: {
      total,
      open: allForMetrics.filter((row) => !["resolved", "closed"].includes(row.state)).length,
      p1Open: allForMetrics.filter((row) => row.priority === "P1" && !["resolved", "closed"].includes(row.state)).length,
      slaRate: metricResolved.length ? Math.round((metricWithinSla.length / metricResolved.length) * 1000) / 10 : null,
      averageResolutionMinutes: metricDurations.length ? Math.round(metricDurations.reduce((sum, value) => sum + value, 0) / metricDurations.length / 60_000) : null,
      kpiScope: organizationId === TEST_ORG_ID ? "test_non_production" : "production",
      kpiEligibleCount: metricRows.length,
      syntheticExcludedCount: allForMetrics.length - metricRows.length,
    },
  });
}

export async function PATCH(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { ids?: unknown; action?: string; ownerEmail?: string | null; state?: string; priority?: string; preview?: boolean; confirmed?: boolean };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const rawIds = Array.isArray(payload.ids) ? payload.ids : [];
  if (!rawIds.length || rawIds.length > 50 || rawIds.some((id) => typeof id !== "string" || !/^T-[A-Za-z0-9-]{1,120}$/.test(id))) return Response.json({ error: "一次最多批量处理 50 条格式正确的工单" }, { status: 400 });
  const ids = Array.from(new Set(rawIds as string[]));
  if (payload.action !== "bulk_assign" && payload.action !== "bulk_update") return Response.json({ error: "Unsupported bulk ticket action" }, { status: 400 });
  const organizationId = tenantIdForRequest(request);
  const db = getDb();
  const actor = await actorFor(db, organizationId, email);
  if (!actor) return Response.json({ error: "当前账号没有该工作空间的工单权限" }, { status: 403 });
  if (!isSupervisor(actor.role)) return Response.json({ error: "批量工单操作需要主管权限" }, { status: 403 });
  const current = await db.select({ id: tickets.id, state: tickets.state, priority: tickets.priority, ownerUserId: tickets.ownerUserId }).from(tickets).where(and(eq(tickets.organizationId, organizationId), inArray(tickets.id, ids)));
  if (current.length !== ids.length) return Response.json({ error: "部分工单不存在或不属于当前工作空间" }, { status: 404 });
  const blocked: Array<{ id: string; reason: string }> = [];
  let changes: Partial<typeof tickets.$inferInsert> = { updatedAt: new Date().toISOString() };
  const changeLabels: string[] = [];
  if (payload.action === "bulk_assign") {
    if (payload.ownerEmail === null) {
      changes = { ...changes, ownerUserId: null, state: "unassigned" };
      changeLabels.push("取消负责人并设为待领取");
    } else {
      if (!payload.ownerEmail?.trim()) return Response.json({ error: "请选择负责人，或明确选择取消分配" }, { status: 400 });
      const [owner] = await db.select({ id: users.id }).from(users).innerJoin(memberships, eq(memberships.userId, users.id)).where(and(eq(users.email, payload.ownerEmail.trim()), eq(memberships.organizationId, organizationId))).limit(1);
      if (!owner) return Response.json({ error: "指定负责人不在当前工作空间" }, { status: 400 });
      changes = { ...changes, ownerUserId: owner.id };
      changeLabels.push(`分配给 ${payload.ownerEmail.trim()}`);
    }
  } else {
    if (payload.priority && !ticketPriorities.includes(payload.priority as typeof ticketPriorities[number])) return Response.json({ error: "invalid priority" }, { status: 400 });
    if (payload.state && !ticketStates.includes(payload.state as typeof ticketStates[number])) return Response.json({ error: "invalid state" }, { status: 400 });
    if (!payload.priority && !payload.state) return Response.json({ error: "批量更新至少需要选择一个字段" }, { status: 400 });
    if (payload.state && (payload.state === "resolved" || payload.state === "closed")) return Response.json({ error: "解决和关闭必须逐条填写结构化原因" }, { status: 409 });
    if (payload.priority) changeLabels.push(`更新优先级为 ${payload.priority}`);
    if (payload.state) changeLabels.push(`更新状态为 ${payload.state === "unassigned" ? "待领取" : payload.state === "in_progress" ? "处理中" : "等待用户"}`);
    if (payload.state) current.filter((ticket) => !canTransition(ticket.state as typeof ticketStates[number], payload.state as typeof ticketStates[number])).forEach((ticket) => blocked.push({ id: ticket.id, reason: `当前状态“${ticket.state}”不允许流转到“${payload.state}”` }));
    changes = { ...changes, ...(payload.priority ? { priority: payload.priority as typeof ticketPriorities[number] } : {}), ...(payload.state ? { state: payload.state as typeof ticketStates[number] } : {}) };
  }
  const preview = { action: payload.action as "bulk_assign" | "bulk_update", count: current.length, ids, changes: changeLabels, blocked, ownerEmail: payload.ownerEmail, priority: payload.priority as typeof ticketPriorities[number] | undefined, state: payload.state as Exclude<typeof ticketStates[number], "resolved" | "closed"> | undefined };
  if (payload.preview) return Response.json({ preview });
  if (!payload.confirmed) return Response.json({ error: "请先确认批量影响范围", code: "BULK_CONFIRMATION_REQUIRED", preview }, { status: 409 });
  if (blocked.length) return Response.json({ error: "所选工单中有不允许的状态流转，请缩小选择范围", code: "BULK_PREVIEW_BLOCKED", preview }, { status: 409 });
  let updated = 0;
  const failed: Array<{ id: string; reason: string }> = [];
  for (const ticket of current) {
    try {
      const ticketChanges = payload.action === "bulk_assign" && payload.ownerEmail !== null && ticket.state === "unassigned" ? { ...changes, state: "in_progress" as const } : changes;
      await db.update(tickets).set(ticketChanges).where(and(eq(tickets.id, ticket.id), eq(tickets.organizationId, organizationId)));
      await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: payload.action, resourceType: "ticket", resourceId: ticket.id, result: "allowed", risk: ticket.priority === "P1" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, bulk: true, fromState: ticket.state, toState: ticketChanges.state ?? ticket.state, fromPriority: ticket.priority, toPriority: ticketChanges.priority ?? ticket.priority, ownerUserId: ticketChanges.ownerUserId }) });
      updated += 1;
    } catch (cause) { failed.push({ id: ticket.id, reason: cause instanceof Error ? cause.message : "保存失败，可重试" }); }
  }
  return Response.json({ ok: failed.length === 0, action: payload.action, updated, ids, failed }, { status: failed.length ? 207 : 200 });
}

export async function POST(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { title?: string; customerName?: string; priority?: "P1" | "P2" | "P3"; conversationId?: string; ownerEmail?: string; teamKey?: string; summary?: string; idempotencyKey?: string };
  try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!payload.title?.trim() || !payload.customerName?.trim()) return Response.json({ error: "title and customerName are required" }, { status: 400 });
  if (!payload.priority || !ticketPriorities.includes(payload.priority)) return Response.json({ error: "valid priority is required" }, { status: 400 });
  if (payload.conversationId && !/^C-[A-Za-z0-9-]{1,80}$/.test(payload.conversationId)) return Response.json({ error: "conversationId is invalid" }, { status: 400 });
  const idempotencyKey = payload.idempotencyKey?.trim();
  if (idempotencyKey && !/^[A-Za-z0-9_-]{16,120}$/.test(idempotencyKey)) return Response.json({ error: "idempotencyKey is invalid" }, { status: 400 });
  const id = `T-${crypto.randomUUID()}`;
  const organizationId = tenantIdForRequest(request);
  const db = getDb();
  const actor = await actorFor(db, organizationId, email);
  if (!actor) return Response.json({ error: "当前账号没有该工作空间的工单权限" }, { status: 403 });
  if (idempotencyKey) {
    const [existingByRequest] = await db.select().from(tickets).where(and(eq(tickets.organizationId, organizationId), eq(tickets.createRequestId, idempotencyKey))).limit(1);
    if (existingByRequest) return Response.json({ ticket: existingByRequest, created: false, idempotent: true });
  }
  let ownerUserId: string | null = null;
  if (payload.ownerEmail?.trim()) {
    if (!isSupervisor(actor.role)) return Response.json({ error: "创建时指定负责人需要主管权限" }, { status: 403 });
    const [owner] = await db.select({ id: users.id }).from(users).innerJoin(memberships, eq(memberships.userId, users.id)).where(and(eq(users.email, payload.ownerEmail.trim()), eq(memberships.organizationId, organizationId))).limit(1);
    if (!owner) return Response.json({ error: "指定负责人不在当前工作空间" }, { status: 400 });
    ownerUserId = owner.id;
  }
  const teamKey = payload.teamKey?.trim().slice(0, 80) || null;
  if (payload.conversationId) {
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.organizationId, organizationId), eq(conversations.id, payload.conversationId))).limit(1);
    if (!conversation) return Response.json({ error: "关联会话不存在或不属于当前工作空间" }, { status: 400 });
    const existing = await db.select().from(tickets).where(and(eq(tickets.organizationId, organizationId), eq(tickets.conversationId, payload.conversationId), or(eq(tickets.state, "unassigned"), eq(tickets.state, "in_progress"), eq(tickets.state, "waiting_customer")))).limit(1);
    if (existing[0]) return Response.json({ ticket: existing[0], created: false });
  }
  const startedAt = new Date().toISOString();
  const slaMinutes = payload.priority === "P1" ? 60 : payload.priority === "P2" ? 240 : 1440;
  const isTestTenant = organizationId === TEST_ORG_ID;
  let ticket: typeof tickets.$inferSelect;
  try {
    [ticket] = await db.insert(tickets).values({ id, organizationId, conversationId: payload.conversationId, title: payload.title.trim().slice(0, 160), customerName: payload.customerName.trim().slice(0, 120), priority: payload.priority, state: ownerUserId ? "in_progress" : "unassigned", ownerUserId, teamKey, createRequestId: idempotencyKey ?? null, slaStartedAt: startedAt, slaDueAt: new Date(Date.now() + slaMinutes * 60_000).toISOString(), summary: payload.summary?.trim().slice(0, 2000) || null, sourceType: isTestTenant ? "internal_demo" : "production", isSynthetic: isTestTenant }).returning();
  } catch (cause) {
    if (idempotencyKey && cause instanceof Error && cause.message.includes("tickets.create_request_id")) {
      const [existingByRequest] = await db.select().from(tickets).where(and(eq(tickets.organizationId, organizationId), eq(tickets.createRequestId, idempotencyKey))).limit(1);
      if (existingByRequest) return Response.json({ ticket: existingByRequest, created: false, idempotent: true });
    }
    throw cause;
  }
  await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "ticket.create", resourceType: "ticket", resourceId: id, result: "allowed", risk: payload.priority === "P1" ? "medium" : "low", metadataJson: JSON.stringify({ actorEmail: email, ownerUserId, teamKey, conversationId: payload.conversationId }) });
  return Response.json({ ticket, created: true }, { status: 201 });
}
