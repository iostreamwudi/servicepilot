import crypto from "node:crypto";
import fs from "node:fs/promises";

const root = new URL("..", import.meta.url);
const readJson = async (relativePath) => JSON.parse(await fs.readFile(new URL(relativePath, root), "utf8"));

const parentByChild = {
  "KB-117": "KB-114", "KB-118": "KB-114", "KB-119": "KB-114", "KB-120": "KB-114",
  "KB-209": "KB-208", "KB-210": "KB-208", "KB-211": "KB-208", "KB-212": "KB-208",
  "KB-213": "KB-208", "KB-214": "KB-208", "KB-215": "KB-208", "KB-216": "KB-208",
  "KB-302": "KB-301", "KB-303": "KB-301", "KB-304": "KB-301",
  "KB-402": "KB-401", "KB-403": "KB-401", "KB-404": "KB-401", "KB-405": "KB-401",
};

const childLabels = {
  "KB-117": "退款商品完好/拆封",
  "KB-118": "退货赠品与组合商品",
  "KB-119": "退货运费",
  "KB-120": "退款法定节点",
  "KB-209": "商品质量与故障",
  "KB-210": "快件破损与运输赔付",
  "KB-211": "签收验货与留证",
  "KB-212": "缺件与配件短少",
  "KB-213": "丢件与未收到",
  "KB-214": "维修与寄修",
  "KB-215": "保修与质保",
  "KB-216": "三包责任",
  "KB-302": "收件人/手机号信息",
  "KB-303": "无法投递/拒收退回",
  "KB-304": "物流查询与延误",
  "KB-402": "发票抬头/税号更正",
  "KB-403": "发票红冲",
  "KB-404": "退货/退款发票",
  "KB-405": "发票下载/查验",
};

function parentOf(id) {
  return parentByChild[id] ?? id;
}

function relationOf(expected, candidate) {
  if (!candidate) return "unknown";
  if (candidate === expected) return "exact-primary";
  if (parentByChild[candidate] === expected) return "child-of-primary";
  if (parentByChild[expected] === candidate) return "parent-of-primary";
  if (parentOf(candidate) === parentOf(expected)) return "sibling-in-primary-family";
  return "other-or-unrelated";
}

