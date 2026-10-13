import type { RetrievalEvidenceCandidate } from "./evidence-sufficiency.ts";
import { sameKnowledgeFamily } from "./retrieval.ts";

export type EvidenceSlot = "condition" | "timing" | "evidence" | "action" | "cost" | "status";

export type ComposableKnowledge = {
  id: string;
  title: string;
  version: string;
  terms: string[];
  answer: string;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
};

export type MultiKnowledgeCandidate = RetrievalEvidenceCandidate & { knowledge: ComposableKnowledge };

const querySlotPatterns: Record<EvidenceSlot, RegExp> = {
  condition: /能不能|可以吗|是否|什么条件|适用|不适用|支持|资格|范围|前提/,
  timing: /多久|几天|何时|什么时候|期限|时效|工作日|小时|当天|次日/,
  evidence: /材料|凭证|证据|照片|面单|外包装|准备什么|提供什么|核验什么/,
  action: /怎么办|怎么处理|如何|流程|步骤|申请|办理|修改|更改|重开|下载|打印|维修|退货|换货|补发/,
  cost: /多少钱|金额|运费|邮费|赔偿|赔付|费用|扣款|谁承担/,
  status: /什么状态|现在状态|已经|尚未|还没|签收|出库|发货|审核|确认|入账|交付/,
};

const knowledgeSlotPatterns: Record<EvidenceSlot, RegExp> = {
  condition: /条件|适用|不适用|范围|资格|前提|判断|应结合|另有约定|需要核验/,
  timing: /工作日|小时|日内|期限|时间|日期|次日|当天|七日|十五天/,
  evidence: /凭证|证据|照片|面单|外包装|核验|订单归属|购买日期|记录/,
  action: /申请|提交|联系|处理|修改|改址|重开|下载|打印|维修|返修|退货|换货|补发|发起|转人工/,
  cost: /金额|运费|邮费|赔偿|赔付|扣款|费用|承担|保价/,
  status: /状态|已出库|未出库|签收|审核|确认|入账|交付|发货|投递/,
};

function slotsFor(value: string, patterns: Record<EvidenceSlot, RegExp>) {
  return (Object.entries(patterns) as Array<[EvidenceSlot, RegExp]>)
    .filter(([, pattern]) => pattern.test(value))
    .map(([slot]) => slot);
}

export function demandedEvidenceSlots(query: string) {
  return slotsFor(query.replace(/\s+/g, ""), querySlotPatterns);
}

export function coveredEvidenceSlots(knowledge: ComposableKnowledge) {
  return slotsFor(`${knowledge.title}；${knowledge.terms.join("、")}；${knowledge.answer}`, knowledgeSlotPatterns);
}

function sourceCompatible(primary: ComposableKnowledge, supplemental: ComposableKnowledge) {
  if (sameKnowledgeFamily(primary.id, supplemental.id)) return true;
  if (primary.sourceUrl && supplemental.sourceUrl && primary.sourceUrl === supplemental.sourceUrl) return true;
  return Boolean(primary.sourceTitle && supplemental.sourceTitle && primary.sourceTitle === supplemental.sourceTitle);
}

function normalizedKnowledgeText(knowledge: ComposableKnowledge) {
  return `${knowledge.title}${knowledge.terms.join("")}${knowledge.answer}`
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, "");
}

function textBigrams(value: string) {
  if (value.length < 2) return new Set(value ? [value] : []);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

function duplicateKnowledge(primary: ComposableKnowledge, supplemental: ComposableKnowledge) {
  const left = normalizedKnowledgeText(primary);
  const right = normalizedKnowledgeText(supplemental);
  if (!left || !right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftBigrams = textBigrams(left);
  const rightBigrams = textBigrams(right);
  const overlap = [...leftBigrams].filter((item) => rightBigrams.has(item)).length;
  return overlap / Math.max(1, Math.min(leftBigrams.size, rightBigrams.size)) >= 0.72;
}

const applicabilityPairs = [
  { positive: /已出库|已经出库|已发货|已经发货/, negative: /未出库|尚未出库|未发货|尚未发货/ },
  { positive: /已签收|已经签收/, negative: /未签收|尚未签收/ },
  { positive: /已确认|已经确认|已入账|已经入账/, negative: /未确认|尚未确认|未入账|尚未入账/ },
] as const;

function contradictsExplicitQueryCondition(query: string, knowledge: ComposableKnowledge) {
  const normalizedQuery = query.replace(/\s+/g, "");
  const normalizedAnswer = `${knowledge.title}；${knowledge.answer}`.replace(/\s+/g, "");
  return applicabilityPairs.some(({ positive, negative }) => {
    const queryPositive = positive.test(normalizedQuery);
    const queryNegative = negative.test(normalizedQuery);
    const answerPositive = positive.test(normalizedAnswer);
    const answerNegative = negative.test(normalizedAnswer);
    if (queryPositive && !queryNegative) return answerNegative && !answerPositive;
    if (queryNegative && !queryPositive) return answerPositive && !answerNegative;
    return false;
  });
}

/**
 * Selects at most one complementary source. All candidates must already come
 * from the same tenant/category/active index cohort; indexVersion is required
 * here so callers cannot accidentally combine an unversioned candidate list.
 */
export function selectComplementaryKnowledge(input: {
  query: string;
  primary: ComposableKnowledge;
  candidates: readonly MultiKnowledgeCandidate[];
  indexVersion: string | null;
}) {
  const demanded = demandedEvidenceSlots(input.query);
  const primaryCovered = coveredEvidenceSlots(input.primary);
  const missing = demanded.filter((slot) => !primaryCovered.includes(slot));
  if (!input.indexVersion) return { selected: [] as ComposableKnowledge[], demanded, primaryCovered, missing, reason: "候选缺少有效索引版本，不组合" };
  if (demanded.length < 2) return { selected: [] as ComposableKnowledge[], demanded, primaryCovered, missing, reason: "用户问题只有一个明确证据需求，保持单知识" };
  if (!missing.length) return { selected: [] as ComposableKnowledge[], demanded, primaryCovered, missing, reason: "主知识已覆盖全部明确证据需求" };

  const ranked = input.candidates
    .filter((candidate) => candidate.id !== input.primary.id)
    .map((candidate) => {
      const covered = coveredEvidenceSlots(candidate.knowledge);
      const gains = missing.filter((slot) => covered.includes(slot));
      const governedSignals = candidate.matchedKeywords.length + Number(candidate.actionMatched);
      return {
        candidate,
        covered,
        gains,
        governedSignals,
        compatible: sourceCompatible(input.primary, candidate.knowledge),
        duplicate: duplicateKnowledge(input.primary, candidate.knowledge),
        conditionConflict: contradictsExplicitQueryCondition(input.query, candidate.knowledge),
      };
    })
    .filter((item) => item.compatible && !item.duplicate && !item.conditionConflict && item.gains.length > 0 && item.governedSignals > 0 && item.candidate.vectorScore > 0)
    .sort((left, right) => right.gains.length - left.gains.length
      || right.governedSignals - left.governedSignals
      || right.candidate.vectorScore - left.candidate.vectorScore
      || right.candidate.fusedScore - left.candidate.fusedScore);
  const best = ranked[0];
  if (!best) return { selected: [] as ComposableKnowledge[], demanded, primaryCovered, missing, reason: "没有兼容且由原问题支持的互补知识" };
  return {
    selected: [best.candidate.knowledge], demanded, primaryCovered, missing,
    reason: `补充 ${best.candidate.id} 覆盖缺口：${best.gains.join("、")}`,
  };
}
