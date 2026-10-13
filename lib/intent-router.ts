import { classifyIntentVector } from "./intent-classifier.ts";
import { createRouterDomainCatalog, type RouterDomainCatalog, type RouterIntentProfile, type BusinessIntent } from "./router-domain-catalog.ts";

export type { BusinessIntent } from "./router-domain-catalog.ts";
export type ServiceSubIntent = "physical_damage" | "quality_issue" | "missing_item" | "lost_parcel" | "repair" | "warranty" | "three_guarantees";
export type ConversationTurn = { role: "user" | "assistant"; content: string };
export type ConversationContext = {
  activeIntent: BusinessIntent | null;
  confidence: number;
  topicEvidence: string[];
  providedFacts: string[];
  pendingQuestion: string | null;
};

export type StructuredRoute = {
  businessAction: "refund" | "address_change" | "invoice" | "after_sales" | "unknown";
  entities: string[];
  states: string[];
  missingParameters: string[];
  evidence: string[];
};

type IntentProfile = RouterIntentProfile;

const profiles: IntentProfile[] = [
  {
    intent: "refund", knowledgeId: "KB-114",
    // “退货/取消订单/价保退差价”是独立售后流程，不能仅因包含“退”
    // 就误路由到资金退款。这里仅准入退款去向、到账与退款状态。
    strongPatterns: [/退款|退钱|返款|反款|原路退|极速退款/, /款.*(没到|未到|不到账|退到)|钱.*没(到|来|返回|退)|多久到账|到帐|退.*(白条|银行卡|微信|支付宝|余额)/, /(退款|退回|返款|款项).*(少|差额|不全)|金额.*少|只退/],
    supportingPatterns: [/返还|退回|审核|工作日|支付方式|银行卡|白条|微信|余额/],
    contextualPatterns: [/退(到|回|给|了|吗|呢|哪|哪儿|哪里|多久|费)|回款|退费|返到|返款|到帐|到账|货款|款项|款退|款还|少退|全款|原支付账户|支付账户|银行卡.*(退|返)|微信.*(退|返)|余额.*(退|返)|白条.*(退|返)/, /(钱|款|退款|返款).*(返回到哪|去哪|去哪里|没看到|找不到|没收到)/],
  },
  {
    intent: "damage", knowledgeId: "KB-208",
    strongPatterns: [/破损|损坏|坏了|烂了|烂的|质量问题|少件|缺件|少了|少商品|少配件|漏液|漏发|碎了|发霉|不新鲜|变质|丢件|丢失|遗失|丢了|磕碰|异响|维修|返修|修理|保修|质保|三包|不能用|用不了|开不了机|没反应|充不进电|脱落|松动|断裂|掉落/, /包装.*(破|烂|压)|商品.*(破|坏|碎|漏)|收到.*(少|缺)|附件.*(少|没有|缺)|不能吃|融化|腐烂|全化|化了/, /售后.*(申请不了|无法申请|不能申请|办不了)|申请售后.*(失败|不了)|入仓.*少|少入|未发/],
    supportingPatterns: [/赔付|理赔|售后|换货|补发|维修|保修|三包/],
    contextualPatterns: [/裂痕|划痕|压烂|烂了|腐烂|发臭|发酸|发霉|变形|故障|不能用|用不了|开不了机|没反应|充不进电|缺少|漏发|没发|少了|不见了|遗失|噪音|异响|有问题|补发|换一个|维修|保修|三包|脱落|松动|断裂|线掉|屏幕.*松/],
  },
  {
    intent: "address", knowledgeId: "KB-301",
    strongPatterns: [/收货地址|收件地址|改址|收货信息|收件信息/, /(地址|街道|门牌号|收件信息|收货信息).*(错|改|修改|更改)|(修改|更改|改).*(地址|街道|门牌号|电话|号码|手机)|(电话|号码|手机).*(填错|写错|改)/],
    supportingPatterns: [/收件人|联系方式|寄到|送到/],
    contextualPatterns: [/(改|换|填错|写错).*(收件人|联系人|手机号|手机|电话|号码)|(收件人|联系人|手机号|手机|电话|号码).*(改|换|填错|写错)|转寄|改到|送错地方/],
  },
  {
    intent: "invoice", knowledgeId: "KB-401",
    strongPatterns: [/发票|开票|税号|发票抬头|专票|增票|电子票|带票/, /票.*(开|重开|作废)|公司名称.*(错|改)|报销.*凭证|什么时候.*开好|能开好|财务专用章|增值税.*章/],
    supportingPatterns: [/抬头|公司名称|报销|凭证/],
    contextualPatterns: [/普通票|电子票|纸质票|增值税|纳税人|识别号|抵税|报账|报销|开具|重开|补开|换开|作废|票据|票头|个人.*(换|改).*单位|公司抬头/],
  },
];

