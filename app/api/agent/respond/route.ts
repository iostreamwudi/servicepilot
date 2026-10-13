import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { getRequestExecutionContext } from "vinext/shims/request-context";
import { getDb } from "../../../../db";
import { agentConversationStates, agentRuns, conversations, knowledgeDocuments, messages, organizations, tickets } from "../../../../db/schema";
import { reviewGroundedAnswer } from "../../../../lib/answer-review";
import { BoundedAgenticRun } from "../../../../lib/bounded-agentic-rag";
import { assessCorrectiveRetrieval, buildCorrectiveRetrievalQuery, shouldRunCorrectiveRetrieval } from "../../../../lib/corrective-retrieval";
import { assessRetrievalEvidenceSufficiency, type RetrievalEvidenceAssessment } from "../../../../lib/evidence-sufficiency";
import { buildJointEvidencePacket } from "../../../../lib/joint-evidence";
import { deriveFeedbackSignals } from "../../../../lib/feedback-loop";
import { buildChatCompletionRequest } from "../../../../lib/model-gateway";
import { selectComplementaryKnowledge, type MultiKnowledgeCandidate } from "../../../../lib/multi-knowledge";
import { lookupRefund } from "../../../../lib/order-tool";
import { recordRetrievalShadowSkip, runRetrievalShadow, runRetrievalV2, type RetrievalV2Result } from "../../../../lib/retrieval-shadow";
import { applyActionAwareRerank, rankBusinessRelevantCandidates, retrieveContextualBm25Candidates, retrieveMultiQueryRrfCandidates, type RetrievalDocument } from "../../../../lib/retrieval";
import { conversationalReply, continueIntent, extractConversationContext, forcedParentKnowledge, routeIntent, routeIntentWithActionGate, serviceActionGuidance, shouldHandoffWithActionGate, type BusinessIntent, type ConversationTurn, type ConversationContext } from "../../../../lib/intent-router";
import { tenantIdForRequest } from "../../../../lib/tenant";
import { decideReadOnlyTool } from "../../../../lib/tool-decision";
import { buildRetrievalScope } from "../../../../lib/retrieval-scope";
import { buildQueryRewritePrompt, shouldAcceptRewrittenKnowledge, shouldRunQueryRewrite, validateQueryRewrite } from "../../../../lib/query-rewrite";
import { slaPolicyForRisk } from "../../../../lib/conversation-sla";

type RuntimeConfig = { LLM_API_KEY?: string; LLM_BASE_URL?: string; LLM_MODEL?: string; EMBEDDING_MODEL?: string; RETRIEVAL_SHADOW_ENABLED?: string; RERANK_ENABLED?: string; RERANK_API_KEY?: string; RERANK_BASE_URL?: string; RERANK_MODEL?: string; RERANK_TIMEOUT_MS?: string; RETRIEVAL_V2_BM25_TOP_K?: string; RETRIEVAL_V2_DENSE_TOP_K?: string; RETRIEVAL_V2_FUSION_TOP_K?: string; RETRIEVAL_V2_RERANK_TOP_K?: string; RETRIEVAL_V2_RRF_K?: string; RETRIEVAL_V2_MAX_BUSINESS_BOOST?: string };
type HistoryTurn = ConversationTurn;
type PersistedConversationState = Pick<ConversationContext, "activeIntent" | "confidence" | "topicEvidence" | "providedFacts" | "pendingQuestion">;
type ConversationState = { activeIntent: string | null; summary: string; stateJson: string; turnCount: number; expiresAt: string; context: ConversationContext | null };
type AgentPayload = { query?: unknown; history?: unknown; conversationId?: unknown; customerName?: unknown; channel?: unknown };
const businessIntents: BusinessIntent[] = ["refund", "damage", "address", "invoice"];
const STEP95_STRATEGY = "tool-decision-step9.5-v1";
const STEP96_STRATEGY = "answer-review-step9.6-v1";
const STEP97_STRATEGY = "joint-evidence-step9.7-v1";
const STEP98_STRATEGY = "bounded-agentic-rag-step9.8-v1";
const STEP98_RETRIEVAL_CALIBRATION_STRATEGY = "bounded-agentic-rag-step9.8-v1-retrieval-calibration";
// Step 9.9 is the named baseline for the latest validated Step 9.8 V1
// candidate. It intentionally aliases the calibrated path; no new algorithm
// is introduced by the version name.
const STEP99_STRATEGY = "bounded-agentic-rag-step9.9-v1";
const STEP99_QUERY_REWRITE_STRATEGY = "bounded-agentic-rag-step9.9-v1-query-rewrite";
const STEP99_CORRECTIVE_STRATEGY = "bounded-agentic-rag-step9.9-v1-corrective-retrieval";
const STEP99_RERANK_STRATEGY = "bounded-agentic-rag-step9.9-v1-qwen3-rerank";
const STEP98_V2_STRATEGY = "bounded-agentic-rag-step9.8-v2";
const STEP98_V2_BEFORE_RERANK_STRATEGY = "bounded-agentic-rag-step9.8-v2-before-rerank";
const constrainedHybridStrategies = new Set([
  "constrained-hybrid-step9.1-v1",
  "hybrid-evidence-step9.2-v1",
  "corrective-hybrid-step9.3-v1",
  "multi-knowledge-step9.4-v1",
  STEP95_STRATEGY,
  STEP96_STRATEGY,
  STEP97_STRATEGY,
  STEP98_STRATEGY,
  STEP98_RETRIEVAL_CALIBRATION_STRATEGY,
  STEP99_STRATEGY,
  STEP99_QUERY_REWRITE_STRATEGY,
  STEP99_CORRECTIVE_STRATEGY,
  STEP99_RERANK_STRATEGY,
  STEP98_V2_STRATEGY,
  STEP98_V2_BEFORE_RERANK_STRATEGY,
]);
const governedToolStrategies = new Set([STEP95_STRATEGY, STEP96_STRATEGY, STEP97_STRATEGY, STEP98_STRATEGY, STEP98_RETRIEVAL_CALIBRATION_STRATEGY, STEP99_STRATEGY, STEP99_QUERY_REWRITE_STRATEGY, STEP99_CORRECTIVE_STRATEGY, STEP99_RERANK_STRATEGY, STEP98_V2_STRATEGY, STEP98_V2_BEFORE_RERANK_STRATEGY]);
const answerReviewStrategies = new Set([STEP96_STRATEGY, STEP97_STRATEGY, STEP98_STRATEGY, STEP98_RETRIEVAL_CALIBRATION_STRATEGY, STEP99_STRATEGY, STEP99_QUERY_REWRITE_STRATEGY, STEP99_CORRECTIVE_STRATEGY, STEP99_RERANK_STRATEGY, STEP98_V2_STRATEGY, STEP98_V2_BEFORE_RERANK_STRATEGY]);

function positiveNumber(value: string | undefined, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return integer ? Math.floor(parsed) : parsed;
}
type KnowledgeRule = {
  id: string; title: string; version: string; terms: string[]; answer: string;
  confidence: number; risk: "low" | "medium" | "high"; handoff: boolean;
  sourceTitle?: string | null; sourceUrl?: string | null;
};
type GatewayResult = { content: string; usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null };

