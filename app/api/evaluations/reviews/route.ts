import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, evaluationResults, evaluationReviews, evaluationRuns, memberships, users } from "../../../../db/schema";

const ORG_ID = "org-qingyu";
const reviewRoles = new Set(["quality_reviewer", "product_admin", "system_admin"]);

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

async function authorizedReviewer(email: string) {
  const db = getDb();
  const membership = await db.select({ role: memberships.role }).from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(and(eq(users.email, email), eq(memberships.organizationId, ORG_ID))).limit(1);
  return membership[0] && reviewRoles.has(membership[0].role) ? membership[0] : null;
}

export async function GET(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!await authorizedReviewer(email)) return Response.json({ error: "Reviewer role required" }, { status: 403 });
  const db = getDb();
  const latest = await db.select().from(evaluationRuns)
    .where(and(eq(evaluationRuns.organizationId, ORG_ID), eq(evaluationRuns.status, "completed")))
    .orderBy(desc(evaluationRuns.startedAt)).limit(1);
  if (!latest[0]) return Response.json({ run: null, items: [], summary: { pending: 0, reviewed: 0 } });
  const [failed, reviews] = await Promise.all([
    db.select().from(evaluationResults).where(and(eq(evaluationResults.runId, latest[0].id), eq(evaluationResults.passed, false))),
    db.select().from(evaluationReviews).where(eq(evaluationReviews.organizationId, ORG_ID)),
  ]);
  const reviewByResult = new Map(reviews.map((review) => [review.evaluationResultId, review]));
  const items = failed.map((item) => ({ ...item, failures: JSON.parse(item.failuresJson) as string[], routingSignals: JSON.parse(item.routingSignalsJson) as string[], review: reviewByResult.get(item.id) ?? null }));
  return Response.json({ run: latest[0], items, summary: { pending: items.filter((item) => !item.review).length, reviewed: items.filter((item) => item.review).length } });
}

export async function POST(request: Request) {
  const email = authenticatedEmail(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!await authorizedReviewer(email)) return Response.json({ error: "Reviewer role required" }, { status: 403 });
  let payload: { resultId?: unknown; decision?: unknown; correctedSource?: unknown; correctedHandoff?: unknown; note?: unknown };
  try { payload = await request.json() as typeof payload; }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const decisions = ["confirmed_failure", "label_issue", "accepted_behavior"];
  if (typeof payload.resultId !== "string" || !decisions.includes(String(payload.decision))) return Response.json({ error: "resultId and valid decision are required" }, { status: 400 });
  const note = typeof payload.note === "string" ? payload.note.trim() : "";
  if (note.length > 500) return Response.json({ error: "note must be 500 characters or fewer" }, { status: 400 });
  if (payload.decision === "label_issue" && note.length < 4) return Response.json({ error: "标签问题需要填写复核说明" }, { status: 400 });
  if (payload.correctedSource !== undefined && payload.correctedSource !== null && typeof payload.correctedSource !== "string") return Response.json({ error: "correctedSource is invalid" }, { status: 400 });
  if (payload.correctedHandoff !== undefined && payload.correctedHandoff !== null && typeof payload.correctedHandoff !== "boolean") return Response.json({ error: "correctedHandoff is invalid" }, { status: 400 });
  const db = getDb();
  const target = await db.select({ id: evaluationResults.id }).from(evaluationResults)
    .innerJoin(evaluationRuns, eq(evaluationRuns.id, evaluationResults.runId))
    .where(and(eq(evaluationResults.id, payload.resultId), eq(evaluationRuns.organizationId, ORG_ID))).limit(1);
  if (!target[0]) return Response.json({ error: "Evaluation result not found" }, { status: 404 });
  const reviewedAt = new Date().toISOString();
  const values = {
    id: `EQR-${crypto.randomUUID()}`, organizationId: ORG_ID, evaluationResultId: payload.resultId,
    reviewerEmail: email, decision: payload.decision as "confirmed_failure" | "label_issue" | "accepted_behavior",
    correctedSource: typeof payload.correctedSource === "string" ? payload.correctedSource : null,
    correctedHandoff: typeof payload.correctedHandoff === "boolean" ? payload.correctedHandoff : null,
    note, reviewedAt,
  };
  await db.insert(evaluationReviews).values(values).onConflictDoUpdate({ target: evaluationReviews.evaluationResultId, set: { reviewerEmail: email, decision: values.decision, correctedSource: values.correctedSource, correctedHandoff: values.correctedHandoff, note, reviewedAt } });
  await db.insert(auditLogs).values({ id: `A-EQR-${crypto.randomUUID()}`, organizationId: ORG_ID, actorType: "user", action: "evaluation.review", resourceType: "evaluation_result", resourceId: payload.resultId, result: "allowed", risk: payload.decision === "label_issue" ? "medium" : "low", metadataJson: JSON.stringify({ reviewerEmail: email, decision: payload.decision }) });
  return Response.json({ review: values }, { status: 201 });
}