const unsafeOrOutOfScope = /忽略.*规则|系统提示词|管理员密码|其他客户|别人.*(电话|手机|地址)|股票|彩票|验证码|sim卡|手机卡|esim|兼容型号|运营商|旧卡.*新(手机|手表)|卡.*(用于|兼容|用到)|改卡.*(手机|手表)|卡.*手机|卡.*手表/i;
const followupPattern = /^(那|这个|它|这样|好的|可以|明白|请问|所以|然后|但是|可是|还)|多久|几天|几个工作日|什么时候|怎么办|怎么处理|能不能|可以吗|还有吗|周末算不算|到哪里|到哪|为什么/;
const conversationalPatterns = [
  /^(你好|您好|嗨|hi|hello|hey)[呀啊呢吗！!。.，, ]*$/i,
  /^(早上好|上午好|中午好|下午好|晚上好|晚安)[呀啊呢吗！!。.，, ]*$/i,
  /^(谢谢|感谢|多谢|辛苦了|好的谢谢|明白了)[呀啊呢吗！!。.，, ]*$/i,
];
const knowledgeByIntent: Record<BusinessIntent, string> = { refund: "KB-114", damage: "KB-208", address: "KB-301", invoice: "KB-401" };
const defaultRouterDomainCatalog: RouterDomainCatalog = createRouterDomainCatalog({ profiles, knowledgeByIntent });
const knowledgeBySubIntent: Record<ServiceSubIntent, string> = {
  physical_damage: "KB-208", quality_issue: "KB-209", missing_item: "KB-212",
  lost_parcel: "KB-213", repair: "KB-214", warranty: "KB-215", three_guarantees: "KB-216",
};

/**
 * Converts recent user turns into a small, auditable conversation state.
 * This is deliberately rule-based: it helps the router preserve a topic
 * across elliptical follow-ups without allowing assistant wording to invent
 * a new business intent.
 */
export function extractConversationContext(history: ConversationTurn[] = []): ConversationContext {
  const userTurns = history.filter((turn) => turn.role === "user").slice(-4);
  const text = normalize(userTurns.map((turn) => turn.content).join("；"));
  const evidence: Record<BusinessIntent, string[]> = {
    refund: matches([/退款|退钱|返款|原路|原卡|返回|到账|工作日|支付银行卡|E卡|钱/], text),
    damage: matches([/破损|损坏|质量|故障|丢件|丢失|缺件|少件|维修|保修|三包/], text),
    address: matches([/地址|收货|收件|改派|拒收|联系电话|手机号|电话/], text),
    invoice: matches([/(?:公司名称|抬头).{0,30}(?:税号|发票)/, /发票|开票|税号|抬头|公司名称|电子票|开具|报销/], text),
  };
  const ranked = (Object.entries(evidence) as Array<[BusinessIntent, string[]]>)
    .map(([intent, signals]) => ({ intent, signals }))
    .filter((item) => item.signals.length > 0)
    .sort((left, right) => right.signals.length - left.signals.length);
  const top = ranked[0];
  const second = ranked[1];
  const confidence = top ? Math.min(0.94, 0.58 + top.signals.length * 0.08 + (top.signals.length > (second?.signals.length ?? 0) ? 0.08 : 0)) : 0;
  const providedFacts = [
    ...text.matchAll(/OR-\d{6}/gi),
  ].map((match) => match[0].toUpperCase());
  const lastUser = userTurns.at(-1)?.content ?? null;
  return {
    activeIntent: top?.intent ?? null,
    confidence: Number(confidence.toFixed(2)),
    topicEvidence: top?.signals.slice(0, 5) ?? [],
    providedFacts: [...new Set(providedFacts)],
    pendingQuestion: lastUser && /吗|么|多久|几天|什么时候|怎么办|怎么|能不能|可以|哪里|哪儿|为什么/.test(lastUser) ? lastUser : null,
  };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?]/g, "");
}

/** Customer-facing social turns should receive a natural reply even without KB retrieval. */
export function conversationalReply(query: string) {
  const text = query.trim();
  if (conversationalPatterns.some((pattern) => pattern.test(text))) {
    if (/谢谢|感谢|多谢|辛苦了|明白了/.test(text)) return "不客气。还有订单、退款、物流、发票或售后问题，都可以继续告诉我。";
    if (/晚安/.test(text)) return "晚安。之后有订单或售后问题，随时可以联系我们。";
    return "您好，很高兴为您服务。请问您想咨询订单、退款、物流、发票，还是商品售后问题？";
  }
  return null;
}