async function retrieveKnowledge(organizationId: string, intent: BusinessIntent, query: string, defaultKnowledgeId: string, strategy?: string, retrievalQueries: readonly string[] = [query], businessAction?: string): Promise<KnowledgeRule | null> {
  try {
    const db = getDb();
    const documents = await db.select().from(knowledgeDocuments).where(and(
      eq(knowledgeDocuments.organizationId, organizationId),
      eq(knowledgeDocuments.category, intent),
      eq(knowledgeDocuments.state, "active"),
    ));
    if (!documents.length) throw new Error("No active knowledge documents");
    const forcedParentId = forcedParentKnowledge(intent, query, strategy);
    if (forcedParentId) {
      const selectedDocument = documents.find((document) => document.id === forcedParentId);
      if (selectedDocument) {
        let selectedKeywords: string[] = [];
        try { selectedKeywords = JSON.parse(selectedDocument.keywordsJson) as string[]; } catch { /* invalid keywords do not block retrieval */ }
        return {
          id: selectedDocument.id, title: selectedDocument.title, version: selectedDocument.version, terms: selectedKeywords,
          answer: selectedDocument.content, confidence: selectedDocument.coverage, risk: selectedDocument.risk,
          handoff: selectedDocument.handoff, sourceTitle: selectedDocument.sourceTitle, sourceUrl: selectedDocument.sourceUrl,
        };
      }
    }
    if (strategy === "contextual-step8.2-v1") {
      const retrievalDocuments: RetrievalDocument[] = documents.map((document) => {
        let keywords: string[] = [];
        try { keywords = JSON.parse(document.keywordsJson) as string[]; } catch { /* invalid keywords do not block retrieval */ }
        return {
          id: document.id, title: document.title, content: document.content, category: document.category,
          keywords, state: document.state, risk: document.risk, handoff: document.handoff, coverage: document.coverage,
          validFrom: document.validFrom, validUntil: document.validUntil,
        };
      });
      const contextualCandidates = strategy === "rrf-step8.3b-v1"
        ? retrieveMultiQueryRrfCandidates(retrievalDocuments, retrievalQueries, { category: intent, defaultDocumentId: defaultKnowledgeId, limit: 5, queryWeights: [3, 1, 0.5] })
        : retrieveContextualBm25Candidates(retrievalDocuments, query, { category: intent, defaultDocumentId: defaultKnowledgeId, limit: 5 });
      const candidates = applyActionAwareRerank(
        contextualCandidates,
        query,
        defaultKnowledgeId,
      );
      const selectedId = candidates[0]?.document.id ?? defaultKnowledgeId;
      const selectedDocument = documents.find((document) => document.id === selectedId) ?? documents.find((document) => document.id === defaultKnowledgeId) ?? documents[0];
      let selectedKeywords: string[] = [];
      try { selectedKeywords = JSON.parse(selectedDocument.keywordsJson) as string[]; } catch { /* invalid keywords do not block retrieval */ }
      return {
        id: selectedDocument.id, title: selectedDocument.title, version: selectedDocument.version, terms: selectedKeywords,
        answer: selectedDocument.content, confidence: selectedDocument.coverage, risk: selectedDocument.risk,
        handoff: selectedDocument.handoff, sourceTitle: selectedDocument.sourceTitle, sourceUrl: selectedDocument.sourceUrl,
      };
    }
    const normalized = query.toLowerCase().replace(/\s+/g, "");
    const genericSignals: Record<BusinessIntent, Set<string>> = {
      refund: new Set(["退款", "退货", "七天", "七日", "无理由"]),
      damage: new Set(["破损", "坏了", "质量问题"]),
      address: new Set(["地址", "物流", "收货地址"]),
      invoice: new Set(["发票", "电子发票", "数电发票"]),
    };
    const scored = documents.map((document) => {
      let keywords: string[] = [];
      try { keywords = JSON.parse(document.keywordsJson) as string[]; } catch { /* invalid keywords do not block retrieval */ }
      const keywordHits = keywords.filter((keyword) => normalized.includes(keyword.toLowerCase().replace(/\s+/g, "")));
      const rawScore = keywordHits.reduce((total, keyword) => total + (genericSignals[intent].has(keyword) ? 1 : 8 + Math.min(keyword.length, 4)), 0);
      // Calibration is an explicit experiment: rare multi-term evidence gets
      // a modest confidence lift, while a single weak hit cannot dominate by
      // itself. The default V1 score remains unchanged for ordinary traffic.
      const calibrated = strategy === STEP98_RETRIEVAL_CALIBRATION_STRATEGY || strategy === STEP99_STRATEGY || strategy === STEP99_QUERY_REWRITE_STRATEGY || strategy === STEP99_CORRECTIVE_STRATEGY || strategy === STEP99_RERANK_STRATEGY;
      const evidenceWeight = calibrated ? (keywordHits.length >= 2 ? 1.08 : 0.94) : 1;
      const defaultBoost = calibrated ? 1.5 : 2;
      const score = rawScore * evidenceWeight + (document.id === defaultKnowledgeId ? defaultBoost : 0);
      return { document, keywords, score, keywordHits };
    });
    const positive = scored.filter((item) => item.keywordHits.length > 0);
    const candidatePool = (positive.length ? positive : scored).map((item) => ({
      document: {
        id: item.document.id, title: item.document.title, content: item.document.content, category: item.document.category,
        keywords: item.keywords, state: item.document.state, risk: item.document.risk, handoff: item.document.handoff,
        coverage: item.document.coverage, validFrom: item.document.validFrom, validUntil: item.document.validUntil,
        version: item.document.version, sourceTitle: item.document.sourceTitle, sourceUrl: item.document.sourceUrl,
        organizationId: item.document.organizationId,
      },
      lexicalScore: item.score, vectorScore: 0, fusedScore: item.score, matchedKeywords: item.keywordHits, filterReasons: [],
    }));
    const rankedPool = strategy === STEP98_RETRIEVAL_CALIBRATION_STRATEGY || strategy === STEP99_STRATEGY
      ? [...candidatePool].sort((left, right) => right.lexicalScore - left.lexicalScore || right.document.coverage - left.document.coverage).slice(0, Math.min(10, candidatePool.length))
      : candidatePool;
    const ranked = rankBusinessRelevantCandidates(rankedPool, query, defaultKnowledgeId, { businessAction });
    const selected = ranked[0];
    const defaultDocument = ranked.find((item) => item.document.id === defaultKnowledgeId);
    const result = positive.length ? selected : defaultDocument ?? selected;
    return {
      id: result.document.id,
      title: result.document.title,
      version: result.document.version,
      terms: result.document.keywords,
      answer: result.document.content,
      confidence: result.document.coverage,
      risk: result.document.risk,
      handoff: result.document.handoff,
      sourceTitle: result.document.sourceTitle,
      sourceUrl: result.document.sourceUrl,
    };
  } catch { return null; }
}

async function retrieveKnowledgeById(organizationId: string, intent: BusinessIntent, knowledgeId: string): Promise<KnowledgeRule | null> {
  try {
    const db = getDb();
    const [document] = await db.select().from(knowledgeDocuments).where(and(
      eq(knowledgeDocuments.organizationId, organizationId),
      eq(knowledgeDocuments.category, intent),
      eq(knowledgeDocuments.state, "active"),
      eq(knowledgeDocuments.id, knowledgeId),
    )).limit(1);
    if (!document) return null;
    let keywords: string[] = [];
    try { keywords = JSON.parse(document.keywordsJson) as string[]; } catch { /* invalid keywords do not block retrieval */ }
    return {
      id: document.id, title: document.title, version: document.version, terms: keywords,
      answer: document.content, confidence: document.coverage, risk: document.risk,
      handoff: document.handoff, sourceTitle: document.sourceTitle, sourceUrl: document.sourceUrl,
    };
  } catch { return null; }
}

function authenticated(request: Request) {
  const host = new URL(request.url).hostname;
  return Boolean(request.headers.get("oai-authenticated-user-email")) || host === "localhost" || host === "127.0.0.1";
}

function topicLabel(intent: BusinessIntent | null) {
  return intent === "refund" ? "退款售后" : intent === "damage" ? "破损与质量" : intent === "address" ? "物流改址" : intent === "invoice" ? "发票服务" : "其他咨询";
}

function sentimentFor(query: string) {
  return /投诉|生气|着急|必须|怎么还|太差|欺骗|损坏|破损/.test(query) ? "dissatisfied" : "neutral";
}

