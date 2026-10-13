export type KnowledgeMatch = {
  passed: boolean;
  relation: "exact" | "accepted-child" | "mismatch";
  reason: string;
};

function normalized(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

/**
 * Evaluations keep the business-level parent as the gold label while allowing
 * a semantically narrower active document when the user explicitly asks for
 * that sub-procedure. This prevents a correct child article from being scored
 * as a retrieval failure, while unrelated children remain failures.
 */
const childRules: Record<string, Array<{ id: string; terms: RegExp; label: string }>> = {
  "KB-114": [
    { id: "KB-117", terms: /拆封|包装|说明书|商品完好|二次销售|试用/, label: "退款商品完好子知识" },
    { id: "KB-118", terms: /赠品|组合商品|一起退|配件/, label: "退货赠品子知识" },
    { id: "KB-119", terms: /运费|邮费|谁承担/, label: "退货运费子知识" },
    { id: "KB-120", terms: /退款期限|退回商品|收到退货|退货退款法定/, label: "退款法定节点子知识" },
  ],
  "KB-208": [
    { id: "KB-209", terms: /质量|故障|不能用|用不了|不合格|瑕疵|描述不一样/, label: "商品质量子知识" },
    { id: "KB-210", terms: /快递破损|丢件|少件|内件短少|保价|赔偿/, label: "快件损毁子知识" },
    { id: "KB-211", terms: /签收|验货|当面验收|外包装|拍照|留证|证据|拒收/, label: "签收验货与留证子知识" },
    { id: "KB-212", terms: /少件|缺件|短少|少商品|少配件|漏发|缺少/, label: "配件短少子知识" },
    { id: "KB-213", terms: /丢件|丢失|遗失|找不到|不见了|未收到/, label: "丢件子知识" },
    { id: "KB-214", terms: /维修|返修|修理|维修点|寄修|上门维修/, label: "维修子知识" },
    { id: "KB-215", terms: /保修|质保|保修期|质保期|联保|凭证/, label: "保修子知识" },
    { id: "KB-216", terms: /三包|包修|包换|包退|七天退|十五天换/, label: "三包子知识" },
  ],
  "KB-301": [
    { id: "KB-302", terms: /手机号|电话|收件人|姓名|联系人/, label: "收件人信息子知识" },
    { id: "KB-303", terms: /无法投递|拒收|拦截|退回|派送失败|联系不上/, label: "无法投递子知识" },
    { id: "KB-304", terms: /物流查询|快递客服|处理时限|延误|投诉/, label: "物流查询子知识" },
  ],
  "KB-401": [
    { id: "KB-402", terms: /抬头|税号|公司名称|开错|修改发票|重开/, label: "发票信息更正子知识" },
    { id: "KB-403", terms: /红冲|红字发票|入账确认|用途确认/, label: "发票红冲子知识" },
    { id: "KB-404", terms: /退货发票|退款发票|销售折让|服务中止|退货后发票/, label: "退货发票子知识" },
    { id: "KB-405", terms: /查发票|下载发票|打印发票|发票查验/, label: "发票查验子知识" },
  ],
};

export function matchKnowledgeSource(expectedSource: string | null, actualSource: string | null, query: string): KnowledgeMatch {
  if (expectedSource === actualSource) return { passed: true, relation: "exact", reason: "命中期望知识" };
  if (!expectedSource || !actualSource) return { passed: false, relation: "mismatch", reason: "知识来源为空或不应命中知识" };
  const text = normalized(query);
  const rule = childRules[expectedSource]?.find((candidate) => candidate.id === actualSource && candidate.terms.test(text));
  if (rule) return { passed: true, relation: "accepted-child", reason: `命中可接受子知识：${rule.label}` };
  return { passed: false, relation: "mismatch", reason: "知识来源不符合预期" };
}

export function knowledgeChildRules() {
  return Object.fromEntries(Object.entries(childRules).map(([parent, rules]) => [parent, rules.map(({ id, label }) => ({ id, label }))]));
}