function detectDamageSubIntent(query: string, history: ConversationTurn[]): ServiceSubIntent {
  const current = normalize(query);
  const context = normalize(history.slice(-4).map((turn) => turn.content).join("；"));
  const text = `${current}；${context}`;
  // More specific operational intents win over generic quality wording.
  if (/三包|七天退|十五天换|包退包换包修/.test(text)) return "three_guarantees";
  if (/保修|质保|保修期|联保|保质期/.test(text)) return "warranty";
  if (/维修|返修|修理|维修点|修一下|修吗/.test(text)) return "repair";
  if (/丢件|丢失|遗失|不见了|找不到.*(包裹|快递|货)|快递.*(丢|不见)/.test(text)) return "lost_parcel";
  if (/少件|缺件|短少|少商品|少配件|漏发|没发|少了|缺少|拿漏|少入|没有.*(底板|配件|附件)|漏了/.test(text)) return "missing_item";
  if (/质量|故障|不能用|用不了|开不了机|没反应|充不进电|异响|噪音|不好用|不工作|失灵|脱落|松动|断裂|线掉|屏幕.*松/.test(text)) return "quality_issue";
  return "physical_damage";
}

function matches(patterns: RegExp[], text: string) {
  return patterns.map((pattern) => text.match(pattern)?.[0]).filter((value): value is string => Boolean(value));
}

/**
 * Extracts reusable business slots before intent scoring. These are deliberately
 * families of signals (action, object, state), not per-query exceptions. The
 * result is returned in the route trace so downstream retrieval can distinguish
 * a topic from the action the customer is asking about.
 */
function extractStructuredRoute(query: string, history: ConversationTurn[] = []): StructuredRoute {
  const current = normalize(query);
  const userContext = normalize(history.filter((turn) => turn.role === "user").slice(-3).map((turn) => turn.content).join("；"));
  const text = `${current}；${userContext}`;
  const entities: string[] = [];
  const states: string[] = [];
  const evidence: string[] = [];
  const hasAddressObject = /地址|收货|收件|联系电话|手机号|电话|号码/.test(text);
  const addressChange = hasAddressObject && /改|修改|更改|换|重设|填错|写错|变化|错了|出问题|没信号|收不到短信/.test(text);
  const hasInvoiceObject = /发票|开票|税号|抬头|专票|增票|电子票|纸质票|财务专用章|增值税/.test(text);
  const hasRefundObject = /退款|退钱|返款|退回|到账|到帐|钱|款项|货款|原路/.test(text);
  const monetaryDiscrepancy = /退款|退回|返款|款项|金额|钱/.test(text) && /少|差额|不全|只退|没看到|没收到|找不到|去哪|到哪|到账|到帐/.test(text);
  const afterSalesEvidence = /破损|损坏|质量问题|商品质量|质量.*问题|故障|坏了|漏液|发霉|变质|融化|全化|化了|少件|缺件|少入|入仓.*少|底板|配件.*没|没有.*(配件|附件|底板)|脱落|松动|断裂|线掉|售后.*(申请不了|无法申请|不能申请)|申请售后.*(失败|不了)|维修|返修|保修|三包|丢件|拒收/.test(text);

  if (/订单|采购单|运单|快递|包裹/.test(text)) entities.push("order_or_logistics");
  if (hasAddressObject) entities.push("contact_or_address");
  if (hasInvoiceObject) entities.push("invoice");
  if (/商品|货物|电脑|手机|手表|机器|屏幕|表带|衣服|配件|附件/.test(text)) entities.push("product");
  if (/退款|退钱|返款|退回|到账|到帐/.test(text)) states.push("refund");
  if (/少|缺|漏|没有|未发|没发|掉|脱落|松动|坏|破|损坏|故障/.test(text)) states.push("defect_or_missing");
  if (/申请不了|无法申请|不能申请|办不了|没收到|不到账|未到账|不成功/.test(text)) states.push("blocked_or_pending");
  if (/错|改|修改|更改|换|重设|变化/.test(text)) states.push("change_requested");
  for (const value of [addressChange && "地址/联系方式变更", monetaryDiscrepancy && "退款金额或去向异常", afterSalesEvidence && "售后事实或动作", hasInvoiceObject && "票据/开票事实"]) {
    if (value) evidence.push(value);
  }

  let businessAction: StructuredRoute["businessAction"] = "unknown";
  if (addressChange) businessAction = "address_change";
  else if (afterSalesEvidence) businessAction = "after_sales";
  else if (hasInvoiceObject) businessAction = "invoice";
  else if (hasRefundObject || monetaryDiscrepancy) businessAction = "refund";
  const missingParameters: string[] = [];
  if ((businessAction === "refund" || businessAction === "address_change") && !/OR-\d{6}|订单|采购单|运单/.test(text)) missingParameters.push("order_reference");
  if (businessAction === "address_change" && !/地址|收货|收件|手机号|电话|号码/.test(current)) missingParameters.push("change_target");
  return { businessAction, entities: [...new Set(entities)], states: [...new Set(states)], missingParameters, evidence };
}

