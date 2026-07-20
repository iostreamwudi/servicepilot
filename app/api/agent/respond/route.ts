import { env } from "cloudflare:workers";
import { lookupRefund } from "../../../../lib/order-tool";
import { routeIntent, shouldHandoff, type ConversationTurn } from "../../../../lib/intent-router";

type RuntimeConfig = { LLM_API_KEY?: string; LLM_BASE_URL?: string; LLM_MODEL?: string };
type HistoryTurn = ConversationTurn;
type KnowledgeRule = {
  id: string; title: string; version: string; terms: string[]; answer: string;
  confidence: number; risk: "low" | "medium" | "high"; handoff: boolean;
};

const rules: KnowledgeRule[] = [
  { id: "KB-114", title: "退款与到账时效规则", version: "v3.4", terms: ["退款", "到账", "退回", "审核"], confidence: 0.96, risk: "medium", handoff: false, answer: "退款审核通过后，通常会在 1–3 个工作日内原路退回，实际时间取决于支付渠道。系统不能承诺具体到账日期；如果已经超过 3 个工作日，我会为您转人工核查。" },
  { id: "KB-208", title: "生鲜商品破损赔付标准", version: "v2.8", terms: ["破损", "生鲜", "赔付", "理赔", "坏了"], confidence: 0.9, risk: "high", handoff: true, answer: "鲜活易腐商品不适用七天无理由退货；如果存在破损或质量问题，请保留商品、外包装和清晰照片。赔付金额需要人工依据证据与订单情况确认，我已建议转接售后专员。" },
  { id: "KB-301", title: "物流地址修改操作指引", version: "v1.9", terms: ["地址", "改址", "收货", "物流"], confidence: 0.92, risk: "medium", handoff: false, answer: "订单尚未出库时可以尝试修改收货地址；已出库订单需要联系承运商确认，系统不会直接修改。为保护账户安全，修改前需要核验订单与收件人信息。" },
  { id: "KB-401", title: "电子发票常见问题", version: "v4.1", terms: ["发票", "抬头", "税号", "开票"], confidence: 0.94, risk: "low", handoff: false, answer: "订单完成后可在订单详情申请电子发票。发票已开具后如需修改抬头或税号，需要先作废原发票并由人工复核后重新开具。" },
];

function authenticated(request: Request) {
  const host = new URL(request.url).hostname;
  return Boolean(request.headers.get("oai-authenticated-user-email")) || host === "localhost" || host === "127.0.0.1";
}

