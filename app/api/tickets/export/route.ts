import { getDb } from "../../../../db";
import { auditLogs, ticketExportJobs } from "../../../../db/schema";
import { actorFor, authenticatedEmail, isSupervisor } from "../../../../lib/request-auth";
import { normalizeTicketExportFilters, selectTicketExportRows, ticketExportCsv, ticketExportResponse, type TicketExportMode } from "../../../../lib/ticket-export";
import { tenantIdForRequest } from "../../../../lib/tenant";

type ExportPayload = { mode?: TicketExportMode; page?: number; pageSize?: number; state?: string | null; priority?: string | null; view?: string | null; owner?: string | null; team?: string | null; open?: boolean; q?: string | null; sort?: string | null; ids?: unknown };

function exportFileName(mode: TicketExportMode, page?: number) {
  return mode === "page" ? `servicepilot-tickets-page-${page ?? 1}.csv` : mode === "selected" ? "servicepilot-tickets-selected.csv" : "servicepilot-tickets-filtered.csv";
}

export async function POST(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: ExportPayload;
  try { payload = await request.json() as ExportPayload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const mode = payload.mode;
  if (mode !== "page" && mode !== "selected" && mode !== "filtered") return Response.json({ error: "请选择导出范围" }, { status: 400 });
  const ids = Array.isArray(payload.ids) ? payload.ids.filter((id): id is string => typeof id === "string") : [];
  if (mode === "selected" && (!ids.length || ids.length > 500)) return Response.json({ error: "已选导出需要 1—500 条工单" }, { status: 400 });
  const organizationId = tenantIdForRequest(request);
  const db = getDb();
  const actor = await actorFor(db, organizationId, email);
  if (!actor) return Response.json({ error: "当前账号没有该工作空间的工单权限" }, { status: 403 });
  if (mode === "filtered" && !isSupervisor(actor.role)) return Response.json({ error: "导出全部筛选结果需要主管权限" }, { status: 403 });
  const filters = normalizeTicketExportFilters({ page: payload.page, pageSize: payload.pageSize, state: payload.state, priority: payload.priority, view: payload.view, owner: payload.owner, team: payload.team, open: payload.open, q: payload.q, sort: payload.sort, ids });
  const rows = await selectTicketExportRows(db, organizationId, actor.id, mode === "selected" ? { ...filters, ids } : mode === "page" ? filters : { ...filters, page: undefined, pageSize: undefined });
  const fileName = exportFileName(mode, filters.page);
  if (mode === "filtered" && rows.length > 500) {
    const jobId = `TE-${crypto.randomUUID()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000).toISOString();
    await db.insert(ticketExportJobs).values({ id: jobId, organizationId, actorUserId: actor.id, mode: "filtered", filtersJson: JSON.stringify({ ...filters, page: undefined, pageSize: undefined }), status: "queued", rowCount: rows.length, fileName, expiresAt });
    await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "ticket.export.create", resourceType: "ticket_export", resourceId: jobId, result: "allowed", risk: "low", metadataJson: JSON.stringify({ actorEmail: email, mode, rowCount: rows.length, expiresAt }) });
    return Response.json({ jobId, status: "queued", rowCount: rows.length, message: "导出任务已创建，准备完成后即可下载" }, { status: 202 });
  }
  const csv = ticketExportCsv(rows);
  await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "ticket.export.download", resourceType: "ticket_export", resourceId: `direct-${crypto.randomUUID()}`, result: "allowed", risk: "low", metadataJson: JSON.stringify({ actorEmail: email, mode, rowCount: rows.length }) });
  return ticketExportResponse(csv, fileName);
}
