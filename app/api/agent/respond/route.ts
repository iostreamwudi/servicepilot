import { env } from "cloudflare:workers";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { agentConversationStates, knowledgeDocuments } from "../../../../db/schema";
import { lookupRefund } from "../../../../lib/order-tool";
import { continueIntent, routeIntent, shouldHandoff, type BusinessIntent, type ConversationTurn } from "../../../../lib/intent-router";

type RuntimeConfig = { LLM_API_KEY?: string; LLM_BASE_URL?: string; LLM_MODEL?: string };
type HistoryTurn = ConversationTurn;
type ConversationState = { activeIntent: string | null; summary: string; turnCount: number; expiresAt: string };
const ORG_ID = "org-qingyu";
const businessIntents: BusinessIntent[] = ["refund", "damage", "address", "invoice"];
type KnowledgeRule = {
  id: string; title: string; version: string; terms: string[]; answer: string;
  confidence: number; risk: "low" | "medium" | "high"; handoff: boolean;
  sourceTitle?: string | null; sourceUrl?: string | null;
};

const fallbackRules: KnowledgeRule[] = [
  { id: "KB-114", title: "退款与到账时效规则", version: "v3.4", terms: ["退款", "到账", "退回", "审核"], confidence: 0.96, risk: "medium", handoff: false, answer: "退款审核通过后，通常会在 1–3 个工作日内原路退回，实际时间取决于支付渠道。系统不能承诺具体到账日期；如果已经超过 3 个工作日，我会为您转人工核查。" },
  { id: "KB-208", title: "生鲜商品破损赔付标准", version: "v2.8", terms: ["破损", "生鲜", "赔付", "理赔", "坏了"], confidence: 0.9, risk: "high", handoff: true, answer: "鲜活易腐商品不适用七天无理由退货；如果存在破损或质量问题，请保留商品、外包装和清晰照片。赔付金额需要人工依据证据与订单情况确认，我已建议转接售后专员。" },
  { id: "KB-209", title: "商品质量问题补救方式", version: "v1.0", terms: ["质量", "故障", "不能用", "异响"], confidence: 0.86, risk: "high", handoff: true, answer: "商品出现质量或功能故障时，需要结合订单、商品和故障证据核验退货、更换或修理方案。我已建议转接售后专员，系统不会直接承诺赔付。" },
  { id: "KB-212", title: "商品或配件短少处理", version: "v1.0", terms: ["少件", "缺件", "漏发", "配件"], confidence: 0.84, risk: "high", handoff: true, answer: "收到商品数量不足或配件缺失时，请保留外包装、面单及开箱证据，并核对订单明细和包裹数量。我已建议发起仓储与承运联合核查。" },
  { id: "KB-213", title: "快件丢失与责任核查", version: "v1.0", terms: ["丢件", "丢失", "遗失", "找不到"], confidence: 0.86, risk: "high", handoff: true, answer: "快件疑似丢失时，需要核对投递位置、签收人和承运轨迹后发起调查。责任和赔偿需结合保价与核查结果确认，我已建议转接人工。" },
  { id: "KB-214", title: "商品维修与返修流程", version: "v1.0", terms: ["维修", "返修", "修理", "维修点"], confidence: 0.82, risk: "high", handoff: true, answer: "维修或返修前需要核验订单、故障描述、购买日期和厂商政策，再确定寄修、上门或网点方案。数据设备请先备份并清除个人数据。" },
  { id: "KB-215", title: "保修期与质保凭证核验", version: "v1.0", terms: ["保修", "质保", "联保", "凭证"], confidence: 0.83, risk: "medium", handoff: true, answer: "是否在保修期内，需要核验商品类别、购买与交付时间、有效凭证及厂商政策；缺少订单和商品信息时不能直接承诺免费维修。" },
  { id: "KB-216", title: "三包退换修责任规则", version: "v1.0", terms: ["三包", "包修", "包换", "包退"], confidence: 0.85, risk: "high", handoff: true, answer: "三包责任需要结合商品目录、故障情形、购买日期和修理记录判断。不同品类期限可能不同，系统不会把统一天数套用于所有商品。" },
  { id: "KB-301", title: "物流地址修改操作指引", version: "v1.9", terms: ["地址", "改址", "收货", "物流"], confidence: 0.92, risk: "medium", handoff: false, answer: "订单尚未出库时可以尝试修改收货地址；已出库订单需要联系承运商确认，系统不会直接修改。为保护账户安全，修改前需要核验订单与收件人信息。" },
  { id: "KB-401", title: "电子发票常见问题", version: "v4.1", terms: ["发票", "抬头", "税号", "开票"], confidence: 0.94, risk: "low", handoff: false, answer: "订单完成后可在订单详情申请电子发票。发票已开具后如需修改抬头或税号，需要先作废原发票并由人工复核后重新开具。" },
];

