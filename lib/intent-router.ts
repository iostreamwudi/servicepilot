import { classifyIntentVector } from "./intent-classifier.ts";

export type BusinessIntent = "refund" | "damage" | "address" | "invoice";
export type ServiceSubIntent = "physical_damage" | "quality_issue" | "missing_item" | "lost_parcel" | "repair" | "warranty" | "three_guarantees";
export type ConversationTurn = { role: "user" | "assistant"; content: string };

type IntentProfile = {
  intent: BusinessIntent;
  knowledgeId: string;
  strongPatterns: RegExp[];
  supportingPatterns: RegExp[];
  contextualPatterns: RegExp[];
};

const profiles: IntentProfile[] = [
  {
    intent: "refund", knowledgeId: "KB-114",
    // “退货/取消订单/价保退差价”是独立售后流程，不能仅因包含“退”
    // 就误路由到资金退款。这里仅准入退款去向、到账与退款状态。
    strongPatterns: [/退款|退钱|返款|反款|原路退|极速退款/, /款.*(没到|未到|不到账|退到)|钱.*没(到|来|返回|退)|多久到账|到帐|退.*运费|退.*(白条|银行卡|微信|支付宝|余额)/],
    supportingPatterns: [/返还|退回|审核|工作日|支付方式|银行卡|白条|微信|余额/],
    contextualPatterns: [/退(到|回|给|了|吗|呢|哪|哪儿|哪里|多久|费)|回款|退费|返到|返款|到帐|到账|货款|款项|款退|款还|少退|全款|原支付账户|支付账户|银行卡.*(退|返)|微信.*(退|返)|余额.*(退|返)|白条.*(退|返)/],
  },
  {
    intent: "damage", knowledgeId: "KB-208",
    strongPatterns: [/破损|损坏|坏了|烂了|烂的|质量问题|少件|缺件|少了|少商品|少配件|漏液|漏发|碎了|发霉|不新鲜|变质|丢件|丢失|遗失|丢了|磕碰|异响|维修|返修|修理|保修|质保|三包|不能用|用不了|开不了机|没反应|充不进电/, /包装.*(破|烂|压)|商品.*(破|坏|碎|漏)|收到.*(少|缺)|附件.*(少|没有|缺)|不能吃|融化|腐烂/],
    supportingPatterns: [/赔付|理赔|售后|换货|补发|维修|保修|三包/],
    contextualPatterns: [/裂痕|划痕|压烂|烂了|腐烂|发臭|发酸|发霉|变形|故障|不能用|用不了|开不了机|没反应|充不进电|缺少|漏发|没发|少了|不见了|遗失|噪音|异响|有问题|补发|换一个|维修|保修|三包/],
  },
  {
    intent: "address", knowledgeId: "KB-301",
    strongPatterns: [/收货地址|收件地址|改址|收货信息|收件信息/, /(地址|街道|门牌号|收件信息|收货信息).*(错|改|修改|更改)|(修改|更改|改).*(地址|街道|门牌号|电话|号码|手机)|(电话|号码|手机).*(填错|写错|改)/],
    supportingPatterns: [/收件人|联系方式|寄到|送到/],
    contextualPatterns: [/(改|换|填错|写错).*(收件人|联系人|手机号|手机|电话|号码)|(收件人|联系人|手机号|手机|电话|号码).*(改|换|填错|写错)|转寄|改到|送错地方/],
  },
  {
    intent: "invoice", knowledgeId: "KB-401",
    strongPatterns: [/发票|开票|税号|发票抬头|专票|增票|电子票|带票/, /票.*(开|重开|作废)|公司名称.*(错|改)|报销.*凭证|什么时候.*开好|能开好/],
    supportingPatterns: [/抬头|公司名称|报销|凭证/],
    contextualPatterns: [/普通票|电子票|纸质票|增值税|纳税人|识别号|抵税|报账|报销|开具|重开|补开|换开|作废|票据|票头|个人.*(换|改).*单位|公司抬头/],
  },
];

const unsafeOrOutOfScope = /忽略.*规则|系统提示词|管理员密码|其他客户|别人.*(电话|手机|地址)|股票|彩票|验证码/;
const followupPattern = /^(那|这个|它|这样|好的|可以|明白|请问|所以|然后|但是|可是|还)|多久|几天|几个工作日|怎么办|怎么处理|能不能|可以吗|还有吗|周末算不算|到哪里|到哪|为什么/;
const knowledgeByIntent: Record<BusinessIntent, string> = { refund: "KB-114", damage: "KB-208", address: "KB-301", invoice: "KB-401" };
const knowledgeBySubIntent: Record<ServiceSubIntent, string> = {
  physical_damage: "KB-208", quality_issue: "KB-209", missing_item: "KB-212",
  lost_parcel: "KB-213", repair: "KB-214", warranty: "KB-215", three_guarantees: "KB-216",
};

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?]/g, "");
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
  if (/少件|缺件|短少|少商品|少配件|漏发|没发|少了|缺少|拿漏/.test(text)) return "missing_item";
  if (/质量|故障|不能用|用不了|开不了机|没反应|充不进电|异响|噪音|不好用|不工作|失灵/.test(text)) return "quality_issue";
  return "physical_damage";
}