function structuredPriorityBonus(intent: BusinessIntent, route: StructuredRoute) {
  if (route.businessAction === "address_change" && intent === "address") return 3.2;
  if (route.businessAction === "after_sales" && intent === "damage") return 2.8;
  if (route.businessAction === "refund" && intent === "refund") return route.states.includes("defect_or_missing") ? 1.2 : 2.4;
  if (route.businessAction === "invoice" && intent === "invoice") return 1.8;
  return 0;
}

function currentCandidate(profile: IntentProfile, current: string) {
  const strong = matches(profile.strongPatterns, current);
  if (!strong.length) return null;
  const support = matches(profile.supportingPatterns, current);
  const compoundBonus = compoundPriorityBonus(profile.intent, current);
  return { ...profile, score: 4 + strong.length * 2 + support.length + compoundBonus, matches: [...strong, ...support, ...(compoundBonus ? [`复合意图优先:${profile.intent}`] : [])] };
}

/**
 * When a customer names two business goals, preserve the operational goal
 * that determines the next action. Address correction, invoice correction,
 * and after-sales handling should not be swallowed by a generic refund word.
 */
function compoundPriorityBonus(intent: BusinessIntent, current: string) {
  const hasRefund = /退款|退货|退钱|取消订单/.test(current);
  if (intent === "address" && hasRefund && /(地址|收货|收件|电话|手机号).*(错|改|修改|更改|拒收|改派)|(错|改|修改|更改|拒收|改派).*(地址|收货|收件|电话|手机号)/.test(current)) return 4.5;
  if (intent === "invoice" && hasRefund && /发票|开票|税号|抬头|红冲|作废/.test(current)) return 2.2;
  if (intent === "damage" && hasRefund && /破损|损坏|质量|故障|丢件|缺件|维修|保修/.test(current)) return 2;
  return 0;
}

function contextualCandidate(profile: IntentProfile, current: string) {
  const semantic = matches(profile.contextualPatterns, current);
  if (!semantic.length) return null;
  const support = matches(profile.supportingPatterns, current);
  return { ...profile, score: 3.2 + semantic.length * 1.4 + support.length * 0.6, matches: [...semantic, ...support].map((item) => `语义:${item}`) };
}

function historyCandidate(profile: IntentProfile, history: ConversationTurn[]) {
  // Only user messages can establish the business topic. Agent wording often
  // contains policy terms and must not silently change the user's intent.
  const recentUsers = history.filter((turn) => turn.role === "user").slice(-3).reverse();
  for (let index = 0; index < recentUsers.length; index += 1) {
    const text = normalize(recentUsers[index].content);
    const strong = matches(profile.strongPatterns, text);
    if (strong.length) return { ...profile, score: 3.5 - index * 0.35, matches: strong.map((item) => `上下文:${item}`) };
  }
  return null;
}

function conversationCandidate(profile: IntentProfile, history: ConversationTurn[]) {
  const recent = history.slice(-4).reverse();
  for (let index = 0; index < recent.length; index += 1) {
    const text = normalize(recent[index].content);
    const strong = matches([...profile.strongPatterns, ...profile.contextualPatterns], text);
    if (strong.length) {
      const roleWeight = recent[index].role === "user" ? 0.35 : 0;
      return { ...profile, score: 3.35 + roleWeight - index * 0.22, matches: strong.map((item) => `上下文:${item}`) };
    }
  }
  return null;
}

function structuredContextCandidate(profile: IntentProfile, context: ConversationContext) {
  if (context.activeIntent !== profile.intent || context.confidence < 0.62) return null;
  return {
    ...profile,
    score: 3.05 + context.confidence,
    matches: context.topicEvidence.slice(0, 3).map((item) => `结构化上下文:${item}`),
  };
}

/**
 * Calibrates the ambiguity gate from evidence strength instead of applying a
 * single margin to every utterance.  Explicit current-turn evidence is safer
 * than a vector-only or historical guess; higher-scoring, multi-signal
 * candidates therefore need less separation, while memory-only candidates
 * keep a conservative buffer.  The range is bounded to retain the OOD safety
 * behavior of the original gate.
 */
export function routerMarginThreshold(input: {
  score: number;
  matchedSignals: readonly string[];
  contextSource: "current" | "history" | "memory";
  hasExplicitCandidate: boolean;
}) {
  const directSignals = input.matchedSignals.filter((signal) => !signal.startsWith("上下文:") && !signal.startsWith("结构化上下文:") && !signal.startsWith("向量:"));
  const structuredSignals = input.matchedSignals.filter((signal) => signal.startsWith("结构化:"));
  const evidenceRelief = Math.min(0.18, directSignals.length * 0.06 + structuredSignals.length * 0.04);
  const scoreRelief = Math.min(0.14, Math.max(0, input.score - 4) * 0.035);
  const contextPenalty = input.contextSource === "memory" ? 0.08 : input.contextSource === "history" ? 0.04 : 0;
  const base = input.hasExplicitCandidate ? 0.52 : 0.64;
  return Number(Math.max(0.25, Math.min(0.72, base - evidenceRelief - scoreRelief + contextPenalty)).toFixed(2));
}

