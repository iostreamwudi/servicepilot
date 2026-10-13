import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, knowledgeDocuments, memberships, retrievalShadowReviews, retrievalShadowRuns, users } from "../../../../db/schema";
import { analyzeRetrievalShadows } from "../../../../lib/retrieval-shadow-analysis";
import { tenantIdForRequest } from "../../../../lib/tenant";

const reviewRoles = new Set(["quality_reviewer", "product_admin", "system_admin"]);
const reviewDecisions = new Set(["improvement", "regression", "equivalent", "inconclusive"]);

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}
function parseCandidates(value: string) { try { return JSON.parse(value); } catch { return []; } }
function optionalBoolean(value: string | null) { return value === "true" ? true : value === "false" ? false : null; }

async function authorizedReviewer(email: string, organizationId: string) {
  const membership = await getDb().select({ role: memberships.role }).from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(and(eq(users.email, email), eq(memberships.organizationId, organizationId))).limit(1);
  return membership[0] && reviewRoles.has(membership[0].role) ? membership[0] : null;
}

export async function GET(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const organizationId = tenantIdForRequest(request);
  const params = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 200);
  const analysisLimit = Math.min(Math.max(Number(params.get("analysisLimit") ?? 1000) || 1000, limit), 2000);
  const status = params.get("status");
  const intent = params.get("intent");
  const indexVersion = params.get("indexVersion");
  const changed = optionalBoolean(params.get("changed"));
  const reviewDecision = params.get("reviewDecision");
  const db = getDb();
  const [rawRuns, reviews] = await Promise.all([
    db.select().from(retrievalShadowRuns).where(eq(retrievalShadowRuns.organizationId, organizationId)).orderBy(desc(retrievalShadowRuns.createdAt)).limit(analysisLimit),
    db.select().from(retrievalShadowReviews).where(eq(retrievalShadowReviews.organizationId, organizationId)),
  ]);
  const reviewByRun = new Map(reviews.map((review) => [review.shadowRunId, review]));
  const cohort = rawRuns.filter((run) => !indexVersion || run.indexVersion === indexVersion);
  const runs = cohort.filter((run) => (!status || run.status === status) && (!intent || run.intent === intent) && (changed === null || run.changed === changed) && (!reviewDecision || reviewByRun.get(run.id)?.decision === reviewDecision));
  const analysis = analyzeRetrievalShadows(cohort, reviews);
  return Response.json({
    window: { scanned: rawRuns.length, cohort: cohort.length, matched: runs.length, analysisLimit, detailLimit: limit, filters: { status, intent, indexVersion, changed, reviewDecision } },
    ...analysis,
    runs: runs.slice(0, limit).map((row) => ({ ...row, candidates: parseCandidates(row.candidatesJson), review: reviewByRun.get(row.id) ?? null })),
  });
}

export async function POST(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const organizationId = tenantIdForRequest(request);
  if (!await authorizedReviewer(email, organizationId)) return Response.json({ error: "Reviewer role required" }, { status: 403 });
  let payload: { runId?: unknown; decision?: unknown; correctedSourceId?: unknown; note?: unknown };
  try { payload = await request.json() as typeof payload; }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (typeof payload.runId !== "string" || typeof payload.decision !== "string" || !reviewDecisions.has(payload.decision)) return Response.json({ error: "runId and valid decision are required" }, { status: 400 });
  const note = typeof payload.note === "string" ? payload.note.trim() : "";
  if (note.length > 500) return Response.json({ error: "note must be 500 characters or fewer" }, { status: 400 });
  if ((payload.decision === "regression" || payload.decision === "inconclusive") && note.length < 4) return Response.json({ error: "退化或无法判断的样本需要填写复核说明" }, { status: 400 });
  if (payload.correctedSourceId !== undefined && payload.correctedSourceId !== null && typeof payload.correctedSourceId !== "string") return Response.json({ error: "correctedSourceId is invalid" }, { status: 400 });
  const db = getDb();
  const [target] = await db.select().from(retrievalShadowRuns).where(and(eq(retrievalShadowRuns.id, payload.runId), eq(retrievalShadowRuns.organizationId, organizationId))).limit(1);
  if (!target) return Response.json({ error: "Shadow run not found" }, { status: 404 });
  if (target.status !== "completed" || !target.changed) return Response.json({ error: "Only completed candidate changes can be reviewed" }, { status: 409 });
  const correctedSourceId = typeof payload.correctedSourceId === "string" ? payload.correctedSourceId.trim() || null : null;
  if (correctedSourceId) {
    const [source] = await db.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, correctedSourceId), eq(knowledgeDocuments.organizationId, organizationId))).limit(1);
    if (!source) return Response.json({ error: "Corrected source not found in current tenant" }, { status: 400 });
  }
  const reviewedAt = new Date().toISOString();
  const values = {
    id: `RSR-${crypto.randomUUID()}`, organizationId, shadowRunId: target.id, reviewerEmail: email,
    decision: payload.decision as "improvement" | "regression" | "equivalent" | "inconclusive",
    correctedSourceId,
    note, reviewedAt,
  };
  await db.insert(retrievalShadowReviews).values(values).onConflictDoUpdate({ target: retrievalShadowReviews.shadowRunId, set: { reviewerEmail: email, decision: values.decision, correctedSourceId: values.correctedSourceId, note, reviewedAt } });
  await db.insert(auditLogs).values({ id: `A-RSR-${crypto.randomUUID()}`, organizationId, actorType: "user", action: "retrieval_shadow.review", resourceType: "retrieval_shadow_run", resourceId: target.id, result: "allowed", risk: values.decision === "regression" ? "medium" : "low", metadataJson: JSON.stringify({ reviewerEmail: email, decision: values.decision, indexVersion: target.indexVersion }) });
  return Response.json({ review: values }, { status: 201 });
}