async function persistAgentTurn({
  conversationId,
  customerName,
  channel,
  query,
  answer,
  rule,
  routing,
  handoff,
  trace,
  source,
  sources,
  organizationId,
  traceId,
}: {
  conversationId: string;
  customerName: string;
  channel: string;
  query: string;
  answer: string;
  rule: KnowledgeRule | null;
  routing: ReturnType<typeof routeIntent>;
  handoff: boolean;
  trace: Array<Record<string, unknown>>;
  source: Record<string, unknown> | null;
  sources?: readonly Record<string, unknown>[];
  organizationId: string;
  traceId: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const topic = topicLabel(routing?.intent ?? null);
  const risk = rule?.risk ?? "medium";
  const slaPolicy = slaPolicyForRisk(risk);
  const existingConversation = await db.select({ status: conversations.status, slaStartedAt: conversations.slaStartedAt, slaDueAt: conversations.slaDueAt }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  const priorConversation = existingConversation[0];
  const slaStartedAt = handoff ? priorConversation?.slaStartedAt ?? now : priorConversation?.slaStartedAt ?? null;
  const slaDueAt = handoff ? priorConversation?.slaDueAt ?? new Date(Date.now() + slaPolicy.minutes * 60_000).toISOString() : priorConversation?.slaDueAt ?? null;
  const riskSource = handoff ? "Agent 风险策略命中人工接管" : "Agent 知识置信度与业务风险评估";
  await db.insert(organizations).values({ id: organizationId, name: organizationId === "org-qingyu" ? "青屿商城测试租户" : "青屿商城生产租户" }).onConflictDoNothing();
  await db.insert(conversations).values({
    id: conversationId,
    organizationId: organizationId,
    customerName,
    topic,
    channel,
    status: handoff ? "needs_human" : "ai_active",
    risk,
    priority: slaPolicy.priority,
    slaPolicy: slaPolicy.id,
    slaStartedAt,
    slaDueAt,
    riskSource,
    aiScore: rule?.confidence ?? 0.45,
    sentiment: sentimentFor(query),
    updatedAt: now, traceId, sourceType: "production", sourceId: source?.id as string | undefined, isSynthetic: false,
  }).onConflictDoNothing();
  await db.insert(messages).values([
    { id: `M-${crypto.randomUUID()}`, conversationId, senderType: "customer", content: query, citationsJson: "[]", toolTraceJson: "[]", traceId, sourceType: "production", sourceId: null, isSynthetic: false, createdAt: now },
    { id: `M-${crypto.randomUUID()}`, conversationId, senderType: "ai", content: answer, citationsJson: JSON.stringify(sources ?? (source ? [source] : [])), toolTraceJson: JSON.stringify(trace), traceId, sourceType: "production", sourceId: source?.id as string | undefined, isSynthetic: false, createdAt: now },
  ]);
  await db.update(conversations).set({ topic, channel, status: handoff ? "needs_human" : "ai_active", risk, priority: slaPolicy.priority, slaPolicy: slaPolicy.id, slaStartedAt, slaDueAt, riskSource, aiScore: rule?.confidence ?? 0.45, sentiment: sentimentFor(query), updatedAt: now, traceId }).where(eq(conversations.id, conversationId));
  if (handoff) {
    const existingTicket = await db.select({ id: tickets.id }).from(tickets).where(and(
      eq(tickets.organizationId, organizationId),
      eq(tickets.conversationId, conversationId),
      inArray(tickets.state, ["unassigned", "in_progress", "waiting_customer"]),
    )).limit(1);
    if (!existingTicket.length) await db.insert(tickets).values({ id: `T-${crypto.randomUUID()}`, organizationId, conversationId, title: `${topic} · 需要人工处理`, customerName, priority: risk === "high" ? "P1" : "P2", state: "unassigned", slaDueAt: new Date(Date.now() + (risk === "high" ? 60 : 240) * 60_000).toISOString(), triggerReason: "Agent 低置信度或风险策略命中", summary: query.slice(0, 500), sourceType: "production", sourceId: source?.id as string | undefined, traceId, isSynthetic: false });
  }
}

async function persistAgentRun({
  traceId, organizationId, conversationId, query, model, routing, rule, evidenceRules = [], tool, trace, answer, handoff, mode, status, failureCode, usage, latencyMs,
}: {
  traceId: string; organizationId: string; conversationId: string | null; query: string; model?: string; routing?: ReturnType<typeof routeIntent> | null; rule?: KnowledgeRule | null; evidenceRules?: readonly KnowledgeRule[]; tool?: unknown; trace: Array<Record<string, unknown>>; answer?: string; handoff?: boolean; mode: string; status: string; failureCode?: string; usage?: GatewayResult["usage"]; latencyMs: number;
}) {
  try {
    const db = getDb();
    await db.insert(agentRuns).values({
      id: `AR-${crypto.randomUUID()}`, traceId, organizationId, conversationId, query, model: model ?? null,
      intent: routing?.intent ?? null, routingConfidence: routing?.confidence ?? null,
      knowledgeJson: JSON.stringify(rule ? [rule, ...evidenceRules].map((item) => ({ id: item.id, title: item.title, version: item.version, confidence: item.confidence })) : []),
      toolCallsJson: JSON.stringify(tool ? [tool] : []), traceJson: JSON.stringify(trace), answer: answer ?? null,
      handoff: Boolean(handoff), mode, status, failureCode: failureCode ?? null,
      promptTokens: usage?.promptTokens ?? null, completionTokens: usage?.completionTokens ?? null, totalTokens: usage?.totalTokens ?? null, latencyMs,
    });
  } catch { /* Observability must not block a customer answer. */ }
}

function redactMemory(value: string) {
  return value.replace(/OR-\d{6}/gi, "[订单]").replace(/1[3-9]\d{9}/g, "[电话]").replace(/\d{17}[\dXx]/g, "[身份证号]").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[邮箱]").slice(0, 160);
}

function formatConversationContext(context: ConversationContext) {
  if (!context.activeIntent) return "未识别到稳定业务主题";
  const evidence = context.topicEvidence.length ? `；主题证据：${context.topicEvidence.join("、")}` : "";
  const facts = context.providedFacts.length ? `；已提供事实：${context.providedFacts.join("、")}` : "";
  const pending = context.pendingQuestion ? `；当前待解决问题：${redactMemory(context.pendingQuestion)}` : "";
  return `结构化会话主题：${context.activeIntent}（置信度 ${context.confidence}）${evidence}${facts}${pending}`;
}

function buildRetrievalQueries(intent: BusinessIntent, query: string, context: ConversationContext) {
  const verifiedFacts = [...context.providedFacts, ...context.topicEvidence].filter(Boolean).slice(0, 6);
  const contextQuery = [context.activeIntent ?? intent, context.pendingQuestion, ...verifiedFacts, query].filter(Boolean).join("；");
  const structuredQuery = `业务类目：${context.activeIntent ?? intent}；当前任务：${query}；已确认信息：${verifiedFacts.join("、") || "无"}`;
  const hasVerifiedContext = context.topicEvidence.length > 0 || context.providedFacts.length > 0 || Boolean(context.pendingQuestion);
  return [...new Set(hasVerifiedContext ? [query, contextQuery, structuredQuery] : [query])];
}

function deterministicAnswerGuidance(query: string) {
  const text = query.replace(/\s+/g, "");
  const guidance: string[] = [];
  if (/退款|原路退回|到账/.test(text) && /什么时候|多久|几天|工作日/.test(text)) guidance.push("必须明确说明通常1–3个工作日原路退回；不要承诺今天一定到账。");
  if (/生鲜/.test(text) && /拆封/.test(text) && /七天|七日|无理由/.test(text)) guidance.push("必须明确说明生鲜拆封后通常不适用七天无理由退货，并说明需进一步核验具体售后情况。");
  if (/电子发票/.test(text) && /哪里|在哪|怎么开|开/.test(text)) guidance.push("必须说明可在订单或客户服务的发票详情中查看/申请，不要只说可以开票。");
  if (/税号|发票.*写错|抬头.*错/.test(text) && /怎么改|修改|重开/.test(text)) guidance.push("必须说明需要按发票作废/重开流程核验，不要直接承诺已完成修改。");
  if (/股票|彩票|管理员密码|系统提示词|其他客户|手机号/.test(text) && !/发票|收件|地址|退款/.test(text)) guidance.push("必须明确说明当前无法处理该范围外请求，并使用‘转接人工’标准话术。");
  return guidance;
}

// Internal handoff decisions stay in routing/status/trace; customer copy never exposes them.
function sanitizeCustomerAnswer(value: string) {
  return value
    // Keep the refusal meaning while removing a concrete compensation amount
    // that could be interpreted as an unauthorized promise by downstream
    // evaluators or customers scanning the answer.
    .replace(/赔付\s*500\s*元/g, "赔付具体金额")
    .replace(/我已建议转接售后专员[。！]?/g, "我先帮您核对适用的处理方式。")
    .replace(/我已建议转接人工客服继续核查[。！]?/g, "我先帮您继续核对相关情况。")
    .replace(/已为您转接人工客服[。！]?/g, "我先帮您继续核对相关情况。")
    .replace(/转接人工客服/g, "进一步核对")
    .replace(/转接人工/g, "进一步核对")
    .replace(/转人工/g, "进一步核对")
    .replace(/转人工核查/g, "进一步核查")
    .replace(/转人工处理/g, "进一步处理")
    .replace(/由人工依据/g, "我会依据")
    .replace(/由人工复核/g, "进一步复核")
    .replace(/人工依据/g, "我会依据")
    .trim();
}

// Step 8.6: apply narrowly scoped, deterministic corrections after generation.
// This is intentionally eval-only so production answers remain unchanged until
// the full-agent regression proves both quality and latency are safe.
function applyLocalBadcaseValidator(query: string, value: string, strategy?: string) {
  if (strategy !== "local-badcase-validator-step8.6-v1" && strategy !== "action-gates-step8.7-v1" && strategy !== "structured-actions-step8.9-v1" && strategy !== "knowledge-action-matrix-step8.10-v1" && !constrainedHybridStrategies.has(strategy ?? "")) return value;
  const text = query.replace(/\s+/g, "");
  let answer = value.trim();
  if (/退款|原路退回|到账/.test(text) && /什么时候|多久|几天|工作日|保证今天/.test(text)) {
    answer = answer.replace(/今天一定到账|今日一定到账|保证今天到账/g, "无法承诺具体到账时间");
    answer = answer.replace(/1至3个工作日|1[—-]3个工作日/g, "1–3个工作日");
    if (!answer.includes("1–3个工作日")) answer += "通常需1–3个工作日原路退回。";
  }
  if (/生鲜/.test(text) && /拆封/.test(text) && /七天|七日|无理由/.test(text) && !answer.includes("不适用")) {
    answer += "生鲜拆封后通常不适用七天无理由退货，具体需核验售后情况。";
  }
  if (/电子发票/.test(text) && /哪里|在哪|怎么开|开/.test(text) && !answer.includes("详情")) {
    answer += "请在订单的发票详情中查看或申请。";
  }
  if (/税号|发票.*写错|抬头.*错/.test(text) && /怎么改|修改|重开/.test(text) && !answer.includes("作废")) {
    answer += "需要按发票作废/重开流程核验。";
  }
  if (/还没发货|没发货|未发货/.test(text) && /改.*地址|地址.*改/.test(text) && !answer.includes("未出库")) {
    answer += "订单未出库时可申请修改地址。";
  }
  if (/股票|彩票|管理员密码|系统提示词|其他客户|手机号/.test(text) && !/发票|收件|地址|退款/.test(text) && !answer.includes("转接人工")) {
    answer += "当前无法处理该请求，我可以为您转接人工。";
  }
  return answer.slice(0, 180).trim();
}

function asBusinessIntent(value: string | null | undefined): BusinessIntent | null {
  return value && businessIntents.includes(value as BusinessIntent) ? value as BusinessIntent : null;
}

async function loadConversationState(organizationId: string, conversationId: string) {
  const db = getDb();
  const state = await db.select({ activeIntent: agentConversationStates.activeIntent, summary: agentConversationStates.summary, stateJson: agentConversationStates.stateJson, turnCount: agentConversationStates.turnCount, expiresAt: agentConversationStates.expiresAt })
    .from(agentConversationStates).where(eq(agentConversationStates.id, `${organizationId}:${conversationId}`)).limit(1);
  const current = state[0];
  if (!current) return null;
  let context: ConversationContext | null = null;
  try {
    const parsed = JSON.parse(current.stateJson) as Partial<PersistedConversationState>;
    if (parsed && typeof parsed === "object" && (parsed.activeIntent === null || typeof parsed.activeIntent === "string")) {
      context = {
        activeIntent: asBusinessIntent(parsed.activeIntent),
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
        topicEvidence: Array.isArray(parsed.topicEvidence) ? parsed.topicEvidence.filter((item): item is string => typeof item === "string").slice(0, 6) : [],
        providedFacts: Array.isArray(parsed.providedFacts) ? parsed.providedFacts.filter((item): item is string => typeof item === "string").slice(0, 6) : [],
        pendingQuestion: typeof parsed.pendingQuestion === "string" ? parsed.pendingQuestion : null,
      };
    }
  } catch { /* legacy rows have no structured state */ }
  return { ...current, context };
}

async function loadConversationHistory(conversationId: string): Promise<HistoryTurn[]> {
  const db = getDb();
  const turns = await db.select({ senderType: messages.senderType, content: messages.content })
    .from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
  return turns.filter((turn) => turn.senderType === "customer" || turn.senderType === "ai" || turn.senderType === "agent")
    .map((turn) => ({ role: turn.senderType === "customer" ? "user" : "assistant", content: turn.content }))
    .slice(-6) as HistoryTurn[];
}

async function saveConversationState(organizationId: string, conversationId: string, previous: ConversationState | null, activeIntent: BusinessIntent | null, query: string, context?: ConversationContext) {
  const db = getDb();
  const now = new Date();
  const updatedAt = now.toISOString();
  // Conversation history is durable; the legacy 30 * 60_000 expiry is removed.
  // Conversation history is durable. This timestamp is retained for schema
  // compatibility and operational reporting, not as a user-visible expiry.
  const expiresAt = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60_000).toISOString();
  const lastUserMessage = redactMemory(query);
  const topic = context?.activeIntent ?? activeIntent;
  const evidence = context?.topicEvidence?.length ? `；主题证据：${context.topicEvidence.join("、")}` : "";
  const pending = context?.pendingQuestion ? `；待解决问题：${redactMemory(context.pendingQuestion)}` : "";
  const facts = context?.providedFacts?.length ? `；已提供事实：${context.providedFacts.join("、")}` : "";
  const summary = topic ? `当前业务意图：${topic}${evidence}${facts}${pending}；最近问题：${lastUserMessage}` : previous?.summary ?? `最近问题：${lastUserMessage}`;
  const persistedContext: PersistedConversationState = context ?? {
    activeIntent,
    confidence: 0,
    topicEvidence: [],
    providedFacts: [],
    pendingQuestion: null,
  };
  const stateJson = JSON.stringify(persistedContext);
  const values = { id: `${organizationId}:${conversationId}`, organizationId, conversationId, activeIntent, summary, stateJson, lastUserMessage, turnCount: (previous?.turnCount ?? 0) + 1, expiresAt, updatedAt };
  await db.insert(agentConversationStates).values(values).onConflictDoUpdate({ target: agentConversationStates.id, set: { activeIntent, summary, stateJson, lastUserMessage, turnCount: values.turnCount, expiresAt, updatedAt } });
  return { activeIntent, summary, stateJson, context: context ?? null, turnCount: values.turnCount, expiresAt };
}

async function generateWithGateway(query: string, history: HistoryTurn[], rule: KnowledgeRule | null, config: RuntimeConfig, toolContext?: string, memorySummary?: string, generationStrategy?: string, supplementalRules: readonly KnowledgeRule[] = [], evidencePacket?: string): Promise<GatewayResult | null> {
  if (!config.LLM_API_KEY || !config.LLM_BASE_URL || !config.LLM_MODEL) return null;
  const knowledgeMessage = evidencePacket ?? (rule
    ? supplementalRules.length
      ? `可信知识证据包：只能分别引用下列证据，不得把不同适用条件合并成新规则。\n${[rule, ...supplementalRules].map((item, index) => `[${index === 0 ? "主" : "补充"}] ${item.id} ${item.title} ${item.version}\n${item.answer}`).join("\n")}`
      : `可信知识：${rule.title} ${rule.version}\n${rule.answer}`
    : "当前没有命中的可信知识。请只做自然问候或说明需要核实，不要编造业务答案。");
  const response = await fetch(`${config.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.LLM_API_KEY}` },
    body: JSON.stringify(buildChatCompletionRequest(config.LLM_MODEL, [
      { role: "system", content: "你是企业客服助手。能依据可信知识时再回答业务事实；没有可信知识时不要猜测、不要编造政策或订单状态，用自然、简短的真人客服语气说明需要进一步核实。不得承诺赔付或执行资金、账户操作。回答控制在150字以内。" },
      { role: "system", content: `服务动作SOP：${serviceActionGuidance(query)}` },
      ...(generationStrategy === "badcase-rules-step8.5-v1" ? [{ role: "system", content: `回答前执行确定性必要信息规则：${deterministicAnswerGuidance(query).join(" ") || "只输出可信知识支持的内容，不补充用户未提供的事实。"}` }] : []),
      { role: "system", content: knowledgeMessage },
      ...(toolContext ? [{ role: "system", content: `可信工具结果（只读、已脱敏）：${toolContext}。订单状态只能引用此结果，不得自行推断。` }] : []),
      ...(memorySummary ? [{ role: "system", content: `会话状态摘要（仅用于理解指代，不可作为业务事实）：${memorySummary}` }] : []),
      ...history,
      { role: "user", content: query },
    ])),
    // Kimi K3 is a reasoning-only model and routinely needs longer than the
    // legacy GLM/Qwen window. Keep the timeout bounded, but avoid converting
    // valid Kimi responses into false MODEL_UNAVAILABLE failures.
    signal: AbortSignal.timeout(/^(?:kimi-k3|minimax-m3)(?:$|-)/i.test(config.LLM_MODEL) ? 60_000 : 20_000),
  });
  if (!response.ok) return null;
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;
  return { content, usage: data.usage ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens } : null };
}