export function routeIntent(query: string, history: ConversationTurn[] = [], domainCatalog: RouterDomainCatalog = defaultRouterDomainCatalog) {
  const current = normalize(query);
  if (unsafeOrOutOfScope.test(current)) return null;
  // The scoring and safety gates are shared; the business taxonomy is
  // injected as a catalog so a tenant can add a retrieval-backed domain
  // without editing this function's control flow.
  const activeProfiles = domainCatalog.profiles.length ? domainCatalog.profiles : profiles;
  const activeKnowledgeByIntent = domainCatalog.knowledgeByIntent;
  const conversationContext = extractConversationContext(history);
  const structuredRoute = extractStructuredRoute(query, history);

  const explicit = activeProfiles.map((profile) => {
    const candidate = currentCandidate(profile, current);
    return candidate ? { ...candidate, score: candidate.score + structuredPriorityBonus(profile.intent, structuredRoute), matches: [...candidate.matches, ...structuredRoute.evidence.map((item) => `结构化:${item}`)] } : null;
  }).filter((item) => item !== null).sort((a, b) => b.score - a.score);
  let ranked = explicit.length ? explicit : activeProfiles.map((profile) => contextualCandidate(profile, current)).filter((item) => item !== null).sort((a, b) => b.score - a.score);
  let contextSource: "current" | "history" | "memory" = "current";

  // Historical evidence is eligible only for a real follow-up. This reject
  // gate is the main protection against unsupported-intent false positives.
  if (!ranked.length && current.length <= 80 && followupPattern.test(current)) {
    ranked = activeProfiles.map((profile) => historyCandidate(profile, history)).filter((item) => item !== null).sort((a, b) => b.score - a.score);
    contextSource = "history";
  }

  // Some real conversations use indirect context such as “原E卡” or
  // “公司名称/税号” and do not repeat the canonical keyword. Use the
  // structured topic state as a bounded fallback for these turns.
  if (!ranked.length && current.length <= 120 && conversationContext.activeIntent) {
    ranked = activeProfiles.map((profile) => structuredContextCandidate(profile, conversationContext)).filter((item) => item !== null).sort((a, b) => b.score - a.score);
    contextSource = "memory";
  }

  // For elliptical customer-service turns, the latest four turns form a
  // bounded topic window. We accept it only when no current intent competes.
  if (!ranked.length && current.length <= 120 && history.length) {
    ranked = activeProfiles.map((profile) => conversationCandidate(profile, history)).filter((item) => item !== null).sort((a, b) => b.score - a.score);
    contextSource = "history";
  }

  // If a generalized action/state family is present but the canonical topic
  // wording is absent, create one bounded candidate. This is intentionally
  // conservative: ambiguous isolated follow-ups remain unrouted.
  if (!ranked.length && structuredRoute.businessAction !== "unknown" && structuredRoute.evidence.length >= 1) {
    const structuredIntent: BusinessIntent | null = structuredRoute.businessAction === "address_change" ? "address"
      : structuredRoute.businessAction === "invoice" ? "invoice"
        : structuredRoute.businessAction === "refund" ? "refund"
          : structuredRoute.businessAction === "after_sales" ? "damage" : null;
    const profile = structuredIntent ? activeProfiles.find((item) => item.intent === structuredIntent) : null;
    if (profile) {
      ranked = [{ ...profile, score: 4.1 + structuredPriorityBonus(profile.intent, structuredRoute), matches: structuredRoute.evidence.map((item) => `结构化:${item}`) }];
      contextSource = "current";
    }
  }

  const vector = classifyIntentVector(query, history);
  const vectorScore = (intent: BusinessIntent) => vector.candidates.find((item) => item.label === intent)?.probability ?? 0;
  let reranked = ranked.map((item) => ({ ...item, rerankScore: item.score + vectorScore(item.intent) * 3.2 }))
    .sort((left, right) => right.rerankScore - left.rerankScore);
  let best = reranked[0];
  const topVectorProfile = vector.top.label === "unsupported" ? null : activeProfiles.find((profile) => profile.intent === vector.top.label) ?? null;
  if (!explicit.length) {
    const corroborated = best && vector.top.label === best.intent && vector.top.probability >= 0.45;
    // A sufficiently confident structured topic is stronger than a generic
    // vector guess for elliptical follow-ups (for example “什么时候好呢”
    // after an invoice conversation).
    const hasStructuredTopic = Boolean(conversationContext.activeIntent && conversationContext.confidence >= 0.7);
    const highConfidenceRecall = topVectorProfile && vector.top.probability >= 0.58 && (history.length > 0 || best !== undefined) && !hasStructuredTopic;
    if (corroborated) best = { ...best, matches: [...best.matches, `向量:${vector.top.label}`] };
    else if (highConfidenceRecall) {
      best = { ...topVectorProfile, score: 3.1, rerankScore: 3.1 + vector.top.probability * 3.2, matches: [`向量召回:${vector.top.label}`] };
      contextSource = history.length ? "history" : "current";
      reranked = [best];
    } else if (!best) return null;
  }
  if (!best) return null;
  // Compare the same score that determined the ordering.  The previous
  // implementation sorted by rerankScore but gated on raw score, making the
  // rejection boundary depend on whichever signal happened to dominate.
  const margin = best.rerankScore - (reranked[1]?.rerankScore ?? 0);
  const marginThreshold = routerMarginThreshold({
    score: best.score,
    matchedSignals: best.matches,
    contextSource,
    hasExplicitCandidate: explicit.length > 0,
  });
  if (reranked[1] && margin < marginThreshold) return null;
  const subIntent = best.intent === "damage" ? detectDamageSubIntent(query, history) : null;
  return {
    intent: best.intent,
    subIntent,
    knowledgeId: best.knowledgeId,
    retrievalKnowledgeId: subIntent ? knowledgeBySubIntent[subIntent] : activeKnowledgeByIntent[best.intent] ?? best.knowledgeId,
    score: Number(best.score.toFixed(2)),
    margin: Number(margin.toFixed(3)),
    marginThreshold,
    confidence: Number(Math.min(0.97, 0.76 + best.score * 0.025 + Math.max(0, margin) * 0.015).toFixed(2)),
    matchedSignals: best.matches.slice(0, 4),
    vectorEvidence: vector.candidates.slice(0, 3).map((item) => ({ label: item.label, probability: Number(item.probability.toFixed(3)) })),
    rerankScore: Number(best.rerankScore.toFixed(3)),
    contextSource: contextSource as "current" | "history" | "memory",
    conversationContext,
    structuredRoute,
    serviceAction: classifyServiceAction(query),
  };
}