function sourceFingerprint(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function rankOf(list, id) {
  const index = Array.isArray(list) ? list.indexOf(id) : -1;
  return index < 0 ? null : index + 1;
}

function acceptedByLegacyLabel(expected, candidate, query) {
  if (expected === candidate) return true;
  const terms = {
    "KB-114": { "KB-117": /拆封|包装|说明书|商品完好|二次销售|试用/, "KB-118": /赠品|组合商品|一起退|配件/, "KB-119": /运费|邮费|谁承担/, "KB-120": /退款期限|退回商品|收到退货|退货退款法定/ },
    "KB-208": { "KB-209": /质量|故障|不能用|用不了|不合格|瑕疵|描述不一致/, "KB-210": /快递破损|丢件|少件|内件短少|保价|赔偿/, "KB-211": /签收|验货|当面验收|外包装|拍照|留证|证据|拒收/, "KB-212": /少件|缺件|短少|少商品|少配件|漏发|缺少/, "KB-213": /丢件|丢失|遗失|找不到|不见了|未收到/, "KB-214": /维修|返修|修理|维修点|寄修|上门维修/, "KB-215": /保修|质保|保修期|质保期|联保|凭证/, "KB-216": /三包|包修|包换|包退|七天退|十五天换/ },
    "KB-301": { "KB-302": /手机号|电话|收件人|姓名|联系人/, "KB-303": /无法投递|拒收|拦截|退回|派送失败|联系不上/, "KB-304": /物流查询|快递客服|处理时限|延误|投诉/ },
    "KB-401": { "KB-402": /抬头|税号|公司名称|开错|修改发票|重开/, "KB-403": /红冲|红字发票|入账确认|用途确认/, "KB-404": /退货发票|退款发票|销售折让|服务中止|退货后发票/, "KB-405": /查发票|下载发票|打印发票|发票查验/ },
  };
  return Boolean(terms[expected]?.[candidate]?.test(query ?? ""));
}

function reasonForCandidate(expected, candidate, query) {
  const relation = relationOf(expected, candidate);
  if (relation === "exact-primary") return "原 expectedSource，继承 primary grade=3；仍需确认该 query 下是否为主证据。";
  if (relation === "child-of-primary") return `候选为父知识的子知识（${childLabels[candidate] ?? "未命名子知识"}）；不得自动赋 grade，需判断是否直接回答、仅补充或条件冲突。`;
  if (relation === "parent-of-primary") return "候选为 primary 的父知识；需判断是否覆盖当前问题，不能因层级关系自动视为相关。";
  if (relation === "sibling-in-primary-family") return "候选为同一父知识族的兄弟知识；需按问题条件判断是相关、部分相关还是条件冲突。";
  if (acceptedByLegacyLabel(expected, candidate, query)) return "旧单标签规则可能接受的子知识；本阶段不把旧规则自动迁移为 grade=2。";
  return "程序仅因阶段候选出现而加入审核队列；没有自动相关性结论。";
}

function candidateEntry({ id, expected, query, stages, documentById }) {
  const document = documentById.get(id);
  return {
    knowledgeId: id,
    title: document?.title ?? null,
    category: document?.category ?? null,
    parentKnowledgeId: parentByChild[id] ?? null,
    relationToPrimary: relationOf(expected, id),
    stageRanks: {
      v1: rankOf(stages.v1, id),
      bm25: rankOf(stages.bm25, id),
      dense: rankOf(stages.dense, id),
      hybridRrfBeforeRerank: rankOf(stages.hybrid, id),
      reranked: rankOf(stages.reranked, id),
    },
    proposedGrade: null,
    humanReviewed: false,
    rationale: reasonForCandidate(expected, id, query),
  };
}

function makeRecord({ source, item, record, documentById, roleReasons }) {
  const expected = record.expected ?? item?.expectedSource ?? null;
  const stages = {
    v1: record.v1 ?? [],
    bm25: record.bm25 ?? [],
    dense: record.dense ?? [],
    hybrid: record.hybrid ?? [],
    reranked: record.reranked ?? [],
  };
  const candidateIds = unique(Object.values(stages).flat()).slice(0, 25);
  const roles = unique(roleReasons);
  return {
    id: record.id ?? item?.id,
    query: record.query ?? item?.query ?? "",
    history: item?.history ?? [],
    expectedSource: expected,
    primaryKnowledgeId: expected,
    relevantKnowledgeIds: [expected],
    relevanceGrades: expected ? { [expected]: 3 } : {},
    labelRationale: expected
      ? `primaryKnowledgeId 继承原 expectedSource=${expected}，原单标签主来源默认 grade=3；其他知识未自动赋 grade，等待人工复核。`
      : "原样本没有 expectedSource，必须先完成人工标注后才能进入 frozen Golden Set。",
    labelStatus: "inherited-primary-pending-human-review",
    humanReviewed: false,
    frozen: false,
    reviewPriority: roles.length ? roles : ["random-control"],
    source: {
      evalArtifact: source,
      sourceRecordId: record.id ?? item?.id,
      originalExpectedSource: expected,
      stages,
      rerankFallback: record.rerankFallback ?? null,
      rerankProvider: record.rerankProvider ?? null,
    },
    candidateReviewQueue: candidateIds.map((id) => candidateEntry({ id, expected, query: record.query ?? item?.query, stages, documentById })),
  };
}

function addRole(roleMap, id, reason) {
  const list = roleMap.get(id) ?? [];
  list.push(reason);
  roleMap.set(id, list);
}

const [knowledge, additional, holdout3, realHoldout3, realAdditional] = await Promise.all([
  readJson("data/knowledge-seed.json"),
  readJson("data/eval-phase1-v2-additional.json"),
  readJson("data/eval-csds-holdout3-100.json"),
  readJson("Optimization_process/phase1.1-real-retrieval-eval.json"),
  readJson("Optimization_process/phase1.1-real-retrieval-eval-additional.json"),
]);

const documentById = new Map((knowledge.documents ?? []).map((document) => [document.id, document]));
const itemById = new Map([...additional.cases, ...holdout3.cases].map((item) => [item.id, item]));
const roleMap = new Map();
const allSourceRecords = [
  { name: "phase1.1-real-retrieval-eval.json", payload: realHoldout3 },
  { name: "phase1.1-real-retrieval-eval-additional.json", payload: realAdditional },
];

// Frozen in the Phase 1.2 report from the original single-expectedSource comparison.
// Keep these IDs even when the hierarchy-aware legacy matcher would later accept a child;
// the review queue must cover the original reported hit-to-miss set before labels migrate.
const reportedRecallAt5HitToMiss = new Set([
  "csds-train-refund-2898-0", "csds-train-refund-10471-0", "csds-train-refund-6188-0", "csds-train-refund-2268-0",
  "csds-train-damage-2866-0", "csds-train-damage-10646-0", "csds-train-damage-8418-2", "csds-train-damage-4371-1",
  "csds-train-damage-2421-1", "csds-train-damage-1661-0", "csds-train-damage-4404-0", "csds-train-damage-858-0",
  "csds-test-refund-4017-0", "csds-val-refund-3672-1", "csds-test-refund-2346-0", "csds-val-damage-4504-2",
  "csds-val-damage-4510-0", "csds-test-damage-318-0", "csds-test-damage-6895-0", "csds-val-damage-2106-0",
]);

for (const { payload } of allSourceRecords) {
  const degraded = new Set(payload.reranker?.top1DegradedCases ?? []);
  for (const record of payload.records ?? []) {
    if (degraded.has(record.id)) addRole(roleMap, record.id, "phase1.2-top1-degraded");
    if (reportedRecallAt5HitToMiss.has(record.id)) addRole(roleMap, record.id, "recall@5-hit-to-miss");
    const hybridHit = (record.hybrid ?? []).slice(0, 5).some((id) => acceptedByLegacyLabel(record.expected, id, record.query));
    const rerankHit = (record.reranked ?? []).slice(0, 5).some((id) => acceptedByLegacyLabel(record.expected, id, record.query));
    if (hybridHit && !rerankHit) addRole(roleMap, record.id, "recall@5-hit-to-miss");
    if (acceptedByLegacyLabel(record.expected, record.hybrid?.[0], record.query) && !acceptedByLegacyLabel(record.expected, record.reranked?.[0], record.query)) addRole(roleMap, record.id, "rrf-top1-correct-reranker-top1-wrong");
    const parentChildPresent = [...new Set([...(record.hybrid ?? []).slice(0, 10), ...(record.reranked ?? []).slice(0, 10)])].some((id) => relationOf(record.expected, id) === "child-of-primary" || relationOf(record.expected, id) === "sibling-in-primary-family");
    if (parentChildPresent) addRole(roleMap, record.id, "parent-child-or-sibling-competition");
  }
}

// Include every Phase 1.2 answerable-but-unrouted sample as a review item even though it has no retrieval-stage candidate list.
const unroutedIds = new Set([
  "csds-val-refund-7425-0", "csds-val-refund-4514-0", "csds-val-refund-734-0", "csds-test-invoice-7175-1",
  "csds-val-address-5077-0", "csds-val-address-4903-0", "csds-val-address-2001-0", "csds-test-damage-6176-1",
  "csds-val-damage-2353-0", "csds-val-damage-3634-0", "csds-test-damage-7080-0", "csds-test-damage-5085-0",
  "csds-val-damage-2077-0", "csds-val-damage-5720-0", "csds-val-damage-7004-0",
]);
for (const id of unroutedIds) addRole(roleMap, id, "phase1.2-router-answerable-unrouted");

// Deterministic controls are selected from routed samples not already in the failure queue.
const allRecords = allSourceRecords.flatMap(({ name, payload }) => (payload.records ?? []).map((record) => ({ name, payload, record })));
const controls = allRecords.filter(({ record }) => !roleMap.has(record.id)).sort((left, right) => left.record.id.localeCompare(right.record.id)).slice(0, 20);
for (const { record } of controls) addRole(roleMap, record.id, "random-normal-control");

const byId = new Map(allRecords.map((entry) => [entry.record.id, entry]));
const records = [...roleMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, reasons]) => {
  const entry = byId.get(id);
  if (entry) return makeRecord({ source: entry.name, item: itemById.get(id), record: entry.record, documentById, roleReasons: reasons });
  const item = itemById.get(id);
  return {
    id,
    query: item?.query ?? "",
    history: item?.history ?? [],
    expectedSource: item?.expectedSource ?? null,
    primaryKnowledgeId: item?.expectedSource ?? null,
    relevantKnowledgeIds: item?.expectedSource ? [item.expectedSource] : [],
    relevanceGrades: item?.expectedSource ? { [item.expectedSource]: 3 } : {},
    labelRationale: `Phase 1.2 answerable-but-unrouted样本；primaryKnowledgeId 继承原 expectedSource=${item?.expectedSource ?? "null"}，无候选知识自动赋 grade。`,
    labelStatus: "inherited-primary-pending-human-review",
    humanReviewed: false,
    frozen: false,
    reviewPriority: unique(reasons),
    source: { evalArtifact: "data/eval-phase1-v2-additional.json", sourceRecordId: id, stages: null, routerResult: null },
    candidateReviewQueue: [],
  };
});

