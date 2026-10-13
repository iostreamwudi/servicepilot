import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { auditLogs, ticketExportJobs } from "../../../../../db/schema";
import { actorFor, authenticatedEmail } from "../../../../../lib/request-auth";
import { selectTicketExportRows, ticketExportCsv, ticketExportResponse, type TicketExportFilters } from "../../../../../lib/ticket-export";
import { tenantIdForRequest } from "../../../../../lib/tenant";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const organizationId = tenantIdForRequest(request);
  const db = getDb();
  const actor = await actorFor(db, organizationId, email);
  if (!actor) return Response.json({ error: "当前账号没有该工作空间的工单权限" }, { status: 403 });
  const [job] = await db.select().from(ticketExportJobs).where(and(eq(ticketExportJobs.id, id), eq(ticketExportJobs.organizationId, organizationId), eq(ticketExportJobs.actorUserId, actor.id))).limit(1);
  if (!job) return Response.json({ error: "导出任务不存在或已过期" }, { status: 404 });
  if (new Date(job.expiresAt).getTime() < Date.now()) return Response.json({ error: "导出任务已过期，请重新创建" }, { status: 410 });
  if (job.status === "failed") return Response.json({ error: job.error || "导出任务失败，请重试" }, { status: 500 });
  if (job.status === "queued") {
    try {
      const filters = JSON.parse(job.filtersJson) as TicketExportFilters;
      const rows = await selectTicketExportRows(db, organizationId, actor.id, { ...filters, page: undefined, pageSize: undefined });
      const csv = ticketExportCsv(rows);
      await db.update(ticketExportJobs).set({ status: "ready", rowCount: rows.length, content: csv, updatedAt: new Date().toISOString() }).where(and(eq(ticketExportJobs.id, id), eq(ticketExportJobs.organizationId, organizationId)));
      await db.insert(auditLogs).values({ id: `A-${crypto.randomUUID()}`, organizationId, actorUserId: actor.id, actorType: "user", action: "ticket.export.ready", resourceType: "ticket_export", resourceId: id, result: "allowed", risk: "low", metadataJson: JSON.stringify({ rowCount: rows.length }) });
      return ticketExportResponse(csv, job.fileName);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "导出任务失败";
      await db.update(ticketExportJobs).set({ status: "failed", error: message, updatedAt: new Date().toISOString() }).where(and(eq(ticketExportJobs.id, id), eq(ticketExportJobs.organizationId, organizationId)));
      return Response.json({ error: "导出任务失败，请重新创建" }, { status: 500 });
    }
  }
  if (!job.content) return Response.json({ error: "导出结果暂不可用，请重试" }, { status: 503 });
  return ticketExportResponse(job.content, job.fileName);
}