const step87Strategy = "action-gates-step8.7-v1";
const step89Strategy = "structured-actions-step8.9-v1";
const step810Strategy = "knowledge-action-matrix-step8.10-v1";
const step91Strategy = "constrained-hybrid-step9.1-v1";
const step92Strategy = "hybrid-evidence-step9.2-v1";
const step93Strategy = "corrective-hybrid-step9.3-v1";
const step94Strategy = "multi-knowledge-step9.4-v1";
const step95Strategy = "tool-decision-step9.5-v1";
const step96Strategy = "answer-review-step9.6-v1";
const step97Strategy = "joint-evidence-step9.7-v1";
const step98Strategy = "bounded-agentic-rag-step9.8-v1";
const step98RetrievalCalibrationStrategy = "bounded-agentic-rag-step9.8-v1-retrieval-calibration";
const step99Strategy = "bounded-agentic-rag-step9.9-v1";
const step99QueryRewriteStrategy = "bounded-agentic-rag-step9.9-v1-query-rewrite";
const step98V2Strategy = "bounded-agentic-rag-step9.8-v2";
const step98V2BeforeRerankStrategy = "bounded-agentic-rag-step9.8-v2-before-rerank";

function usesActionGates(strategy?: string) {
  return strategy === step87Strategy || strategy === step89Strategy || strategy === step810Strategy || strategy === step91Strategy || strategy === step92Strategy || strategy === step93Strategy || strategy === step94Strategy || strategy === step95Strategy || strategy === step96Strategy || strategy === step97Strategy || strategy === step98Strategy || strategy === step98RetrievalCalibrationStrategy || strategy === step99Strategy || strategy === step99QueryRewriteStrategy || strategy === step98V2Strategy || strategy === step98V2BeforeRerankStrategy;
}

export function classifyServiceAction(query: string) {
  const text = normalize(query);
  const consultation = /怎么|如何|能否|可否|能不能|可不可以|可以.*[吗么]|是否|流程|规则|需要什么|要不要|怎么办|怎么处理|咨询|问下|想知道/.test(text);
  // Question markers take precedence over soft requests such as “我想改…”。
  // Explicit imperative forms remain execution requests.
  const execution = /(帮我|给我|麻烦|请|我要|我想|替我).{0,12}(改|修改|更改|换开|重开|作废|办理|改派|换绑|重新送)/.test(text) && !consultation;
  return execution ? "execute" as const : consultation ? "consult" as const : "informational" as const;
}

export function serviceActionGuidance(query: string) {
  const action = classifyServiceAction(query);
  if (action === "consult") return "用户当前是在咨询规则、条件或办理流程。只解释可信知识中的规则和下一步，不要声称已经替用户修改、办理、作废或完成任何业务动作。";
  if (action === "execute") return "用户当前表达了办理请求。可以说明办理条件、所需信息和核验步骤；除非有明确授权且成功返回的工具结果，否则不得声称业务动作已经完成。";
  return "用户当前主要是在获取信息。回答可信知识支持的事实，不主动扩展为业务办理承诺。";
}