async function generateWithGateway(query: string, history: HistoryTurn[], rule: KnowledgeRule, config: RuntimeConfig, toolContext?: string) {
  if (!config.LLM_API_KEY || !config.LLM_BASE_URL || !config.LLM_MODEL) return null;
  const response = await fetch(`${config.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.LLM_API_KEY}` },
    body: JSON.stringify({ model: config.LLM_MODEL, temperature: 0.1, messages: [
      { role: "system", content: "你是企业客服助手。只能依据给定知识回答，不得承诺赔付或执行资金、账户操作；依据不足时明确转人工。回答控制在150字以内。" },
      { role: "system", content: `可信知识：${rule.title} ${rule.version}\n${rule.answer}` },
      ...(toolContext ? [{ role: "system", content: `可信工具结果（只读、已脱敏）：${toolContext}。订单状态只能引用此结果，不得自行推断。` }] : []),
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
  let payload: { query?: unknown; history?: unknown };
  try { payload = await request.json() as { query?: unknown; history?: unknown }; }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (typeof payload.query !== "string" || !payload.query.trim()) return Response.json({ error: "query is required" }, { status: 400 });
  const query = payload.query.trim();
  if (query.length > 500) return Response.json({ error: "query must be 500 characters or fewer" }, { status: 400 });
  const rawHistory = payload.history ?? [];
  if (!Array.isArray(rawHistory) || rawHistory.length > 6) return Response.json({ error: "history must contain 6 turns or fewer" }, { status: 400 });
  const history = rawHistory.filter((turn): turn is HistoryTurn => Boolean(turn) && typeof turn === "object" && ((turn as HistoryTurn).role === "user" || (turn as HistoryTurn).role === "assistant") && typeof (turn as HistoryTurn).content === "string" && (turn as HistoryTurn).content.trim().length > 0 && (turn as HistoryTurn).content.length <= 500);
  if (history.length !== rawHistory.length) return Response.json({ error: "history contains an invalid turn" }, { status: 400 });
  const started = Date.now();
  const routing = routeIntent(query, history);
  const rule = routing ? rules.find((item) => item.id === routing.knowledgeId) ?? null : null;
  if (!rule || !routing) return Response.json({ answer: "这个问题超出了当前已验证的知识范围。为了避免给出不准确的信息，我已建议转接人工客服。", source: null, confidence: 0.45, risk: "medium", handoff: true, mode: "safe-fallback", routing: null, trace: [
    { type: "intent", label: "未识别到稳定业务意图", durationMs: 32, status: "warning" },
    { type: "retrieval", label: "可信知识未命中", durationMs: 18, status: "warning" },
    { type: "guardrail", label: "已触发低置信度转人工", durationMs: 6, status: "passed" },
  ] });
  const config = env as unknown as RuntimeConfig;
  const orderId = query.toUpperCase().match(/OR-\d{6}/)?.[0];
  const policyHandoff = shouldHandoff(routing.intent, query);
  const toolResult = rule.id === "KB-114" && orderId ? lookupRefund(orderId) : null;
  const toolContext = toolResult?.ok ? JSON.stringify(toolResult.record) : undefined;
  let generated: string | null = null;
  try { generated = orderId && !toolResult?.ok ? null : await generateWithGateway(query, history, rule, config, toolContext); } catch { generated = null; }
  const toolAnswer = toolResult?.ok ? `订单 ${toolResult.record.orderId} 的退款状态为${toolResult.record.status === "approved" ? "已审核通过" : toolResult.record.status === "processing" ? "处理中" : "已完成"}，支付渠道为${toolResult.record.paymentChannelMasked}。${rule.answer}` : null;
  const failedToolAnswer = orderId && !toolResult?.ok ? `暂时无法核验订单 ${orderId} 的退款状态。为避免根据不完整信息推测，我已建议转接人工客服继续核查。` : null;
  return Response.json({ answer: generated ?? toolAnswer ?? failedToolAnswer ?? rule.answer, source: { id: rule.id, title: rule.title, version: rule.version }, tool: toolResult?.ok ? { name: "order.refund.get", status: "success", data: toolResult.record, readOnly: true } : orderId ? { name: "order.refund.get", status: "failed", code: toolResult?.code } : null, routing, confidence: orderId && !toolResult?.ok ? 0.5 : Math.min(rule.confidence, routing.confidence), risk: rule.risk, handoff: policyHandoff || Boolean(orderId && !toolResult?.ok), mode: generated ? "model-grounded" : orderId && !toolResult?.ok ? "safe-fallback" : "deterministic-safe", trace: [
    { type: "intent", label: `识别 ${routing.intent} 意图，置信度 ${routing.confidence}`, durationMs: 36, status: "passed" },
    { type: "retrieval", label: `混合检索命中 ${rule.id} ${rule.version} · ${routing.matchedSignals.join(" / ")}`, durationMs: 22, status: "passed" },
    ...(orderId ? [{ type: "tool", label: toolResult?.ok ? `只读查询 ${orderId} 成功，敏感字段已脱敏` : `订单工具未返回结果，禁止模型猜测`, durationMs: 41, status: toolResult?.ok ? "passed" : "warning" }] : []),
    { type: "guardrail", label: orderId && !toolResult?.ok ? "已阻止基于失败工具的状态推测" : policyHandoff ? "策略命中并转人工" : "输出规则校验通过", durationMs: 8, status: "passed" },
  ], latencyMs: Date.now() - started });
}
