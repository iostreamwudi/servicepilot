import { assessRetrievalEvidenceSufficiency, type RetrievalEvidenceAssessment, type RetrievalEvidenceCandidate } from "./evidence-sufficiency.ts";
import type { BusinessIntent, ServiceSubIntent } from "./intent-router.ts";

const intentLabels: Record<BusinessIntent, string> = {
  refund: "退款与退货",
  damage: "商品破损与售后",
  address: "收货地址与物流",
  invoice: "发票",
};

const subIntentLabels: Record<ServiceSubIntent, string> = {
  physical_damage: "实物破损",
  quality_issue: "质量或功能异常",
  missing_item: "少件或漏发",
  lost_parcel: "包裹丢失",
  repair: "维修",
  warranty: "保修",
  three_guarantees: "三包",
};

function cleanSegment(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function uniqueSegments(values: readonly (string | null | undefined)[], limit: number) {
  return [...new Set(values.map((value) => value ? cleanSegment(value) : "").filter(Boolean))].slice(0, limit);
}

/**
 * Builds one deterministic correction query from governed routing and verified
 * conversation state. It does not call a model and cannot introduce knowledge
 * facts that were absent from the request or the router taxonomy.
 */
export function buildCorrectiveRetrievalQuery(input: {
  query: string;
  intent: BusinessIntent;
  subIntent?: ServiceSubIntent | null;
  matchedSignals?: readonly string[];
  topicEvidence?: readonly string[];
  providedFacts?: readonly string[];
  pendingQuestion?: string | null;
}) {
  const context = uniqueSegments([
    ...(input.topicEvidence ?? []),
    ...(input.providedFacts ?? []),
    input.pendingQuestion,
  ], 6);
  const routeSignals = uniqueSegments(input.matchedSignals ?? [], 4);
  return [
    `用户原问题：${cleanSegment(input.query)}`,
    `业务类目：${intentLabels[input.intent]}`,
    input.subIntent ? `子任务：${subIntentLabels[input.subIntent]}` : null,
    context.length ? `已确认上下文：${context.join("、")}` : null,
    routeSignals.length ? `路由证据：${routeSignals.join("、")}` : null,
  ].filter(Boolean).join("；").slice(0, 900);
}

export function shouldRunCorrectiveRetrieval(initialEvidence: RetrievalEvidenceAssessment) {
  return !initialEvidence.sufficient;
}

/**
 * A rewritten query may move scores, but it may not manufacture lexical or
 * action evidence. The final gate therefore uses corrected scores/semantics
 * together with governed signals observed on the original query.
 */
export function assessCorrectiveRetrieval(input: {
  baselineSourceId: string | null;
  correctedSourceId: string | null;
  routedSourceId: string | null;
  initialCandidates: readonly RetrievalEvidenceCandidate[];
  correctedCandidates: readonly RetrievalEvidenceCandidate[];
}) {
  const corrected = input.correctedCandidates.find((candidate) => candidate.id === input.correctedSourceId);
  const original = input.initialCandidates.find((candidate) => candidate.id === input.correctedSourceId);
  const governedCandidate = corrected ? {
    ...corrected,
    matchedKeywords: original?.matchedKeywords ?? [],
    actionMatched: original?.actionMatched ?? false,
  } : null;
  return assessRetrievalEvidenceSufficiency({
    currentSourceId: input.baselineSourceId,
    candidateSourceId: input.correctedSourceId,
    routedSourceId: input.routedSourceId,
    candidates: governedCandidate ? [governedCandidate] : [],
  });
}