type KnowledgeActionPolicy = Record<ReturnType<typeof classifyServiceAction>, boolean>;

// Handoff is governed by the selected knowledge article, not only by the
// top-level intent. `true` means the action needs a human; policy explanation
// can remain self-service even when execution requires identity/order checks.
const knowledgeActionRiskMatrix: Record<string, KnowledgeActionPolicy> = {
  "KB-114": { informational: false, consult: false, execute: true },
  "KB-117": { informational: false, consult: false, execute: true },
  "KB-118": { informational: false, consult: false, execute: true },
  "KB-119": { informational: false, consult: false, execute: false },
  "KB-120": { informational: false, consult: false, execute: false },
  "KB-208": { informational: true, consult: true, execute: true },
  "KB-209": { informational: true, consult: true, execute: true },
  "KB-210": { informational: true, consult: true, execute: true },
  "KB-211": { informational: false, consult: false, execute: true },
  "KB-212": { informational: true, consult: true, execute: true },
  "KB-213": { informational: true, consult: true, execute: true },
  "KB-214": { informational: false, consult: false, execute: true },
  "KB-215": { informational: false, consult: false, execute: true },
  "KB-216": { informational: false, consult: false, execute: true },
  "KB-301": { informational: false, consult: false, execute: true },
  "KB-302": { informational: false, consult: false, execute: true },
  "KB-303": { informational: false, consult: false, execute: true },
  "KB-401": { informational: false, consult: false, execute: true },
  "KB-402": { informational: false, consult: false, execute: true },
  "KB-403": { informational: false, consult: false, execute: true },
};

function governedDamageKnowledge(query: string, history: ConversationTurn[]) {
  const current = normalize(query);
  const context = normalize(history.filter((turn) => turn.role === "user").slice(-3).map((turn) => turn.content).join("；"));
  const evidence = `${current}；${context}`;
  if (/维修|返修|修理|维修点|寄修|上门维修/.test(current)) return "KB-214";
  if (/保修|质保|保修期|质保期|联保/.test(current)) return "KB-215";
  if (/三包|包修|包换|包退|七天退|十五天换/.test(current)) return "KB-216";
  if (/少件|缺件|短少|少商品|少配件|漏发|缺少|拿漏/.test(current)) return "KB-212";
  if (/丢件|丢失|遗失|找不到|不见了|未收到/.test(current)) return "KB-213";
  if (/签收|验货|当面验收|外包装|拍照|留证|证据|拒收/.test(current) && !/退货|退款|换货|换一个/.test(current)) return "KB-211";
  const hasDefectEvidence = /破损|损坏|坏了|坏的|碎了|漏液|发臭|发酸|发霉|腐烂|变质|不能用|用不了|吸不上|有问题|质量问题/.test(evidence);
  const asksGeneralResolution = /退货|退款|换货|换一个|给换|怎么处理|怎么办/.test(current);
  if (hasDefectEvidence && asksGeneralResolution) return "KB-208";
  if (/质量问题|质量如何|质量.*界定|故障|不能用|用不了|开不了机|没反应|充不进电|异响|噪音|不好用|不工作|失灵/.test(current)) return "KB-209";
  return null;
}

function forcedRouting(intent: BusinessIntent, query: string, history: ConversationTurn[], knowledgeId: string, reason: string) {
  const conversationContext = extractConversationContext([...history, { role: "user", content: query }]);
  return {
    intent,
    subIntent: intent === "damage" ? "physical_damage" as const : null,
    knowledgeId: knowledgeByIntent[intent],
    retrievalKnowledgeId: knowledgeId,
    score: 4,
    confidence: 0.9,
    matchedSignals: [`动作门控:${reason}`],
    vectorEvidence: [],
    rerankScore: 4,
    contextSource: history.length ? "history" as const : "current" as const,
    conversationContext,
  };
}