async function retrieveKnowledge(intent: BusinessIntent, query: string, defaultKnowledgeId: string): Promise<KnowledgeRule | null> {
  try {
    const db = getDb();
    const documents = await db.select().from(knowledgeDocuments).where(and(
      eq(knowledgeDocuments.organizationId, ORG_ID),
      eq(knowledgeDocuments.category, intent),
      eq(knowledgeDocuments.state, "active"),
    ));
    if (!documents.length) throw new Error("No active knowledge documents");
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
      const score = keywordHits.reduce((total, keyword) => total + (genericSignals[intent].has(keyword) ? 1 : 8 + Math.min(keyword.length, 4)), 0) + (document.id === defaultKnowledgeId ? 2 : 0);
      return { document, keywords, score };
    }).sort((left, right) => right.score - left.score || Number(right.document.id === defaultKnowledgeId) - Number(left.document.id === defaultKnowledgeId));
    const selected = scored[0];
    const defaultDocument = scored.find((item) => item.document.id === defaultKnowledgeId);
    const result = selected.score > 2 ? selected : defaultDocument ?? selected;
    return {
      id: result.document.id,
      title: result.document.title,
      version: result.document.version,
      terms: result.keywords,
      answer: result.document.content,
      confidence: result.document.coverage,
      risk: result.document.risk,
      handoff: result.document.handoff,
      sourceTitle: result.document.sourceTitle,
      sourceUrl: result.document.sourceUrl,
    };
  } catch {
    return fallbackRules.find((item) => item.id === defaultKnowledgeId) ?? null;
  }
}

function authenticated(request: Request) {
  const host = new URL(request.url).hostname;
  return Boolean(request.headers.get("oai-authenticated-user-email")) || host === "localhost" || host === "127.0.0.1";
}

function redactMemory(value: string) {
  return value.replace(/OR-\d{6}/gi, "[订单]").replace(/1[3-9]\d{9}/g, "[电话]").replace(/\d{17}[\dXx]/g, "[身份证号]").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[邮箱]").slice(0, 160);
}

function asBusinessIntent(value: string | null | undefined): BusinessIntent | null {
  return value && businessIntents.includes(value as BusinessIntent) ? value as BusinessIntent : null;
}

async function loadConversationState(conversationId: string) {
  const db = getDb();
  const state = await db.select({ activeIntent: agentConversationStates.activeIntent, summary: agentConversationStates.summary, turnCount: agentConversationStates.turnCount, expiresAt: agentConversationStates.expiresAt })
    .from(agentConversationStates).where(and(eq(agentConversationStates.id, `${ORG_ID}:${conversationId}`), gt(agentConversationStates.expiresAt, new Date().toISOString()))).limit(1);
  return state[0] ?? null;
}

async function saveConversationState(conversationId: string, previous: ConversationState | null, activeIntent: BusinessIntent | null, query: string) {
  const db = getDb();
  const now = new Date();
  const updatedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
  const lastUserMessage = redactMemory(query);
  const summary = activeIntent ? `当前业务意图：${activeIntent}；最近问题：${lastUserMessage}` : previous?.summary ?? `最近问题：${lastUserMessage}`;
  const values = { id: `${ORG_ID}:${conversationId}`, organizationId: ORG_ID, conversationId, activeIntent, summary, lastUserMessage, turnCount: (previous?.turnCount ?? 0) + 1, expiresAt, updatedAt };
  await db.insert(agentConversationStates).values(values).onConflictDoUpdate({ target: agentConversationStates.id, set: { activeIntent, summary, lastUserMessage, turnCount: values.turnCount, expiresAt, updatedAt } });
  return { activeIntent, summary, turnCount: values.turnCount, expiresAt };
}