function matches(patterns: RegExp[], text: string) {
  return patterns.map((pattern) => text.match(pattern)?.[0]).filter((value): value is string => Boolean(value));
}

function currentCandidate(profile: IntentProfile, current: string) {
  const strong = matches(profile.strongPatterns, current);
  if (!strong.length) return null;
  const support = matches(profile.supportingPatterns, current);
  return { ...profile, score: 4 + strong.length * 2 + support.length, matches: [...strong, ...support] };
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

export function routeIntent(query: string, history: ConversationTurn[] = []) {
  const current = normalize(query);
  if (unsafeOrOutOfScope.test(current)) return null;

  const explicit = profiles.map((profile) => currentCandidate(profile, current)).filter((item) => item !== null).sort((a, b) => b.score - a.score);
  let ranked = explicit.length ? explicit : profiles.map((profile) => contextualCandidate(profile, current)).filter((item) => item !== null).sort((a, b) => b.score - a.score);
  let contextSource: "current" | "history" = "current";

  // Historical evidence is eligible only for a real follow-up. This reject
  // gate is the main protection against unsupported-intent false positives.
  if (!ranked.length && current.length <= 80 && followupPattern.test(current)) {
    ranked = profiles.map((profile) => historyCandidate(profile, history)).filter((item) => item !== null).sort((a, b) => b.score - a.score);
    contextSource = "history";
  }

  // For elliptical customer-service turns, the latest four turns form a
  // bounded topic window. We accept it only when no current intent competes.
  if (!ranked.length && current.length <= 120 && history.length) {
    ranked = profiles.map((profile) => conversationCandidate(profile, history)).filter((item) => item !== null).sort((a, b) => b.score - a.score);
    contextSource = "history";
  }

  const vector = classifyIntentVector(query, history);
  const vectorScore = (intent: BusinessIntent) => vector.candidates.find((item) => item.label === intent)?.probability ?? 0;
  let reranked = ranked.map((item) => ({ ...item, rerankScore: item.score + vectorScore(item.intent) * 3.2 }))
    .sort((left, right) => right.rerankScore - left.rerankScore);
  let best = reranked[0];
  const topVectorProfile = vector.top.label === "unsupported" ? null : profiles.find((profile) => profile.intent === vector.top.label) ?? null;
  if (!explicit.length) {
    const corroborated = best && vector.top.label === best.intent && vector.top.probability >= 0.45;
    const highConfidenceRecall = topVectorProfile && vector.top.probability >= 0.58 && (history.length > 0 || best !== undefined);
    if (corroborated) best = { ...best, matches: [...best.matches, `向量:${vector.top.label}`] };
    else if (highConfidenceRecall) {
      best = { ...topVectorProfile, score: 3.1, rerankScore: 3.1 + vector.top.probability * 3.2, matches: [`向量召回:${vector.top.label}`] };
      contextSource = history.length ? "history" : "current";
      reranked = [best];
    } else return null;
  }
  if (!best) return null;
  const margin = best.score - (reranked[1]?.score ?? 0);
  if (reranked[1] && margin < 0.5) return null;
  const subIntent = best.intent === "damage" ? detectDamageSubIntent(query, history) : null;
  return {
    intent: best.intent,
    subIntent,
    knowledgeId: best.knowledgeId,
    retrievalKnowledgeId: subIntent ? knowledgeBySubIntent[subIntent] : best.knowledgeId,
    score: Number(best.score.toFixed(2)),
    confidence: Number(Math.min(0.97, 0.76 + best.score * 0.025 + Math.max(0, margin) * 0.015).toFixed(2)),
    matchedSignals: best.matches.slice(0, 4),
    vectorEvidence: vector.candidates.slice(0, 3).map((item) => ({ label: item.label, probability: Number(item.probability.toFixed(3)) })),
    rerankScore: Number(best.rerankScore.toFixed(3)),
    contextSource,
  };
}

export function continueIntent(previousIntent: BusinessIntent | null, query: string) {
  const current = normalize(query);
  if (!previousIntent || unsafeOrOutOfScope.test(current) || current.length > 80 || !followupPattern.test(current)) return null;
  const subIntent = previousIntent === "damage" ? detectDamageSubIntent(query, []) : null;
  return {
    intent: previousIntent,
    subIntent,
    knowledgeId: knowledgeByIntent[previousIntent],
    retrievalKnowledgeId: subIntent ? knowledgeBySubIntent[subIntent] : knowledgeByIntent[previousIntent],
    score: 1,
    confidence: 0.68,
    matchedSignals: [`会话状态:${previousIntent}`],
    contextSource: "memory" as const,
  };
}

export function shouldHandoff(intent: BusinessIntent, query: string) {
  const text = normalize(query);
  if (intent === "damage") return true;
  if (intent === "refund") return /还没|没有到账|未到账|不到账|没返回|没退|退到哪里|退哪|异常|少退|只退|查一下|查询一下|核查/.test(text);
  if (intent === "address") return /帮我|给我|我要|我想|请求|改一下|更改一下|修改一下|帮忙.*(改|修改)/.test(text);
  return /帮我|给我|请求|重开|重新开|作废/.test(text);
}