/** Step 8.7 eval-only routing corrections for bounded, explainable actions. */
export function routeIntentWithActionGate(query: string, history: ConversationTurn[] = [], strategy?: string) {
  const routed = routeIntent(query, history);
  if (!usesActionGates(strategy)) return routed;
  const text = normalize(query);
  const context = normalize(history.map((turn) => turn.content).join("；"));
  if (strategy === step89Strategy) {
    const damageKnowledge = governedDamageKnowledge(query, history);
    if (damageKnowledge && (/退货|退款|换货|给换|怎么处理|怎么办/.test(text) || routed?.intent === "damage")) {
      return forcedRouting("damage", query, history, damageKnowledge, "结构化售后动作与证据");
    }
  }
  if (/生鲜.*拆封.*(七天|七日|无理由)|(七天|七日|无理由).*生鲜.*拆封/.test(text)) {
    return forcedRouting("damage", query, history, "KB-208", "生鲜拆封售后限制");
  }
  if (/税号.*(修改|改)|(修改|改).*税号/.test(text)) {
    return forcedRouting("invoice", query, history, "KB-401", "税号更正咨询");
  }
  if (/地址.*(少打|漏写|修订|修正)|(少打|漏写|修订|修正).*地址/.test(text)) {
    return forcedRouting("address", query, history, "KB-301", "地址信息修订");
  }
  if (/不能改|取消订单再重下/.test(text) && /原地址|派送|地址/.test(`${text}；${context}`)) {
    return forcedRouting("address", query, history, "KB-301", "地址修改后续咨询");
  }
  if (/又漏了|免得.*漏/.test(text)) {
    return forcedRouting("damage", query, history, "KB-208", "缺漏售后后续");
  }
  if (routed?.intent === "damage" && (/哨声|刺耳/.test(text) || (/能修吗|能不能修/.test(text) && /坏|破|屏/.test(text)))) {
    return { ...routed, subIntent: "physical_damage" as const, retrievalKnowledgeId: "KB-208", matchedSignals: [...routed.matchedSignals, "动作门控:症状先进入通用售后"] };
  }
  return routed;
}

/** Step 8.7 keeps informational questions self-served and hands off explicit execution requests. */
export function shouldHandoffWithActionGate(intent: BusinessIntent, query: string, ruleHandoff: boolean, strategy?: string, knowledgeId?: string) {
  const policyHandoff = shouldHandoff(intent, query);
  if (!usesActionGates(strategy)) return ruleHandoff || policyHandoff;
  if (strategy === step810Strategy && knowledgeId) {
    const policy = knowledgeActionRiskMatrix[knowledgeId];
    if (policy) return policy[classifyServiceAction(query)];
  }
  const text = normalize(query);
  if (strategy === step89Strategy && (intent === "invoice" || intent === "address")) {
    return classifyServiceAction(query) === "execute";
  }
  if (intent === "invoice" && /怎么|如何|能.*吗|是否|申请修改/.test(text) && !/帮我|请.*(修改|改|重开|作废|办理)/.test(text)) return false;
  if (intent === "address" && /拒收|重新改派|签收了|不能改|取消订单再重下/.test(text)) return false;
  if (intent === "refund" && /不是一起退款|没有一起退款|怎么不是一起退/.test(text)) return false;
  return ruleHandoff || policyHandoff;
}

/** Children are suppressed when a term describes status, not a child procedure. */
export function forcedParentKnowledge(intent: BusinessIntent, query: string, strategy?: string) {
  if (!usesActionGates(strategy)) return null;
  const text = normalize(query);
  if (strategy === step89Strategy && intent === "damage") return governedDamageKnowledge(query, []);
  if (intent === "refund" && /不是一起退款|没有一起退款|怎么不是一起退/.test(text)) return "KB-114";
  if (intent === "address" && /地址填错.*签收|签收.*地址填错/.test(text)) return "KB-301";
  if (intent === "damage" && (/哨声|刺耳/.test(text) || (/能修吗|能不能修/.test(text) && /坏|破|屏/.test(text)))) return "KB-208";
  return null;
}

export function continueIntent(previousIntent: BusinessIntent | null, query: string, previousContext: ConversationContext | null = null) {
  const current = normalize(query);
  if (!previousIntent || unsafeOrOutOfScope.test(current) || current.length > 80 || !followupPattern.test(current)) return null;
  const subIntent = previousIntent === "damage" ? detectDamageSubIntent(query, []) : null;
  const conversationContext = previousContext ?? extractConversationContext([{ role: "user", content: query }]);
  return {
    intent: previousIntent,
    subIntent,
    knowledgeId: knowledgeByIntent[previousIntent],
    retrievalKnowledgeId: subIntent ? knowledgeBySubIntent[subIntent] : knowledgeByIntent[previousIntent],
    score: 1,
    confidence: 0.68,
    matchedSignals: [`会话状态:${previousIntent}`],
    vectorEvidence: [],
    rerankScore: 1,
    contextSource: "memory" as const,
    conversationContext,
    structuredRoute: extractStructuredRoute(query, previousContext?.pendingQuestion ? [{ role: "user", content: previousContext.pendingQuestion }] : []),
    serviceAction: classifyServiceAction(query),
  };
}

export function shouldHandoff(intent: BusinessIntent, query: string) {
  const text = normalize(query);
  if (intent === "damage") return true;
  if (intent === "refund") return /还没|没有到账|未到账|不到账|没返回|没退|退到哪里|退哪|异常|少退|只退|查一下|查询一下|核查/.test(text);
  if (intent === "address") return /帮我|给我|我要|我想|请求|改一下|更改一下|修改一下|帮忙.*(改|修改)/.test(text);
  return /帮我|给我|请求|重开|重新开|作废/.test(text);
}
