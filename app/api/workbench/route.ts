import { and, count, desc, eq, gte, lt, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, conversations, knowledgeDocuments, qualityReviews, strategyVersions, tickets } from "../../../db/schema";
import { tenantIdForRequest } from "../../../lib/tenant";

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

function statusLabel(status: string) {
  return status === "needs_human" ? "待接管" : status === "ticketed" ? "等待内部" : status === "resolved" ? "已解决" : "处理中";
}

function riskLabel(risk: string) {
  return risk === "high" ? "高" : risk === "medium" ? "中" : "低";
}

export async function GET(request: Request) {
  if (!authenticatedEmail(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    const organizationId = tenantIdForRequest(request);
    const db = getDb();
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayStartIso = dayStart.toISOString();
    const nowIso = now.toISOString();
    const dueSoonIso = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const openTicketStates = or(eq(tickets.state, "unassigned"), eq(tickets.state, "in_progress"), eq(tickets.state, "waiting_customer"));
    const countValue = (rows: Array<{ value: number | string }> | undefined) => Number(rows?.[0]?.value ?? 0);
    const [
      conversationRows, ticketRows, knowledgeRows, reviewDocs, pendingReviews, pendingStrategies, auditRows,
      conversationCount, todayConversationCount, needsHumanCount, waitingInternalCount, resolvedTodayCount,
      ticketCount, openTicketCount, p1OpenCount, p1DueSoonCount, overdueP1Count,
      knowledgeCount, activeKnowledgeCount, reviewKnowledgeCount, pendingReviewCount, pendingStrategyCount, highRiskAuditCount,
      topicRows,
    ] = await Promise.all([
      // Task cards intentionally use a bounded recent window; totals below are database aggregates.
      db.select().from(conversations).where(eq(conversations.organizationId, organizationId)).orderBy(desc(conversations.updatedAt)).limit(100),
      db.select().from(tickets).where(and(eq(tickets.organizationId, organizationId), openTicketStates)).orderBy(desc(tickets.slaDueAt)).limit(100),
      db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.organizationId, organizationId)).orderBy(desc(knowledgeDocuments.updatedAt)).limit(100),
      db.select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, organizationId), eq(knowledgeDocuments.state, "review"))).orderBy(desc(knowledgeDocuments.updatedAt)).limit(100),
      db.select().from(qualityReviews).where(and(eq(qualityReviews.organizationId, organizationId), eq(qualityReviews.status, "pending"))).orderBy(desc(qualityReviews.createdAt)).limit(100),
      db.select().from(strategyVersions).where(and(eq(strategyVersions.organizationId, organizationId), eq(strategyVersions.state, "pending_approval"))).orderBy(desc(strategyVersions.createdAt)).limit(100),
      db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.risk, "high"))).orderBy(desc(auditLogs.createdAt)).limit(20),
      db.select({ value: count() }).from(conversations).where(eq(conversations.organizationId, organizationId)),
      db.select({ value: count() }).from(conversations).where(and(eq(conversations.organizationId, organizationId), gte(conversations.createdAt, dayStartIso))),
      db.select({ value: count() }).from(conversations).where(and(eq(conversations.organizationId, organizationId), eq(conversations.status, "needs_human"))),
      db.select({ value: count() }).from(conversations).where(and(eq(conversations.organizationId, organizationId), eq(conversations.status, "ticketed"))),
      db.select({ value: count() }).from(conversations).where(and(eq(conversations.organizationId, organizationId), eq(conversations.status, "resolved"), gte(conversations.updatedAt, dayStartIso))),
      db.select({ value: count() }).from(tickets).where(eq(tickets.organizationId, organizationId)),
      db.select({ value: count() }).from(tickets).where(and(eq(tickets.organizationId, organizationId), openTicketStates)),
      db.select({ value: count() }).from(tickets).where(and(eq(tickets.organizationId, organizationId), eq(tickets.priority, "P1"), openTicketStates)),
      db.select({ value: count() }).from(tickets).where(and(eq(tickets.organizationId, organizationId), eq(tickets.priority, "P1"), openTicketStates, gte(tickets.slaDueAt, nowIso), lt(tickets.slaDueAt, dueSoonIso))),
      db.select({ value: count() }).from(tickets).where(and(eq(tickets.organizationId, organizationId), eq(tickets.priority, "P1"), openTicketStates, lt(tickets.slaDueAt, nowIso))),
      db.select({ value: count() }).from(knowledgeDocuments).where(eq(knowledgeDocuments.organizationId, organizationId)),
      db.select({ value: count() }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, organizationId), eq(knowledgeDocuments.state, "active"))),
      db.select({ value: count() }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.organizationId, organizationId), eq(knowledgeDocuments.state, "review"))),
      db.select({ value: count() }).from(qualityReviews).where(and(eq(qualityReviews.organizationId, organizationId), eq(qualityReviews.status, "pending"))),
      db.select({ value: count() }).from(strategyVersions).where(and(eq(strategyVersions.organizationId, organizationId), eq(strategyVersions.state, "pending_approval"))),
      db.select({ value: count() }).from(auditLogs).where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.risk, "high"))),
      db.select({ topic: conversations.topic, value: count() }).from(conversations).where(and(eq(conversations.organizationId, organizationId), gte(conversations.createdAt, dayStartIso))).groupBy(conversations.topic).orderBy(desc(count())).limit(5),
    ]);
    const todayConversationTotal = countValue(todayConversationCount);
    const topics = topicRows.map((row) => ({ name: row.topic, count: countValue([row]), percentage: todayConversationTotal ? Math.round((countValue([row]) / todayConversationTotal) * 100) : 0 }));
    const pendingReviewRows = pendingReviews;
    const reviewDocRows = reviewDocs;
    const pendingStrategyRows = pendingStrategies;
    const highRiskAuditRows = auditRows;
    const p1Open = ticketRows.filter((row) => row.priority === "P1");
    const tasks = {
      supervisor: [
        ...p1Open.slice(0, 2).map((ticket) => ({ level: "P1", title: ticket.title, meta: `${ticket.id} · ${ticket.customerName} · SLA ${new Date(ticket.slaDueAt).toLocaleString("zh-CN")}`, action: "进入工单", target: "tickets" as const, resourceId: ticket.id })),
        ...pendingReviewRows.slice(0, 2).map((review) => ({ level: "待复核", title: "自动质检结果待人工复核", meta: `${review.id} · ${review.failureCategory ?? "待确认"}`, action: "查看质检", target: "quality" as const })),
      ],
      agent: conversationRows
        .filter((row) => ["needs_human", "ticketed"].includes(row.status))
        .sort((a, b) => {
          const riskOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
          const statusOrder: Record<string, number> = { needs_human: 0, ticketed: 1 };
          return (riskOrder[a.risk] ?? 3) - (riskOrder[b.risk] ?? 3) || (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        })
        .slice(0, 5)
        .map((row) => ({ level: row.status === "ticketed" ? "等待内部" : row.risk === "high" ? "高风险" : "需人工", title: `${row.customerName} · ${row.topic}`, meta: `${row.id} · ${statusLabel(row.status)}`, action: row.status === "needs_human" ? "接管会话" : "继续处理", target: "conversations" as const, resourceId: row.id })),
      "knowledge-operator": [
        ...reviewDocRows.slice(0, 3).map((doc) => ({ level: "待复核", title: doc.title, meta: `${doc.id} ${doc.version} · ${doc.ownerTeam}`, action: "开始复核", target: "knowledge" as const })),
        ...knowledgeRows.filter((doc) => doc.validUntil && new Date(doc.validUntil).getTime() <= Date.now() + 7 * 86400000).slice(0, 2).map((doc) => ({ level: "即将过期", title: doc.title, meta: `${doc.id} · 有效期至 ${new Date(doc.validUntil!).toLocaleDateString("zh-CN")}`, action: "处理知识", target: "knowledge" as const })),
      ],
      "ai-operator": [
        ...pendingReviewRows.slice(0, 3).map((review) => ({ level: "待复核", title: "低置信度质检结果", meta: `${review.id} · ${review.failureCategory ?? "未分类"}`, action: "开始复核", target: "quality" as const })),
        ...reviewDocRows.slice(0, 2).map((doc) => ({ level: "知识缺口", title: doc.title, meta: `${doc.id} ${doc.version} · 待发布知识`, action: "定位失败原因", target: "knowledge" as const })),
      ],
      administrator: [
        ...highRiskAuditRows.slice(0, 3).map((audit) => ({ level: "高风险", title: audit.action, meta: `${audit.resourceId} · ${audit.result}`, action: "查看审计链路", target: "audit" as const })),
        ...pendingStrategyRows.slice(0, 2).map((strategy) => ({ level: "待审批", title: `策略 ${strategy.version} 等待审批`, meta: `${strategy.id} · 生产策略`, action: "进入策略审批", target: "strategy" as const })),
      ],
    };
    return Response.json({
      generatedAt: nowIso,
      dataAsOf: nowIso,
      scope: "organization",
      queryWindow: { taskRows: 100, intervalSeconds: 15 },
      counts: { conversations: countValue(conversationCount), todayConversations: todayConversationTotal, needsHuman: countValue(needsHumanCount), waitingInternal: countValue(waitingInternalCount), resolvedToday: countValue(resolvedTodayCount), tickets: countValue(ticketCount), openTickets: countValue(openTicketCount), p1Open: countValue(p1OpenCount), p1DueSoon: countValue(p1DueSoonCount), overdueP1: countValue(overdueP1Count), knowledge: countValue(knowledgeCount), activeKnowledge: countValue(activeKnowledgeCount), reviewKnowledge: countValue(reviewKnowledgeCount), pendingReviews: countValue(pendingReviewCount), pendingStrategies: countValue(pendingStrategyCount), highRiskAudits: countValue(highRiskAuditCount) },
      topics,
      tasks,
      recentAudit: highRiskAuditRows.slice(0, 6).map((row) => ({ id: row.id, at: row.createdAt, action: row.action, resourceId: row.resourceId, result: row.result, risk: riskLabel(row.risk) })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Workbench metrics unavailable" }, { status: 500 });
  }
}
