import { and, desc, eq, gt, inArray, isNull, like, lt, or } from "drizzle-orm";
import { getDb } from "../db";
import { conversations, tickets, users } from "../db/schema";
import { ticketPriorities, ticketStates } from "./ticket-policy";

export type TicketExportMode = "page" | "selected" | "filtered";
export type TicketExportFilters = {
  page?: number;
  pageSize?: number;
  state?: string | null;
  priority?: string | null;
  view?: string | null;
  owner?: string | null;
  team?: string | null;
  open?: boolean;
  q?: string | null;
  sort?: string | null;
  ids?: string[];
};

export function normalizeTicketExportFilters(input: TicketExportFilters): TicketExportFilters {
  const page = Number.isInteger(input.page) && (input.page ?? 0) > 0 ? Math.min(input.page!, 10_000) : 1;
  const pageSize = Number.isInteger(input.pageSize) && (input.pageSize ?? 0) >= 5 ? Math.min(input.pageSize!, 100) : 25;
  return {
    page,
    pageSize,
    state: input.state && ticketStates.includes(input.state as typeof ticketStates[number]) ? input.state : null,
    priority: input.priority && ticketPriorities.includes(input.priority as typeof ticketPriorities[number]) ? input.priority : null,
    view: input.view ?? "all",
    owner: input.owner ?? null,
    team: input.team ?? null,
    open: Boolean(input.open),
    q: input.q?.trim().slice(0, 100) ?? "",
    sort: input.sort === "priority" || input.sort === "created" || input.sort === "sla" ? input.sort : "updated",
    ids: input.ids?.filter((id) => /^T-[A-Za-z0-9-]{1,120}$/.test(id)).slice(0, 500),
  };
}

export async function selectTicketExportRows(db: ReturnType<typeof getDb>, organizationId: string, actorId: string, input: TicketExportFilters) {
  const filters = normalizeTicketExportFilters(input);
  const conditions = [eq(tickets.organizationId, organizationId)];
  if (filters.ids?.length) conditions.push(inArray(tickets.id, filters.ids));
  if (filters.state) conditions.push(eq(tickets.state, filters.state as typeof ticketStates[number]));
  if (filters.priority) conditions.push(eq(tickets.priority, filters.priority as typeof ticketPriorities[number]));
  if (filters.owner === "unassigned") conditions.push(isNull(tickets.ownerUserId));
  else if (filters.owner) conditions.push(eq(tickets.ownerUserId, filters.owner));
  if (filters.team === "unassigned") conditions.push(isNull(tickets.teamKey));
  else if (filters.team) conditions.push(eq(tickets.teamKey, filters.team));
  if (filters.view === "mine") conditions.push(eq(tickets.ownerUserId, actorId));
  if (filters.view === "unassigned") conditions.push(isNull(tickets.ownerUserId));
  const openStates = or(eq(tickets.state, "unassigned"), eq(tickets.state, "in_progress"), eq(tickets.state, "waiting_customer"));
  if (filters.open) conditions.push(openStates!);
  if (filters.view === "overdue") conditions.push(and(openStates, lt(tickets.slaDueAt, new Date().toISOString()))!);
  if (filters.view === "due_soon") conditions.push(and(openStates, lt(tickets.slaDueAt, new Date(Date.now() + 30 * 60_000).toISOString()), gt(tickets.slaDueAt, new Date().toISOString()))!);
  if (filters.q) conditions.push(or(like(tickets.id, `%${filters.q}%`), like(tickets.title, `%${filters.q}%`), like(tickets.customerName, `%${filters.q}%`))!);
  const query = db.select({
    id: tickets.id, title: tickets.title, customerName: tickets.customerName, priority: tickets.priority, state: tickets.state,
    ownerName: users.displayName, ownerEmail: users.email, teamKey: tickets.teamKey, slaDueAt: tickets.slaDueAt, updatedAt: tickets.updatedAt,
    createdAt: tickets.createdAt, sourceType: tickets.sourceType,
  }).from(tickets).leftJoin(users, eq(tickets.ownerUserId, users.id)).leftJoin(conversations, eq(tickets.conversationId, conversations.id)).where(and(...conditions))
    .orderBy(filters.sort === "priority" ? tickets.priority : filters.sort === "created" ? desc(tickets.createdAt) : filters.sort === "sla" ? tickets.slaDueAt : desc(tickets.updatedAt), desc(tickets.updatedAt), desc(tickets.createdAt));
  if (filters.ids?.length) return query;
  if (input.page !== undefined || input.pageSize !== undefined) return query.limit(filters.pageSize!).offset((filters.page! - 1) * filters.pageSize!);
  return query;
}

export function ticketExportCsv(rows: Array<{ id: string; title: string; customerName: string; priority: string; ownerName: string | null; ownerEmail: string | null; teamKey: string | null; slaDueAt: string; state: string; updatedAt: string; createdAt: string; sourceType: string }>) {
  const csvValue = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines = [
    ["工单号", "标题", "客户", "优先级", "负责人", "负责人邮箱", "团队", "SLA截止时间", "状态", "最近更新", "创建时间", "数据来源"],
    ...rows.map((ticket) => [ticket.id, ticket.title, ticket.customerName, ticket.priority, ticket.ownerName || "待分配", ticket.ownerEmail || "", ticket.teamKey || "未设置", ticket.slaDueAt, ticket.state, ticket.updatedAt, ticket.createdAt, ticket.sourceType]),
  ].map((line) => line.map(csvValue).join(","));
  return `\ufeff${lines.join("\n")}`;
}

export function ticketExportResponse(csv: string, fileName: string) {
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "no-store" } });
}
