import { and, count, desc, eq, inArray, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { agentConversationStates, agentRuns, auditLogs, conversations, knowledgeDocuments, memberships, messages, users } from "../../../db/schema";
import { slaPolicyForRisk } from "../../../lib/conversation-sla";
import { tenantIdForRequest } from "../../../lib/tenant";

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

function statusLabel(status: string) {
  return status === "needs_human" ? "待接管" : status === "human_active" || status === "ai_active" ? "处理中" : status === "ticketed" ? "等待内部" : status === "resolved" ? "已解决" : "处理中";
}

function riskLabel(risk: string) {
  return risk === "high" ? "高" : risk === "medium" ? "中" : "低";
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function parsePage(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function effectiveSla(row: Pick<typeof conversations.$inferSelect, "risk" | "priority" | "slaPolicy" | "slaStartedAt" | "slaDueAt" | "createdAt" | "status">, now = Date.now()) {
  const policy = slaPolicyForRisk(row.risk);
  const priority = row.priority ?? policy.priority;
  const startedAt = row.slaStartedAt ?? row.createdAt;
  const persistedDueAt = row.slaDueAt;
  const fallbackDueAt = new Date(new Date(startedAt).getTime() + policy.minutes * 60_000).toISOString();
  const dueAt = persistedDueAt ?? fallbackDueAt;
  const dueMs = new Date(dueAt).getTime();
  const active = row.status !== "resolved";
  const delta = dueMs - now;
  const state = !active ? "completed" : !Number.isFinite(dueMs) ? "unknown" : delta <= 0 ? "overdue" : delta <= 30 * 60_000 ? "due_soon" : "on_track";
  const text = !active ? "已完成" : state === "overdue" ? `已逾期 ${Math.max(1, Math.ceil(Math.abs(delta) / 60_000))} 分钟` : state === "due_soon" ? `剩余 ${Math.max(1, Math.ceil(delta / 60_000))} 分钟` : Number.isFinite(dueMs) ? `截止 ${new Date(dueAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "待计算";
  return { priority, policyId: row.slaPolicy ?? policy.id, startedAt, dueAt, state, text, source: persistedDueAt ? "persisted" : "policy-derived" };
}

export async function GET(request: Request) {
  if (!authenticatedEmail(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const db = getDb();
  const organizationId = tenantIdForRequest(request);
  const url = new URL(request.url);
  const now = Date.now();
  const customerName = url.searchParams.get("customerName")?.trim();
  const page = parsePage(url.searchParams.get("page"), 1, 1, 10_000);
  const pageSize = parsePage(url.searchParams.get("pageSize"), 25, 10, 50);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const status = url.searchParams.get("status");
  const conversationId = url.searchParams.get("conversationId")?.trim() || null;
  const filters = [eq(conversations.organizationId, organizationId)];
  if (customerName) filters.push(eq(conversations.customerName, customerName));
  if (query) filters.push(or(like(conversations.id, `%${query}%`), like(conversations.customerName, `%${query}%`), like(conversations.topic, `%${query}%`))!);
  if (status === "needs_human" || status === "ticketed" || status === "resolved") filters.push(eq(conversations.status, status));
  if (status === "active") filters.push(inArray(conversations.status, ["ai_active", "human_active"]));
  const where = and(...filters);
  const [totalRow, pageRows, assignees, statusRows, slaRows] = await Promise.all([
    db.select({ value: count() }).from(conversations).where(where),
    db.select().from(conversations).where(where).orderBy(desc(conversations.updatedAt), desc(conversations.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users).innerJoin(memberships, eq(memberships.userId, users.id)).where(eq(memberships.organizationId, organizationId)).orderBy(users.displayName),
    db.select({ status: conversations.status, value: count() }).from(conversations).where(eq(conversations.organizationId, organizationId)).groupBy(conversations.status),
    db.select({ status: conversations.status, risk: conversations.risk, priority: conversations.priority, slaPolicy: conversations.slaPolicy, slaStartedAt: conversations.slaStartedAt, slaDueAt: conversations.slaDueAt, createdAt: conversations.createdAt }).from(conversations).where(eq(conversations.organizationId, organizationId)),
  ]);
  const total = Number(totalRow[0]?.value ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const queueCounts = {
    "待接管": Number(statusRows.find((row) => row.status === "needs_human")?.value ?? 0),
    "处理中": statusRows.filter((row) => row.status === "ai_active" || row.status === "human_active").reduce((sum, row) => sum + Number(row.value ?? 0), 0),
    "等待内部": Number(statusRows.find((row) => row.status === "ticketed")?.value ?? 0),
    "已解决": Number(statusRows.find((row) => row.status === "resolved")?.value ?? 0),
  };
  const urgentCount = slaRows.filter((row) => row.status !== "resolved" && (() => {
    const sla = effectiveSla(row, now);
    return sla.state === "overdue" || sla.state === "due_soon";
  })()).length;
  let rows = pageRows;
  if (conversationId && !rows.some((row) => row.id === conversationId)) {
    const [linked] = await db.select().from(conversations).where(and(eq(conversations.organizationId, organizationId), eq(conversations.id, conversationId))).limit(1);
    if (linked) rows = [linked, ...rows.slice(0, Math.max(0, pageSize - 1))];
  }
  const presenceEvents = await db.select({ action: auditLogs.action, metadataJson: auditLogs.metadataJson, createdAt: auditLogs.createdAt }).from(auditLogs).where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.resourceType, "workspace_presence"), inArray(auditLogs.action, ["agent.presence.available", "agent.presence.busy"]))).orderBy(desc(auditLogs.createdAt)).limit(100);
  const currentPresence = presenceEvents.find((event) => parseJson<{ actorEmail?: string }>(event.metadataJson, {}).actorEmail === authenticatedEmail(request));
  const presence = currentPresence?.action === "agent.presence.busy" ? "busy" : "available";
  const pagination = { page, pageSize, total, totalPages };
  if (!rows.length) return Response.json({ conversations: [], assignees, presence, pagination, queueCounts, urgentCount });
  const ids = rows.map((row) => row.id);
  const [turnChunks, states, runChunks] = await Promise.all([
    Promise.all(ids.map((conversationId) => db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(desc(messages.createdAt)).limit(13))),
    db.select().from(agentConversationStates).where(inArray(agentConversationStates.conversationId, ids)),
    Promise.all(ids.map((conversationId) => db.select().from(agentRuns).where(eq(agentRuns.conversationId, conversationId)).orderBy(desc(agentRuns.createdAt)).limit(1))),
  ]);
  const turns = turnChunks.flatMap((chunk) => [...chunk].reverse());
  const turnMap = new Map<string, typeof turns>();
  for (const turn of turns) turnMap.set(turn.conversationId, [...(turnMap.get(turn.conversationId) ?? []), turn]);
  const stateMap = new Map(states.map((state) => [state.conversationId, state]));
  const runMap = new Map(runChunks.map((chunk) => [chunk[0]?.conversationId, chunk[0]]));
  const assigneeMap = new Map(assignees.map((person) => [person.id, person]));
  type StoredCitation = { id?: string; title?: string; version?: string; sourceTitle?: string | null; sourceUrl?: string | null };
  const citationMap = new Map<string, StoredCitation[]>();
  const citationIds = new Set<string>();
  for (const row of rows) {
    const latestAi = [...(turnMap.get(row.id) ?? [])].reverse().find((turn) => turn.senderType === "ai");
    const citations = parseJson<StoredCitation[]>(latestAi?.citationsJson, []).filter((citation) => typeof citation.id === "string" && citation.id.length > 0);
    citationMap.set(row.id, citations);
    for (const citation of citations) if (citation.id) citationIds.add(citation.id);
  }
  const activeCitations = citationIds.size
    ? await db.select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title, version: knowledgeDocuments.version, content: knowledgeDocuments.content, category: knowledgeDocuments.category, sourceTitle: knowledgeDocuments.sourceTitle, sourceUrl: knowledgeDocuments.sourceUrl }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, organizationId), eq(knowledgeDocuments.state, "active"), inArray(knowledgeDocuments.id, [...citationIds])))
    : [];
  const activeCitationMap = new Map(activeCitations.map((document) => [document.id, document]));
  return Response.json({ assignees, presence, pagination, queueCounts, urgentCount, conversations: rows.map((row) => {
    const rowTurns = turnMap.get(row.id) ?? [];
    const latestCustomer = [...rowTurns].reverse().find((turn) => turn.senderType === "customer");
    const latestAi = [...rowTurns].reverse().find((turn) => turn.senderType === "ai");
    const citations = citationMap.get(row.id) ?? [];
    const knowledgeCitations = citations.map((citation) => {
      const document = citation.id ? activeCitationMap.get(citation.id) : undefined;
      return {
        id: citation.id ?? "",
        title: document?.title ?? citation.title ?? citation.id ?? "知识",
        version: document?.version ?? citation.version ?? "",
        category: document?.category ?? null,
        content: document?.content ?? null,
        sourceTitle: document?.sourceTitle ?? citation.sourceTitle ?? null,
        sourceUrl: document?.sourceUrl ?? citation.sourceUrl ?? null,
        available: Boolean(document),
      };
    });
    const trace = parseJson<Array<Record<string, unknown>>>(latestAi?.toolTraceJson, []);
    const latestRun = runMap.get(row.id);
    const state = stateMap.get(row.id);
    const order = latestAi ? trace.find((item) => typeof item.label === "string" && /OR-\d{6}/.test(item.label)) : null;
    const sla = effectiveSla(row, now);
    return {
      id: row.id,
      assignedUserId: row.assignedUserId,
      assignedUserName: row.assignedUserId ? assigneeMap.get(row.assignedUserId)?.displayName ?? null : null,
      name: row.customerName,
      topic: row.topic,
      channel: row.channel,
      status: statusLabel(row.status),
      risk: riskLabel(row.risk),
      priority: sla.priority,
      time: row.updatedAt,
      sla: sla.text,
      slaState: sla.state,
      slaPolicy: sla.policyId,
      slaStartedAt: sla.startedAt,
      slaDueAt: sla.dueAt,
      slaSource: sla.source,
      riskSource: row.riskSource ?? (row.status === "needs_human" ? "Agent 风险策略命中人工接管" : "Agent 知识置信度与业务风险评估"),
      sentiment: row.sentiment === "dissatisfied" ? "强烈不满" : row.sentiment === "anxious" ? "焦虑" : "中性",
      resolutionCategory: row.resolutionCategory,
      resolutionSummary: row.resolutionSummary,
      customerConfirmed: row.customerConfirmed === true,
      resolvedByEmail: row.resolvedByEmail,
      resolvedAt: row.resolvedAt,
      reopenCount: row.reopenCount,
      lastReopenedAt: row.lastReopenedAt,
      lastReopenedByEmail: row.lastReopenedByEmail,
      lastReopenReason: row.lastReopenReason,
      handoff: row.status === "needs_human" ? "Agent 判断需要人工确认，已将完整上下文交给客服" : "当前会话由 Agent 自动处理",
      customerMessage: latestCustomer?.content ?? "等待用户输入",
      aiReply: latestAi?.content ?? "Agent 尚未生成回复",
      history: rowTurns.slice(-12).map((turn) => ({ id: turn.id, senderType: turn.senderType, content: turn.content, createdAt: turn.createdAt, traceId: turn.traceId, trace: turn.senderType === "ai" ? parseJson<Array<Record<string, unknown>>>(turn.toolTraceJson, []) : [] })),
      historyHasMore: rowTurns.length > 12,
      historyCursor: rowTurns.slice(-12)[0]?.createdAt ?? null,
      agentRun: latestRun ? { traceId: latestRun.traceId, model: latestRun.model, mode: latestRun.mode, status: latestRun.status, failureCode: latestRun.failureCode, latencyMs: latestRun.latencyMs, trace: parseJson<Array<Record<string, unknown>>>(latestRun.traceJson, []) } : null,
      summary: state?.summary ?? latestCustomer?.content ?? "暂无会话摘要",
      draft: row.status === "needs_human" ? latestAi?.content ?? "" : "",
      order: typeof order?.label === "string" ? order.label.match(/OR-\d{6}/)?.[0] ?? "无关联订单" : "无关联订单",
      member: "未关联会员信息",
      orderHistory: "等待业务系统接入",
      citations: knowledgeCitations,
      facts: knowledgeCitations.map((citation) => ({ label: "回答依据", value: `${citation.title} ${citation.version}`.trim(), source: citation.available ? "Agent 当前生效引用" : "Agent 历史引用（当前版本不可引用）" })),
      suggestedAction: row.status === "needs_human" ? "核验用户问题" : "查看会话记录",
      persisted: true,
    };
  }) });
}