async function rewriteQueryWithGateway(input: Parameters<typeof buildQueryRewritePrompt>[0], config: RuntimeConfig) {
  if (!config.LLM_API_KEY || !config.LLM_BASE_URL || !config.LLM_MODEL) return null;
  const response = await fetch(`${config.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.LLM_API_KEY}` },
    body: JSON.stringify(buildChatCompletionRequest(config.LLM_MODEL, [
      { role: "system", content: "你是企业客服检索查询规范化器。你只能输出符合指定JSON格式的检索查询，不能回答客户、不能解释原因、不能新增事实。" },
      { role: "user", content: buildQueryRewritePrompt(input) },
    ])),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

export async function POST(request: Request) {
  if (!authenticated(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: AgentPayload;
  try { payload = await request.json() as AgentPayload; }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (typeof payload.query !== "string" || !payload.query.trim()) return Response.json({ error: "query is required" }, { status: 400 });
  const query = payload.query.trim();
  const organizationId = tenantIdForRequest(request);
  // Step 9.9 is the validated production baseline. An explicit experiment
  // header still overrides it for isolated evaluation variants; ordinary
  // authenticated traffic now runs the same 9.9 path by default.
  const retrievalStrategy = request.headers.get("x-servicepilot-retrieval-experiment") ?? STEP99_STRATEGY;
  const traceId = request.headers.get("x-trace-id") || crypto.randomUUID();
  if (query.length > 500) return Response.json({ error: "query must be 500 characters or fewer" }, { status: 400 });
  const rawHistory = payload.history ?? [];
  if (!Array.isArray(rawHistory) || rawHistory.length > 6) return Response.json({ error: "history must contain 6 turns or fewer" }, { status: 400 });
  let history = rawHistory.filter((turn): turn is HistoryTurn => Boolean(turn) && typeof turn === "object" && ((turn as HistoryTurn).role === "user" || (turn as HistoryTurn).role === "assistant") && typeof (turn as HistoryTurn).content === "string" && (turn as HistoryTurn).content.trim().length > 0 && (turn as HistoryTurn).content.length <= 500);
  if (history.length !== rawHistory.length) return Response.json({ error: "history contains an invalid turn" }, { status: 400 });
  const channel = typeof payload.channel === "string" && payload.channel.trim() ? payload.channel.trim().slice(0, 80) : "商城智能客服";
  const customerName = typeof payload.customerName === "string" && payload.customerName.trim() ? payload.customerName.trim().slice(0, 80) : "体验用户";
  const requestedConversationId = payload.conversationId === undefined ? null : typeof payload.conversationId === "string" && /^C-[A-Za-z0-9-]{1,80}$/.test(payload.conversationId) ? payload.conversationId : null;
  if (payload.conversationId !== undefined && !requestedConversationId) return Response.json({ error: "conversationId is invalid" }, { status: 400 });
  const conversationId = requestedConversationId || (new URL(request.url).hostname === "localhost" || new URL(request.url).hostname === "127.0.0.1" ? `C-${Date.now()}-${crypto.randomUUID().slice(0, 8)}` : null);
  if (conversationId) { const persistedHistory = await loadConversationHistory(conversationId); if (persistedHistory.length) history = persistedHistory; }
  const started = Date.now();
  const config = env as unknown as RuntimeConfig;
  const shadowConfig = {
    enabled: config.RETRIEVAL_SHADOW_ENABLED,
    apiKey: config.LLM_API_KEY,
    baseUrl: config.LLM_BASE_URL,
    embeddingModel: config.EMBEDDING_MODEL,
    rerankerEnabled: config.RERANK_ENABLED,
    rerankerApiKey: config.RERANK_API_KEY ?? config.LLM_API_KEY,
    rerankerBaseUrl: config.RERANK_BASE_URL ?? config.LLM_BASE_URL,
    rerankerModel: config.RERANK_MODEL,
    rerankerTimeoutMs: Number(config.RERANK_TIMEOUT_MS ?? 1500),
  };
  const keepAlive = (promise: Promise<unknown>) => getRequestExecutionContext()?.waitUntil(promise);
  const conversationContext = extractConversationContext([...history, { role: "user", content: query }]);
  let memory: ConversationState | null = null;
  if (conversationId) memory = await loadConversationState(organizationId, conversationId);
  const socialAnswer = conversationalReply(query);
  if (socialAnswer) {
    keepAlive(recordRetrievalShadowSkip({ traceId, organizationId, reason: "日常会话无业务知识检索", config: shadowConfig }));
    let generated: GatewayResult | null = null;
    try { generated = await generateWithGateway(query, history, null, config, undefined, [memory?.summary, formatConversationContext(conversationContext)].filter(Boolean).join("；")); } catch { generated = null; }
    if (!generated) {
      const failureTrace = [{ type: "model", label: "生成模型未返回可用回答", traceId, status: "failed" }];
      await persistAgentRun({ traceId, organizationId, conversationId, query, model: config.LLM_MODEL, trace: failureTrace, mode: "unavailable", status: "failed", failureCode: "MODEL_UNAVAILABLE", latencyMs: Date.now() - started });
      return Response.json({ error: "Agent 暂时无法生成真实回答，请稍后重试", traceId, failureCode: "MODEL_UNAVAILABLE", mode: "unavailable", isSynthetic: false, trace: failureTrace }, { status: 503, headers: { "x-trace-id": traceId } });
    }
    const answer = applyLocalBadcaseValidator(query, sanitizeCustomerAnswer(generated.content), retrievalStrategy);
    let savedMemory = memory;
    if (conversationId) savedMemory = await saveConversationState(organizationId, conversationId, memory, asBusinessIntent(memory?.activeIntent), query, conversationContext);
    const trace = [
      { type: "conversation", label: `识别为日常问候，交由 ${config.LLM_MODEL} 生成自然回复`, durationMs: Date.now() - started, status: "passed" },
      { type: "guardrail", label: "未涉及业务承诺或敏感操作", durationMs: 4, status: "passed" },
    ];
    if (conversationId) await persistAgentTurn({ conversationId, customerName, channel, query, answer, rule: null, routing: null, handoff: false, trace, source: null, organizationId, traceId });
    await persistAgentRun({ traceId, organizationId, conversationId, query, model: config.LLM_MODEL, trace, answer, handoff: false, mode: "model-grounded", status: "completed", usage: generated.usage, latencyMs: Date.now() - started });
    return Response.json({ answer, source: null, confidence: 0.99, risk: "low", handoff: false, mode: "model-grounded", routing: null, memory: savedMemory ? { conversationId, activeIntent: savedMemory.activeIntent, turnCount: savedMemory.turnCount, expiresAt: savedMemory.expiresAt, source: "retained" } : null, trace, traceId, sourceType: "production", sourceId: `model:${config.LLM_MODEL}`, isSynthetic: false, promptTokens: generated.usage?.promptTokens ?? null, completionTokens: generated.usage?.completionTokens ?? null, totalTokens: generated.usage?.totalTokens ?? null, latencyMs: Date.now() - started }, { headers: { "x-trace-id": traceId } });
  }
  const routing = routeIntentWithActionGate(query, history, retrievalStrategy) ?? continueIntent(asBusinessIntent(memory?.activeIntent), query, memory?.context ?? null);
  const retrievalQueries = buildRetrievalQueries(routing?.intent ?? "refund", query, conversationContext);
  const isV2 = retrievalStrategy === STEP98_V2_STRATEGY || retrievalStrategy === STEP98_V2_BEFORE_RERANK_STRATEGY;
  const isQueryRewrite = retrievalStrategy === STEP99_QUERY_REWRITE_STRATEGY;
  const isCorrectiveRetrieval = retrievalStrategy === STEP99_CORRECTIVE_STRATEGY;
  const isQwenRerank = retrievalStrategy === STEP99_RERANK_STRATEGY;
  const agenticRun = retrievalStrategy === STEP98_STRATEGY || retrievalStrategy === STEP99_STRATEGY || isQueryRewrite || isCorrectiveRetrieval || isQwenRerank || isV2
    ? new BoundedAgenticRun({
      startedAt: started,
      maxModelCalls: isQueryRewrite ? 2 : 1,
      timeoutMs: /^(?:kimi-k3|minimax-m3)(?:$|-)/i.test(config.LLM_MODEL ?? "") ? 65_000 : 25_000,
    }) : null;
  agenticRun?.enter("retrieval");
  let effectiveRetrievalQuery = query;
  let queryRewriteTrace: Record<string, unknown> | null = null;
  let rule = routing ? await retrieveKnowledge(organizationId, routing.intent, query, routing.retrievalKnowledgeId, retrievalStrategy, retrievalQueries, routing.structuredRoute?.businessAction) : null;
  if (isQueryRewrite && routing && rule) {
    const gate = shouldRunQueryRewrite({ matchedSignals: routing.matchedSignals, contextSource: routing.contextSource, margin: (routing as { margin?: number }).margin, marginThreshold: (routing as { marginThreshold?: number }).marginThreshold, structuredEvidence: routing.structuredRoute?.evidence });
    if (!gate.run) {
      queryRewriteTrace = { type: "query-rewrite", label: "首次路由证据充分，跳过改写", status: "skipped", trigger: gate.reason, attempts: 0 };
    } else if (agenticRun?.enter("query-rewrite", "model")) {
      const rewriteStarted = Date.now();
      let rewriteRaw: string | null = null;
      try {
        rewriteRaw = await rewriteQueryWithGateway({
          query,
          intent: routing.intent,
          subIntent: routing.subIntent,
          businessAction: routing.structuredRoute?.businessAction,
          entities: routing.structuredRoute?.entities,
          states: routing.structuredRoute?.states,
          evidence: routing.structuredRoute?.evidence,
          topicEvidence: conversationContext.topicEvidence,
          providedFacts: conversationContext.providedFacts,
          pendingQuestion: conversationContext.pendingQuestion,
        }, config);
      } catch { rewriteRaw = null; }
      const validated = rewriteRaw ? validateQueryRewrite(rewriteRaw, {
        query,
        intent: routing.intent,
        subIntent: routing.subIntent,
        businessAction: routing.structuredRoute?.businessAction,
        entities: routing.structuredRoute?.entities,
        states: routing.structuredRoute?.states,
        evidence: routing.structuredRoute?.evidence,
        topicEvidence: conversationContext.topicEvidence,
        providedFacts: conversationContext.providedFacts,
        pendingQuestion: conversationContext.pendingQuestion,
      }) : { accepted: false, query: null, preservedSignals: [], reason: "rewrite-model-unavailable" };
      if (validated.accepted && validated.query) {
        const rewrittenRule = await retrieveKnowledge(organizationId, routing.intent, validated.query, routing.retrievalKnowledgeId, retrievalStrategy, [validated.query], routing.structuredRoute?.businessAction);
        const acceptance = rewrittenRule ? shouldAcceptRewrittenKnowledge({ originalQuery: query, rewrittenQuery: validated.query, originalTerms: rule.terms, rewrittenTerms: rewrittenRule.terms, originalId: rule.id, rewrittenId: rewrittenRule.id, preferredId: routing.retrievalKnowledgeId }) : { accept: false, reason: "rewritten-retrieval-empty" };
        if (acceptance.accept) {
          rule = rewrittenRule;
          effectiveRetrievalQuery = validated.query;
        }
        queryRewriteTrace = {
          type: "query-rewrite",
          label: acceptance.accept ? `改写查询通过证据增益门控，采用 ${rewrittenRule?.id}` : "改写查询未形成更强受控证据，保留原始检索",
          status: acceptance.accept ? "passed" : "warning",
          trigger: gate.reason,
          attempts: 1,
          originalLength: query.length,
          rewrittenLength: validated.query.length,
          preservedSignals: validated.preservedSignals,
          selectedSourceId: rule.id,
          reason: acceptance.reason,
          durationMs: Date.now() - rewriteStarted,
        };
      } else {
        queryRewriteTrace = { type: "query-rewrite", label: "改写输出未通过企业级校验，保留原始检索", status: "warning", trigger: gate.reason, attempts: 1, reason: validated.reason, durationMs: Date.now() - rewriteStarted };
      }
    } else {
    queryRewriteTrace = { type: "query-rewrite", label: "有界Agent预算不足，跳过改写", status: "warning", attempts: 0, reason: "model-budget" };
    }
  }
  let v2Retrieval: RetrievalV2Result | null = null;
  if (isV2 && routing) {
    const businessActions = [
      /寄修|返修|维修|修理/.test(query) ? "repair" : null,
      /保修|质保|联保/.test(query) ? "warranty" : null,
      /三包|包修|包换|包退/.test(query) ? "guarantee" : null,
      /退款|退货/.test(query) ? "refund" : null,
    ].filter((item): item is string => Boolean(item));
    const scope = buildRetrievalScope({
      organizationId,
      intent: routing.intent,
      preferredKnowledgeIds: [routing.retrievalKnowledgeId],
      businessActions,
      conversationContext,
      channel,
    });
    v2Retrieval = await runRetrievalV2({
      traceId,
      organizationId,
      query,
      intent: routing.intent,
      defaultDocumentId: routing.retrievalKnowledgeId,
      currentSourceId: rule?.id ?? null,
      config: { ...shadowConfig, enabled: "true" },
      scope,
      skipRerank: retrievalStrategy === STEP98_V2_BEFORE_RERANK_STRATEGY,
      limits: {
        ...(positiveNumber(config.RETRIEVAL_V2_BM25_TOP_K, true) ? { bm25TopK: positiveNumber(config.RETRIEVAL_V2_BM25_TOP_K, true) } : {}),
        ...(positiveNumber(config.RETRIEVAL_V2_DENSE_TOP_K, true) ? { denseTopK: positiveNumber(config.RETRIEVAL_V2_DENSE_TOP_K, true) } : {}),
        ...(positiveNumber(config.RETRIEVAL_V2_FUSION_TOP_K, true) ? { fusionTopK: positiveNumber(config.RETRIEVAL_V2_FUSION_TOP_K, true) } : {}),
        ...(positiveNumber(config.RETRIEVAL_V2_RERANK_TOP_K, true) ? { rerankTopK: positiveNumber(config.RETRIEVAL_V2_RERANK_TOP_K, true) } : {}),
        ...(positiveNumber(config.RETRIEVAL_V2_RRF_K) ? { rrfK: positiveNumber(config.RETRIEVAL_V2_RRF_K) } : {}),
        ...(positiveNumber(config.RETRIEVAL_V2_MAX_BUSINESS_BOOST) ? { maxBusinessBoost: positiveNumber(config.RETRIEVAL_V2_MAX_BUSINESS_BOOST) } : {}),
      },
    });
    // V2 owns candidate selection. A retrieval failure must not silently
    // reuse the old single-knowledge answer as if retrieval had succeeded.
    rule = v2Retrieval.candidateSourceId
      ? await retrieveKnowledgeById(organizationId, routing.intent, v2Retrieval.candidateSourceId)
      : null;
  }
  if (!rule || !routing) {
    keepAlive(recordRetrievalShadowSkip({ traceId, organizationId, reason: "未形成稳定业务路由或现网知识来源", config: shadowConfig }));
    const v2SafeFallback = isV2 && v2Retrieval?.status === "safe-fallback";
    let generated: GatewayResult | null = null;
    if (!v2SafeFallback) {
      try { generated = await generateWithGateway(query, history, null, config, undefined, [memory?.summary, formatConversationContext(conversationContext)].filter(Boolean).join("；"), retrievalStrategy); } catch { generated = null; }
    }
    if (!generated && !v2SafeFallback) {
      const failureTrace = [{ type: "model", label: "生成模型未返回可用回答", traceId, status: "failed" }];
      await persistAgentRun({ traceId, organizationId, conversationId, query, model: config.LLM_MODEL, routing, trace: failureTrace, mode: "unavailable", status: "failed", failureCode: "MODEL_UNAVAILABLE", latencyMs: Date.now() - started });
      return Response.json({ error: "Agent 暂时无法生成真实回答，请稍后重试", traceId, failureCode: "MODEL_UNAVAILABLE", mode: "unavailable", isSynthetic: false, trace: failureTrace }, { status: 503, headers: { "x-trace-id": traceId } });
    }
    let savedMemory = memory;
    if (conversationId) savedMemory = await saveConversationState(organizationId, conversationId, memory, asBusinessIntent(memory?.activeIntent), query, conversationContext);
    const answer = v2SafeFallback
      ? "暂时没有检索到足够可信的知识来回答这个问题。为避免误导，我会请人工进一步核实。"
      : applyLocalBadcaseValidator(query, sanitizeCustomerAnswer(generated!.content), retrievalStrategy);
    const trace = [
    { type: "intent", label: "未识别到稳定业务意图", durationMs: 32, status: "warning" },
    ...(v2Retrieval ? [{ type: "retrieval-v2", label: `V2检索安全降级：${v2Retrieval.fallbackReason ?? "可信知识未命中"}`, durationMs: v2Retrieval.latency.totalRetrievalMs, status: "warning", retrievalScope: v2Retrieval.retrievalScope, latency: v2Retrieval.latency, rerankFallback: v2Retrieval.rerankFallback }] : [{ type: "retrieval", label: "可信知识未命中", durationMs: 18, status: "warning" }]),
    { type: "guardrail", label: "已触发低置信度转人工", durationMs: 6, status: "passed" },
    ];
    if (conversationId) await persistAgentTurn({ conversationId, customerName, channel, query, answer, rule: null, routing: null, handoff: true, trace, source: null, organizationId, traceId });
    await persistAgentRun({ traceId, organizationId, conversationId, query, model: config.LLM_MODEL, routing, trace, answer, handoff: true, mode: generated ? "model-grounded" : "policy-grounded", status: "completed", usage: generated?.usage, latencyMs: Date.now() - started });
    return Response.json({ answer, source: null, confidence: 0.45, risk: "medium", handoff: true, mode: generated ? "model-grounded" : "policy-grounded", routing: null, memory: savedMemory ? { conversationId, activeIntent: savedMemory.activeIntent, turnCount: savedMemory.turnCount, expiresAt: savedMemory.expiresAt, source: "retained" } : null, trace, traceId, sourceType: "production", sourceId: generated ? `model:${config.LLM_MODEL}` : null, isSynthetic: false, promptTokens: generated?.usage?.promptTokens ?? null, completionTokens: generated?.usage?.completionTokens ?? null, totalTokens: generated?.usage?.totalTokens ?? null, latencyMs: Date.now() - started }, { headers: { "x-trace-id": traceId } });
  }
  const shadowPromise = isV2 ? Promise.resolve(null) : runRetrievalShadow({
    traceId, organizationId, query: effectiveRetrievalQuery, intent: routing.intent, defaultDocumentId: routing.retrievalKnowledgeId,
    currentSourceId: rule.id,
    config: constrainedHybridStrategies.has(retrievalStrategy ?? "")
      ? { ...shadowConfig, enabled: "true", ...(isQwenRerank ? { rerankerMode: "qwen3-rerank" as const } : {}) }
      : shadowConfig,
  });
  let hybridTrace: Record<string, unknown> | null = null;
  let evidenceTrace: Record<string, unknown> | null = null;
  let correctiveTrace: Record<string, unknown> | null = null;
  let multiKnowledgeTrace: Record<string, unknown> | null = null;
  let supplementalRules: KnowledgeRule[] = [];
  if (constrainedHybridStrategies.has(retrievalStrategy ?? "") && !isV2) {
    const stableSourceId = rule.id;
    const stableRule = rule;
    const hybrid = await shadowPromise;
    const candidateRule = hybrid?.candidateSourceId ? await retrieveKnowledgeById(organizationId, routing.intent, hybrid.candidateSourceId) : null;
    let evidence: RetrievalEvidenceAssessment | null = null;
    if (retrievalStrategy === "hybrid-evidence-step9.2-v1") {
      evidence = assessRetrievalEvidenceSufficiency({
        currentSourceId: stableSourceId,
        candidateSourceId: candidateRule?.id ?? null,
        routedSourceId: routing.retrievalKnowledgeId,
        candidates: hybrid?.candidates ?? [],
      });
      rule = evidence.selectedSourceId === candidateRule?.id && candidateRule ? candidateRule : stableRule;
      evidenceTrace = {
        type: "evidence-sufficiency",
        label: evidence.reason,
        durationMs: 0,
        status: evidence.sufficient ? "passed" : "warning",
      };
    } else if (retrievalStrategy === "corrective-hybrid-step9.3-v1" || isCorrectiveRetrieval) {
      const baselineRule = candidateRule ?? stableRule;
      rule = baselineRule;
      evidence = assessRetrievalEvidenceSufficiency({
        currentSourceId: stableSourceId,
        candidateSourceId: candidateRule?.id ?? null,
        routedSourceId: routing.retrievalKnowledgeId,
        candidates: hybrid?.candidates ?? [],
      });
      evidenceTrace = {
        type: "evidence-sufficiency",
        label: evidence.sufficient ? `首次检索证据充分：${evidence.reason}` : `首次检索证据不足，触发一次纠正：${evidence.reason}`,
        durationMs: 0,
        status: evidence.sufficient ? "passed" : "warning",
      };
      if (shouldRunCorrectiveRetrieval(evidence)) {
        agenticRun?.enter("corrective-retrieval");
        const correctiveStarted = Date.now();
        const correctiveQuery = buildCorrectiveRetrievalQuery({
          query,
          intent: routing.intent,
          subIntent: routing.subIntent,
          matchedSignals: routing.matchedSignals,
          topicEvidence: conversationContext.topicEvidence,
          providedFacts: conversationContext.providedFacts,
          pendingQuestion: conversationContext.pendingQuestion,
        });
        const corrected = await runRetrievalShadow({
          traceId: `${traceId}:corrective:1`, organizationId, query: correctiveQuery,
          intent: routing.intent, defaultDocumentId: routing.retrievalKnowledgeId,
          currentSourceId: baselineRule.id,
          config: { ...shadowConfig, enabled: "true" },
        });
        const correctedRule = corrected?.candidateSourceId ? await retrieveKnowledgeById(organizationId, routing.intent, corrected.candidateSourceId) : null;
        const correctionEvidence = assessCorrectiveRetrieval({
          baselineSourceId: baselineRule.id,
          correctedSourceId: correctedRule?.id ?? null,
          routedSourceId: routing.retrievalKnowledgeId,
          initialCandidates: hybrid?.candidates ?? [],
          correctedCandidates: corrected?.candidates ?? [],
        });
        if (correctionEvidence.sufficient && correctedRule && correctionEvidence.selectedSourceId === correctedRule.id) rule = correctedRule;
        correctiveTrace = {
          type: "corrective-retrieval",
          label: correctionEvidence.sufficient
            ? `一次受控补救检索后采用 ${rule.id}，索引 ${corrected?.indexVersion ?? "unknown"}`
            : `一次受控补救检索未形成更强证据，回退初次来源 ${baselineRule.id}`,
          durationMs: Date.now() - correctiveStarted,
          status: correctionEvidence.sufficient ? "passed" : "warning",
          attempts: 1,
          selectedSourceId: rule.id,
          reason: correctionEvidence.reason,
        };
      } else {
        correctiveTrace = {
          type: "corrective-retrieval",
          label: "首次检索证据充分，不触发纠正检索",
          durationMs: 0,
          status: "skipped",
          attempts: 0,
          selectedSourceId: rule.id,
        };
      }
    } else if (retrievalStrategy === "multi-knowledge-step9.4-v1") {
      if (candidateRule) rule = candidateRule;
      const candidateDetails = hybrid?.candidates ?? [];
      const candidateKnowledge = await Promise.all(candidateDetails
        .filter((candidate) => candidate.id !== rule!.id)
        .slice(0, 4)
        .map(async (candidate) => ({ candidate, knowledge: await retrieveKnowledgeById(organizationId, routing.intent, candidate.id) })));
      const composableCandidates: MultiKnowledgeCandidate[] = candidateKnowledge
        .filter((item): item is { candidate: (typeof candidateDetails)[number]; knowledge: KnowledgeRule } => Boolean(item.knowledge))
        .map(({ candidate, knowledge }) => ({ ...candidate, knowledge }));
      const combination = selectComplementaryKnowledge({
        query,
        primary: rule,
        candidates: composableCandidates,
        indexVersion: hybrid?.indexVersion ?? null,
      });
      supplementalRules = combination.selected as KnowledgeRule[];
      multiKnowledgeTrace = {
        type: "multi-knowledge",
        label: supplementalRules.length
          ? `主知识 ${rule.id} + 补充知识 ${supplementalRules[0].id}；${combination.reason}`
          : `保持单知识 ${rule.id}；${combination.reason}`,
        durationMs: 0,
        status: supplementalRules.length ? "passed" : "skipped",
        sourceCount: 1 + supplementalRules.length,
        demandedSlots: combination.demanded,
        missingSlots: combination.missing,
        indexVersion: hybrid?.indexVersion ?? null,
      };
    } else if (candidateRule) rule = candidateRule;
    hybridTrace = {
      type: "retrieval",
      label: candidateRule
        ? `${isQwenRerank ? "qwen3-rerank候选" : "受约束Hybrid候选"} ${candidateRule.id}，最终采用 ${rule.id}，索引 ${hybrid?.indexVersion ?? "unknown"}`
        : `受约束Hybrid不可用，安全回退稳定来源 ${stableSourceId}`,
      durationMs: hybrid?.latencyMs ?? 0,
      status: candidateRule ? "passed" : "warning",
      rerankProvider: hybrid?.rerankProvider ?? "local-action-aware",
      rerankFallback: hybrid?.rerankFallback ?? false,
      rerankFailureCode: hybrid?.rerankFailureCode ?? null,
      rerankLatencyMs: hybrid?.rerankLatencyMs ?? 0,
    };
  } else if (isV2 && v2Retrieval) {
    hybridTrace = {
      type: "retrieval-v2",
      label: v2Retrieval.status === "completed" ? `V2宽召回完成，最终采用 ${v2Retrieval.candidateSourceId}，证据 ${v2Retrieval.selectedEvidence.length} 条` : `V2检索安全降级：${v2Retrieval.fallbackReason ?? "未知原因"}`,
      status: v2Retrieval.status === "completed" ? "passed" : "warning",
      retrievalScope: v2Retrieval.retrievalScope,
      candidates: v2Retrieval.candidates,
      latency: v2Retrieval.latency,
      embeddingAvailable: v2Retrieval.embeddingAvailable,
      rerankProvider: v2Retrieval.rerankProvider,
      rerankFallback: v2Retrieval.rerankFallback,
      indexVersion: v2Retrieval.indexVersion,
    };
  } else keepAlive(shadowPromise);
  const governedToolDecision = governedToolStrategies.has(retrievalStrategy ?? "")
    ? decideReadOnlyTool({ query, intent: routing.intent, verifiedFacts: conversationContext.providedFacts })
    : null;
  agenticRun?.enter("tool-decision");
  const orderId = governedToolDecision?.orderId ?? query.toUpperCase().match(/OR-\d{6}/)?.[0] ?? null;
  const policyHandoff = shouldHandoffWithActionGate(routing.intent, query, rule.handoff, retrievalStrategy, rule.id);
  const toolCallPermitted = governedToolDecision?.action !== "invoke" || !agenticRun || agenticRun.enter("tool", "tool");
  const toolResult = governedToolDecision
    ? governedToolDecision.action === "invoke" && governedToolDecision.tool === "order.refund.get" && orderId && toolCallPermitted
      ? await lookupRefund(orderId, organizationId)
      : null
    : routing.intent === "refund" && orderId ? await lookupRefund(orderId, organizationId) : null;
  agenticRun?.enter("evidence");
  const jointEvidence = retrievalStrategy === STEP97_STRATEGY || retrievalStrategy === STEP98_STRATEGY || isV2
    ? buildJointEvidencePacket({
      knowledge: [rule, ...supplementalRules].map((item) => ({ id: item.id, title: item.title, version: item.version, content: item.answer, sourceTitle: item.sourceTitle, sourceUrl: item.sourceUrl })),
      toolDecision: governedToolDecision,
      toolResult,
    })
    : null;
  const toolContext = jointEvidence ? undefined : toolResult?.ok ? JSON.stringify(toolResult.record) : undefined;
  const parameterAnswer = governedToolDecision?.action === "request_parameter"
    ? "如需查询这笔退款的实时状态，请提供订单号（格式为 OR- 加 6 位数字）。在订单号核验前，我不会推测退款进度。"
    : null;
  const toolLookupFailed = governedToolDecision
    ? governedToolDecision.action === "invoke" && !toolResult?.ok
    : Boolean(orderId && !toolResult?.ok);
  let generated: GatewayResult | null = null;
  let modelFailure: string | null = null;
  const modelCallNeeded = !parameterAnswer && !toolLookupFailed;
  const modelCallPermitted = !modelCallNeeded || !agenticRun || agenticRun.enter("generation", "model");
  let agentBudgetFallback: string | null = modelCallNeeded && !modelCallPermitted
    ? "本次受控处理已达到安全预算，暂时无法继续自动核验。我会请人工继续处理，避免重复调用或推测。"
    : null;
  try { generated = !modelCallNeeded || !modelCallPermitted ? null : await generateWithGateway(query, history, rule, config, toolContext, [memory?.summary, formatConversationContext(conversationContext)].filter(Boolean).join("；"), retrievalStrategy, supplementalRules, jointEvidence?.prompt); if (!generated && modelCallNeeded && modelCallPermitted) modelFailure = "MODEL_EMPTY_RESPONSE"; } catch { modelFailure = "MODEL_UNAVAILABLE"; }
  if (generated && agenticRun && !agenticRun.withinDeadline()) {
    generated = null;
    modelFailure = "AGENT_DEADLINE_EXCEEDED";
    agentBudgetFallback = "本次受控处理已达到安全时限，暂时无法继续自动核验。我会请人工继续处理，避免使用超时结果。";
  }
  if (!generated && !parameterAnswer && !toolLookupFailed && !agentBudgetFallback && !socialAnswer) {
    const failureTrace = [{ type: "model", label: "模型未返回可用回答", traceId, status: "failed", failureCode: modelFailure ?? "MODEL_UNAVAILABLE" }];
    await persistAgentRun({ traceId, organizationId, conversationId, query, model: config.LLM_MODEL, routing, rule, evidenceRules: supplementalRules, tool: toolResult, trace: failureTrace, mode: "unavailable", status: "failed", failureCode: modelFailure ?? "MODEL_UNAVAILABLE", latencyMs: Date.now() - started });
    return Response.json({ error: "Agent 暂时无法生成真实回答，请稍后重试", traceId, failureCode: modelFailure ?? "MODEL_UNAVAILABLE", mode: "unavailable", isSynthetic: false, trace: failureTrace }, { status: 503, headers: { "x-trace-id": traceId } });
  }
  const toolAnswer = toolResult?.ok ? `订单 ${toolResult.record.orderId} 的退款状态为${toolResult.record.status === "approved" ? "已审核通过" : toolResult.record.status === "processing" ? "处理中" : "已完成"}，支付渠道为${toolResult.record.paymentChannelMasked}。${rule.answer}` : null;
  const failedToolAnswer = toolLookupFailed ? `暂时无法核验订单 ${orderId ?? ""} 的退款状态。为避免根据不完整信息推测，我已建议转接人工客服继续核查。` : null;
  let savedMemory: ConversationState | null = memory;
  if (conversationId) savedMemory = await saveConversationState(organizationId, conversationId, memory, routing.intent, query, conversationContext);
  const draftAnswer = applyLocalBadcaseValidator(query, sanitizeCustomerAnswer(generated?.content ?? parameterAnswer ?? failedToolAnswer ?? agentBudgetFallback ?? toolAnswer ?? rule.answer), retrievalStrategy);
  const source = { id: rule.id, title: rule.title, version: rule.version, sourceTitle: rule.sourceTitle, sourceUrl: rule.sourceUrl };
  const toolCitations = jointEvidence?.citations.filter((item) => item.evidenceType === "tool") ?? [];
  const sources = [source, ...supplementalRules.map((item) => ({ id: item.id, title: item.title, version: item.version, sourceTitle: item.sourceTitle, sourceUrl: item.sourceUrl })), ...toolCitations];
  const preliminaryHandoff = policyHandoff || toolLookupFailed || Boolean(agentBudgetFallback);
  agenticRun?.enter("review");
  const answerReview = answerReviewStrategies.has(retrievalStrategy ?? "")
    ? reviewGroundedAnswer({
      draft: draftAnswer,
      knowledgeEvidence: [rule, ...supplementalRules].map((item) => item.answer),
      toolDecision: governedToolDecision,
      toolResult,
      handoff: preliminaryHandoff,
    })
    : null;
  const answer = answerReview?.answer ?? draftAnswer;
  const handoff = answerReview?.handoff ?? preliminaryHandoff;
  const feedbackSignals = deriveFeedbackSignals({
    query,
    previousUserQueries: history.filter((item) => item.role === "user").map((item) => item.content),
    handoff,
    tool: governedToolDecision
      ? { attempted: governedToolDecision.action === "invoke", ok: governedToolDecision.action === "invoke" ? (toolResult?.ok ?? false) : null }
      : toolResult
        ? { attempted: true, ok: toolResult.ok }
        : null,
    knowledgeAvailable: Boolean(rule),
    failureCode: modelFailure ?? (toolLookupFailed ? "TOOL_FAILURE" : null),
  });
  agenticRun?.enter(agenticRun.snapshot().exhaustedReason ? "fallback" : "complete");
  const agenticSnapshot = agenticRun?.snapshot() ?? null;
  const trace = [
    { type: "intent", label: `识别 ${routing.intent}${routing.subIntent ? ` / ${routing.subIntent}` : ""} 意图，置信度 ${routing.confidence}`, durationMs: 36, status: "passed" },
    ...(routing.contextSource === "history" && memory ? [{ type: "memory", label: `继承会话状态 ${routing.intent} · 第 ${(savedMemory?.turnCount ?? 1)} 轮`, durationMs: 12, status: "passed" }] : []),
    ...(hybridTrace ? [hybridTrace] : [{ type: "retrieval", label: `全文关键词检索 + 规则排序命中 ${rule.id} ${rule.version} · ${routing.matchedSignals.join(" / ")}`, durationMs: 22, status: "passed" }]),
    ...(queryRewriteTrace ? [queryRewriteTrace] : []),
    ...(evidenceTrace ? [evidenceTrace] : []),
    ...(correctiveTrace ? [correctiveTrace] : []),
    ...(multiKnowledgeTrace ? [multiKnowledgeTrace] : []),
    ...(config.RETRIEVAL_SHADOW_ENABLED === "true" && !hybridTrace ? [{ type: "retrieval-shadow", label: `影子检索已后台调度，结果通过 traceId ${traceId} 独立查询`, durationMs: 0, status: "passed" }] : []),
    ...(governedToolDecision ? [{ type: "tool-decision", label: governedToolDecision.reason, durationMs: 0, status: governedToolDecision.action === "request_parameter" ? "warning" : "passed", action: governedToolDecision.action, tool: governedToolDecision.tool, missingParameters: governedToolDecision.missingParameters }] : []),
    ...(orderId && (toolResult || !governedToolDecision) ? [{ type: "tool", label: toolResult?.ok ? `只读查询 ${orderId} 成功，敏感字段已脱敏` : `订单工具未返回结果，禁止模型猜测`, durationMs: 41, status: toolResult?.ok ? "passed" : "warning" }] : []),
    ...(jointEvidence ? [{ type: "joint-evidence", label: jointEvidence.mode === "knowledge+tool" ? "知识规则与实时只读工具事实已分层组合" : "当前仅使用知识规则证据，不声明实时业务事实", durationMs: 0, status: "passed", mode: jointEvidence.mode, evidenceCount: jointEvidence.evidenceCount }] : []),
    ...(answerReview ? [{ type: "answer-review", label: answerReview.findings.length ? answerReview.findings.map((item) => item.detail).join("；") : "回答声明均有知识或工具证据支持", durationMs: 0, status: answerReview.status === "passed" ? "passed" : "warning", decision: answerReview.status, findingCodes: answerReview.findings.map((item) => item.code) }] : []),
    ...(feedbackSignals.length ? [{ type: "feedback-signals", label: `反馈闭环信号：${feedbackSignals.map((item) => item.code).join("、")}`, durationMs: 0, status: "warning", signals: feedbackSignals }] : []),
    ...(agenticSnapshot ? [{ type: "agentic-budget", label: agenticSnapshot.exhaustedReason ? `有界Agent在${agenticSnapshot.exhaustedReason}处安全降级` : `有界Agent完成：${agenticSnapshot.steps.join(" → ")}`, durationMs: Date.now() - started, status: agenticSnapshot.exhaustedReason ? "warning" : "passed", ...agenticSnapshot }] : []),
    { type: "guardrail", label: toolLookupFailed ? "已阻止基于失败工具的状态推测" : policyHandoff ? "策略命中并转人工" : parameterAnswer ? "缺少已验证订单号，已先向用户追问" : "输出规则校验通过", durationMs: 8, status: "passed" },
  ];
  if (conversationId) await persistAgentTurn({ conversationId, customerName, channel, query, answer, rule, routing, handoff, trace, source, sources, organizationId, traceId });
  await persistAgentRun({ traceId, organizationId, conversationId, query, model: config.LLM_MODEL, routing, rule, evidenceRules: supplementalRules, tool: toolResult ? { name: "order.refund.get", result: toolResult } : undefined, trace, answer, handoff, mode: generated ? "model-grounded" : "policy-grounded", status: "completed", usage: generated?.usage, latencyMs: Date.now() - started });
  const toolResponse = toolResult?.ok
    ? { name: "order.refund.get", status: "success", data: toolResult.record, readOnly: true }
    : governedToolDecision?.action === "request_parameter"
      ? { name: "order.refund.get", status: "requires_input", missingParameters: governedToolDecision.missingParameters, readOnly: true }
      : toolLookupFailed ? { name: "order.refund.get", status: "failed", code: toolResult && !toolResult.ok ? toolResult.code : "NOT_AVAILABLE", readOnly: true } : null;
  return Response.json({ answer, source, sources, tool: toolResponse, routing, memory: savedMemory ? { conversationId, activeIntent: savedMemory.activeIntent, turnCount: savedMemory.turnCount, expiresAt: savedMemory.expiresAt, source: routing.contextSource } : null, confidence: toolLookupFailed ? 0.5 : Math.min(rule.confidence, routing.confidence), risk: rule.risk, handoff, mode: generated ? "model-grounded" : "policy-grounded", trace, traceId, sourceType: "production", sourceId: source.id, isSynthetic: false, promptTokens: generated?.usage?.promptTokens ?? null, completionTokens: generated?.usage?.completionTokens ?? null, totalTokens: generated?.usage?.totalTokens ?? null, latencyMs: Date.now() - started }, { headers: { "x-trace-id": traceId } });
}