const reviewCandidates = records.flatMap((record) => record.candidateReviewQueue.map((candidate) => ({
  evaluationCaseId: record.id,
  query: record.query,
  expectedSource: record.expectedSource,
  primaryKnowledgeId: record.primaryKnowledgeId,
  ...candidate,
  proposedGrade: null,
  humanReviewed: false,
})));

const output = {
  schemaVersion: "phase1.3a-graded-golden-v2",
  status: "draft-pending-human-review",
  frozen: false,
  freezePolicy: "Only records with humanReviewed=true and explicit reviewer/reviewedAt may enter a frozen Golden Set. This draft is not frozen.",
  sourceSets: [
    "Optimization_process/phase1.1-real-retrieval-eval.json",
    "Optimization_process/phase1.1-real-retrieval-eval-additional.json",
    "data/eval-phase1-v2-additional.json",
  ],
  compatibility: { expectedSourcePreserved: true, primaryDefaultsToExpectedSource: true, inheritedPrimaryGrade: 3, otherGradesAutoAssigned: false },
  gradeDefinitions: { "3": "Highly Relevant", "2": "Relevant", "1": "Partially Relevant", "0": "Irrelevant" },
  counts: {
    totalRecords: records.length,
    humanConfirmedRecords: records.filter((record) => record.humanReviewed).length,
    pendingRecords: records.filter((record) => !record.humanReviewed).length,
    reviewCandidates: reviewCandidates.length,
    sourceTop1DegradedAndLossCoverage: records.filter((record) => record.reviewPriority.some((reason) => reason.includes("degraded") || reason.includes("hit-to-miss"))).length,
  },
  casesSha256: sourceFingerprint(records),
  cases: records,
};

const queue = {
  schemaVersion: "phase1.3a-graded-review-queue-v1",
  status: "pending-human-review",
  gradePolicy: "proposedGrade must remain null until a human reviewer assigns and records rationale.",
  counts: { cases: records.length, candidates: reviewCandidates.length, humanConfirmed: 0, pending: reviewCandidates.length },
  candidates: reviewCandidates,
};

await fs.writeFile(new URL("data/graded-golden-set-v2.json", root), `${JSON.stringify(output, null, 2)}\n`);
await fs.writeFile(new URL("data/graded-golden-set-v2-review-queue.json", root), `${JSON.stringify(queue, null, 2)}\n`);
console.log(JSON.stringify({ set: output.counts, queue: queue.counts }, null, 2));
