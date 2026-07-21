export type BusinessIntent = "refund" | "damage" | "address" | "invoice";
export type ConversationTurn = { role: "user" | "assistant"; content: string };

type IntentProfile = {
  intent: BusinessIntent;
  knowledgeId: string;
  exactTerms: string[];
  semanticPatterns: RegExp[];
};

const profiles: IntentProfile[] = [
  {
    intent: "refund", knowledgeId: "KB-114",
    exactTerms: ["退款", "退货", "退钱", "返款", "返还", "退回", "退款周期", "极速退款", "原路退", "取消订单"],
    semanticPatterns: [/可以退|能退吗|怎么退|退到哪|款.*没到|钱.*没(到|来|返回)|还没.*(钱|款)|多久到账|退.*运费|退.*差价/],
  },
  {
    intent: "damage", knowledgeId: "KB-208",
    exactTerms: ["破损", "损坏", "坏了", "质量", "生鲜", "赔付", "理赔", "少件", "漏液", "碎了", "发霉", "不新鲜", "变质", "丢件", "丢失", "磕碰", "异响"],
    semanticPatterns: [/包装.*(破|烂|压)|商品.*(破|坏|碎|漏)|收到.*(少|缺)|附件.*(少|没有|缺)|不能吃|化(了|掉)|划痕|挤压|腐烂|哨声|售后.*时效/],
  },
  {
    intent: "address", knowledgeId: "KB-301",
    exactTerms: ["地址", "改址", "收货信息", "收件信息", "收货地址", "联系方式", "收件人"],
    semanticPatterns: [/(地址|收件信息|收货信息).*(错|改|修改|更改)|(修改|更改|改).*(电话|号码|手机)|(电话|号码|手机).*(填错|写错|改)|寄到.*地方|送到.*地方/],
  },
  {
    intent: "invoice", knowledgeId: "KB-401",
    exactTerms: ["发票", "开票", "税号", "抬头", "专票", "增票", "电子票"],
    semanticPatterns: [/发票.*(改|退货|号码|多久)|票.*(开|重开|作废)|公司名称.*(错|改)|报销.*凭证/],
  },
];

const unsafeOrOutOfScope = /忽略.*规则|系统提示词|管理员密码|其他客户|别人.*(电话|手机|地址)|股票|彩票|验证码/;
const followupPattern = /^(那|这个|它|这样|好的|可以|明白|请问|所以|然后)|多久|几个工作日|怎么办|怎么处理|能不能|可以吗|还有吗|周末算不算/;
const knowledgeByIntent: Record<BusinessIntent, string> = { refund: "KB-114", damage: "KB-208", address: "KB-301", invoice: "KB-401" };

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?]/g, "");
}

function scoreProfile(profile: IntentProfile, current: string, history: string) {
  const matches = new Set<string>();
  let score = 0;
  for (const term of profile.exactTerms) {
    if (current.includes(term)) { score += 3; matches.add(term); }
    else if (history.includes(term)) { score += 1.5; matches.add(`上下文:${term}`); }
  }
  for (const pattern of profile.semanticPatterns) {
    const currentMatch = current.match(pattern);
    const historyMatch = history.match(pattern);
    if (currentMatch) { score += 2.5; matches.add(currentMatch[0]); }
    else if (historyMatch) { score += 1.25; matches.add(`上下文:${historyMatch[0]}`); }
  }
  return { score, matches: [...matches] };
}

export function routeIntent(query: string, history: ConversationTurn[] = []) {
  const current = normalize(query);
  const context = normalize(history.map((turn) => turn.content).join("\n"));
  if (unsafeOrOutOfScope.test(current)) return null;
  const ranked = profiles
    .map((profile) => ({ ...profile, ...scoreProfile(profile, current, context) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 1.25) return null;
  const margin = best.score - (ranked[1]?.score ?? 0);
  return {
    intent: best.intent,
    knowledgeId: best.knowledgeId,
    score: Number(best.score.toFixed(2)),
    confidence: Number(Math.min(0.98, 0.66 + best.score * 0.04 + Math.max(0, margin) * 0.02).toFixed(2)),
    matchedSignals: best.matches.slice(0, 4),
    contextSource: best.matches.some((match) => match.startsWith("上下文:")) ? "history" as const : "current" as const,
  };
}

export function continueIntent(previousIntent: BusinessIntent | null, query: string) {
  const current = normalize(query);
  if (!previousIntent || unsafeOrOutOfScope.test(current) || current.length > 60 || !followupPattern.test(current)) return null;
  return {
    intent: previousIntent,
    knowledgeId: knowledgeByIntent[previousIntent],
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
