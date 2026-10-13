export type QueryRewriteIntent = "refund" | "damage" | "address" | "invoice";

export type QueryRewriteInput = {
  query: string;
  intent: QueryRewriteIntent;
  subIntent?: string | null;
  businessAction?: string | null;
  entities?: readonly string[];
  states?: readonly string[];
  evidence?: readonly string[];
  topicEvidence?: readonly string[];
  providedFacts?: readonly string[];
  pendingQuestion?: string | null;
};

export type QueryRewriteResult = {
  accepted: boolean;
  query: string | null;
  preservedSignals: string[];
  reason: string;
};

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?；;：:]/g, "");
}

function clean(value: string, limit = 180) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function unique(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.map((value) => value ? clean(value, 80) : "").filter(Boolean))];
}

/**
 * Builds a model instruction for one retrieval-only rewrite. The model is not
 * asked to answer the customer; it may only normalize the query for recall.
 */
export function buildQueryRewritePrompt(input: QueryRewriteInput) {
  const protectedTokens = [...input.query.matchAll(/OR-\d{6}|1[3-9]\d{9}|\d{17}[\dXx]/gi)].map((match) => match[0]);
  const signals = unique([
    ...(input.evidence ?? []), ...(input.topicEvidence ?? []), ...(input.entities ?? []),
    ...(input.states ?? []), input.businessAction, input.pendingQuestion,
  ]).slice(0, 12);
  return [
    "任务：只把用户问题改写成一条用于企业客服知识检索的短查询，不回答问题。",
    `业务域：${input.intent}`,
    input.subIntent ? `售后子意图：${clean(input.subIntent, 60)}` : null,
    `原始问题：${clean(input.query)}`,
    `已确认信号（只能复用，不能新增事实）：${signals.join("、") || "无"}`,
    protectedTokens.length ? `必须原样保留的标识：${protectedTokens.join("、")}` : null,
    "要求：保留原问题的业务意图、动作、实体、状态和已确认事实；去掉寒暄和无关口头语；不得加入订单状态、政策结论、时间、金额或用户未提供的条件；不得把咨询改成已办理；输出JSON，不要Markdown。",
    '格式：{"query":"不超过180字的检索查询","preservedSignals":["从已确认信号中选择的1至4项"]}',
  ].filter(Boolean).join("\n");
}

function parseObject(raw: string): { query?: unknown; preservedSignals?: unknown } | null {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? parsed as { query?: unknown; preservedSignals?: unknown } : null;
  } catch { return null; }
}

/** Strict output gate: malformed, answer-like, cross-domain, or fact-adding rewrites are rejected. */
export function validateQueryRewrite(raw: string, input: QueryRewriteInput): QueryRewriteResult {
  const parsed = parseObject(raw);
  if (!parsed || typeof parsed.query !== "string" || !Array.isArray(parsed.preservedSignals) || parsed.preservedSignals.some((item) => typeof item !== "string")) {
    return { accepted: false, query: null, preservedSignals: [], reason: "invalid-json-schema" };
  }
  const rewritten = clean(parsed.query);
  if (rewritten.length < 4 || rewritten.length > 180 || /[\r\n]/.test(rewritten)) return { accepted: false, query: null, preservedSignals: [], reason: "length-or-control-character" };
  const original = normalize(input.query);
  const candidate = normalize(rewritten);
  const allowedSignals = unique([
    ...(input.evidence ?? []), ...(input.topicEvidence ?? []), ...(input.entities ?? []),
    ...(input.states ?? []), input.businessAction, input.pendingQuestion,
  ]);
  const preservedSignals = unique(parsed.preservedSignals).filter((signal) => allowedSignals.some((allowed) => normalize(allowed) === normalize(signal))).slice(0, 4);
  if (!preservedSignals.length) return { accepted: false, query: null, preservedSignals: [], reason: "no-preserved-governed-signal" };
  const protectedTokens = [...input.query.matchAll(/OR-\d{6}|1[3-9]\d{9}|\d{17}[\dXx]/gi)].map((match) => normalize(match[0]));
  if (protectedTokens.some((token) => !candidate.includes(token))) return { accepted: false, query: null, preservedSignals, reason: "protected-token-dropped" };
  if (/^(您好|你好|谢谢|不客气)/.test(rewritten) || /已为您|已经为您|保证|一定会|马上到账|具体答案|建议您/.test(rewritten)) return { accepted: false, query: null, preservedSignals, reason: "answer-like-or-commitment" };
  // Require either meaningful lexical continuity or an explicit governed
  // signal. This prevents the rewrite model from changing the customer topic.
  const bigrams = (value: string) => [...value.matchAll(/(?=([\u4e00-\u9fff]{2}))/g)].map((match) => match[1]);
  const originalBigrams = new Set(bigrams(original));
  const sharedBigrams = [...new Set(bigrams(candidate))].filter((gram) => originalBigrams.has(gram)).length;
  if (sharedBigrams === 0 && preservedSignals.every((signal) => !candidate.includes(normalize(signal)))) return { accepted: false, query: null, preservedSignals, reason: "topic-continuity-failed" };
  return { accepted: true, query: rewritten, preservedSignals, reason: "validated" };
}

/** Rewrite only when the first route is weak or relies on context rather than direct evidence. */
export function shouldRunQueryRewrite(input: { matchedSignals?: readonly string[]; contextSource?: string; margin?: number; marginThreshold?: number; structuredEvidence?: readonly string[] }) {
  const directSignals = (input.matchedSignals ?? []).filter((signal) => !signal.startsWith("上下文:") && !signal.startsWith("结构化上下文:") && !signal.startsWith("向量:"));
  if (input.contextSource === "history" || input.contextSource === "memory") return { run: true, reason: "context-derived-route" };
  if (!directSignals.length || !(input.structuredEvidence ?? []).length) return { run: true, reason: "weak-direct-evidence" };
  if (Number.isFinite(input.margin) && Number.isFinite(input.marginThreshold) && (input.margin ?? 0) < (input.marginThreshold ?? 0) * 1.5) return { run: true, reason: "narrow-router-margin" };
  return { run: false, reason: "initial-route-evidence-sufficient" };
}

export function retrievalEvidenceScore(query: string, terms: readonly string[]) {
  const normalized = normalize(query);
  return terms.filter((term) => normalized.includes(normalize(term))).reduce((score, term) => score + Math.min(8, Math.max(1, normalize(term).length)), 0);
}

/** Accept a rewrite only when it increases governed lexical evidence. */
export function shouldAcceptRewrittenKnowledge(input: { originalQuery: string; rewrittenQuery: string; originalTerms: readonly string[]; rewrittenTerms: readonly string[]; originalId: string | null; rewrittenId: string | null; preferredId?: string | null }) {
  if (!input.rewrittenId || !input.originalId) return { accept: false, reason: "missing-knowledge-candidate" };
  const before = retrievalEvidenceScore(input.originalQuery, input.originalTerms);
  const after = retrievalEvidenceScore(input.rewrittenQuery, input.rewrittenTerms);
  if (after <= before) return { accept: false, reason: `no-evidence-gain:${before}->${after}` };
  if (input.rewrittenId !== input.originalId && input.preferredId && input.rewrittenId !== input.preferredId && after - before < 2) return { accept: false, reason: "changed-source-without-margin" };
  return { accept: true, reason: `evidence-gain:${before}->${after}` };
}