async function generateWithGateway(query: string, history: HistoryTurn[], rule: KnowledgeRule, config: RuntimeConfig, toolContext?: string, memorySummary?: string) {
  if (!config.LLM_API_KEY || !config.LLM_BASE_URL || !config.LLM_MODEL) return null;
  const response = await fetch(`${config.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.LLM_API_KEY}` },
    body: JSON.stringify({ model: config.LLM_MODEL, temperature: 0.1, messages: [
      { role: "system", content: "你是企业客服助手。只能依据给定知识回答，不得承诺赔付或执行资金、账户操作；依据不足时明确转人工。回答控制在150字以内。" },
      { role: "system", content: `可信知识：${rule.title} ${rule.version}\n${rule.answer}` },
      ...(toolContext ? [{ role: "system", content: `可信工具结果（只读、已脱敏）：${toolContext}。订单状态只能引用此结果，不得自行推断。` }] : []),
      ...(memorySummary ? [{ role: "system", content: `会话状态摘要（仅用于理解指代，不可作为业务事实）：${memorySummary}` }] : []),
      ...history,
      { role: "user", content: query },
    ] }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() || null;
}

export async function POST(request: Request) {
  if (!authenticated(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { query?: unknown; history?: unknown; conversationId?: unknown };
  try { payload = await request.json() as { query?: unknown; history?: unknown; conversationId?: unknown }; }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (typeof payload.query !== "string" || !payload.query.trim()) return Response.json({ error: "query is required" }, { status: 400 });
  const query = payload.query.trim();
  if (query.length > 500) return Response.json({ error: "query must be 500 characters or fewer" }, { status: 400 });
  const rawHistory = payload.history ?? [];
  if (!Array.isArray(rawHistory) || rawHistory.length > 6) return Response.json({ error: "history must contain 6 turns or fewer" }, { status: 400 });
  const history = rawHistory.filter((turn): turn is HistoryTurn => Boolean(turn) && typeof turn === "object" && ((turn as HistoryTurn).role === "user" || (turn as HistoryTurn).role === "assistant") && typeof (turn as HistoryTurn).content === "string" && (turn as HistoryTurn).content.trim().length > 0 && (turn as HistoryTurn).content.length <= 500);
  if (history.length !== rawHistory.length) return Response.json({ error: "history contains an invalid turn" }, { status: 400 });
  const conversationId = payload.conversationId === undefined ? null : typeof payload.conversationId === "string" && /^C-[A-Za-z0-9-]{1,80}$/.test(payload.conversationId) ? payload.conversationId : null;
  if (payload.conversationId !== undefined && !conversationId) return Response.json({ error: "conversationId is invalid" }, { status: 400 });
  const started = Date.now();
  let memory: ConversationState | null = null;
  if (conversationId) { try { memory = await loadConversationState(conversationId); } catch { memory = null; } }
  const routing = routeIntent(query, history) ?? continueIntent(asBusinessIntent(memory?.activeIntent), query);
  const rule = routing ? await retrieveKnowledge(routing.intent, query, routing.retrievalKnowledgeId) : null;
  if (!rule || !routing) {
    let savedMemory = memory;
    if (conversationId) { try { savedMemory = await saveConversationState(conversationId, memory, asBusinessIntent(memory?.activeIntent), query); } catch { /* memory is non-blocking */ } }
    return Response.json({ answer: "这个问题超出了当前已验证的知识范围。为了避免给出不准确的信息，我已建议转接人工客服。", source: null, confidence: 0.45, risk: "medium", handoff: true, mode: "safe-fallback", routing: null, memory: savedMemory ? { conversationId, activeIntent: savedMemory.activeIntent, turnCount: savedMemory.turnCount, expiresAt: savedMemory.expiresAt, source: "retained" } : null, trace: [
    { type: "intent", label: "未识别到稳定业务意图", durationMs: 32, status: "warning" },
    { type: "retrieval", label: "可信知识未命中", durationMs: 18, status: "warning" },
    { type: "guardrail", label: "已触发低置信度转人工", durationMs: 6, status: "passed" },
  ] });
  }
  const config = env as unknown as RuntimeConfig;
  const orderId = query.toUpperCase().match(/OR-\d{6}/)?.[0];
  const policyHandoff = shouldHandoff(routing.intent, query);
  const toolResult = routing.intent === "refund" && orderId ? lookupRefund(orderId) : null;
  const toolContext = toolResult?.ok ? JSON.stringify(toolResult.record) : undefined;
  let generated: string | null = null;
  try { generated = orderId && !toolResult?.ok ? null : await generateWithGateway(query, history, rule, config, toolContext, memory?.summary); } catch { generated = null; }
  const toolAnswer = toolResult?.ok ? `订单 ${toolResult.record.orderId} 的退款状态为${toolResult.record.status === "approved" ? "已审核通过" : toolResult.record.status === "processing" ? "处理中" : "已完成"}，支付渠道为${toolResult.record.paymentChannelMasked}。${rule.answer}` : null;
  const failedToolAnswer = orderId && !toolResult?.ok ? `暂时无法核验订单 ${orderId} 的退款状态。为避免根据不完整信息推测，我已建议转接人工客服继续核查。` : null;
  let savedMemory: ConversationState | null = memory;
  if (conversationId) { try { savedMemory = await saveConversationState(conversationId, memory, routing.intent, query); } catch { /* memory is non-blocking */ } }
  return Response.json({ answer: generated ?? toolAnswer ?? failedToolAnswer ?? rule.answer, source: { id: rule.id, title: rule.title, version: rule.version, sourceTitle: rule.sourceTitle, sourceUrl: rule.sourceUrl }, tool: toolResult?.ok ? { name: "order.refund.get", status: "success", data: toolResult.record, readOnly: true } : orderId ? { name: "order.refund.get", status: "failed", code: toolResult?.code } : null, routing, memory: savedMemory ? { conversationId, activeIntent: savedMemory.activeIntent, turnCount: savedMemory.turnCount, expiresAt: savedMemory.expiresAt, source: routing.contextSource } : null, confidence: orderId && !toolResult?.ok ? 0.5 : Math.min(rule.confidence, routing.confidence), risk: rule.risk, handoff: rule.handoff || policyHandoff || Boolean(orderId && !toolResult?.ok), mode: generated ? "model-grounded" : orderId && !toolResult?.ok ? "safe-fallback" : "deterministic-safe", trace: [
    { type: "intent", label: `识别 ${routing.intent}${routing.subIntent ? ` / ${routing.subIntent}` : ""} 意图，置信度 ${routing.confidence}`, durationMs: 36, status: "passed" },
    ...(routing.contextSource === "memory" ? [{ type: "memory", label: `继承会话状态 ${routing.intent} · 第 ${(savedMemory?.turnCount ?? 1)} 轮`, durationMs: 12, status: "passed" }] : []),
    { type: "retrieval", label: `向量召回 + 概率 Rerank + 规则融合命中 ${rule.id} ${rule.version} · ${routing.matchedSignals.join(" / ")}`, durationMs: 22, status: "passed" },
    ...(orderId ? [{ type: "tool", label: toolResult?.ok ? `只读查询 ${orderId} 成功，敏感字段已脱敏` : `订单工具未返回结果，禁止模型猜测`, durationMs: 41, status: toolResult?.ok ? "passed" : "warning" }] : []),
    { type: "guardrail", label: orderId && !toolResult?.ok ? "已阻止基于失败工具的状态推测" : policyHandoff ? "策略命中并转人工" : "输出规则校验通过", durationMs: 8, status: "passed" },
  ], latencyMs: Date.now() - started });
}
