import crypto from "node:crypto";
import fs from "node:fs/promises";

const sourceFiles = ["data/eval-csds-full-test.json", "data/eval-csds-full-val.json"];
const excludedFiles = [
  "data/eval-csds-holdout2-100.json",
  "data/eval-csds-generalization-100.json",
  "data/eval-csds-holdout3-100.json",
];
const outputPath = "data/eval-phase1-v2-additional.json";

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function tagQuery(query) {
  const tags = [];
  if (/退款|退货|退钱|返款|到账/.test(query)) tags.push("refund");
  if (/破损|质量|坏|维修|保修|三包|缺件|丢件/.test(query)) tags.push("damage");
  if (/地址|收货|收件|手机号|电话|物流/.test(query)) tags.push("address");
  if (/发票|开票|税号|抬头/.test(query)) tags.push("invoice");
  if (/[；;].*(退款|发票|地址|破损|维修|物流)/.test(query)) tags.push("multi-intent");
  if (/^(那|这个|它|这样|好的|怎么办|可以吗|能吗|怎么|哪里|多久)/.test(query)) tags.push("ambiguous-wording");
  if (/[\u4e00-\u9fff]{2,}/.test(query)) tags.push("semantic-paraphrase");
  if (/退款|发票|地址|破损|物流|税号|维修/.test(query)) tags.push("keyword-exact-match");
  return [...new Set(tags)];
}

const noAnswerCases = [
  "请问你们能帮我查一下附近电影院今天的排片吗？",
  "帮我规划一下下周去杭州的旅游路线。",
  "你知道现在黄金价格是多少吗？",
  "请推荐一款适合跑步的耳机。",
  "能帮我解释一下这段股票行情吗？",
  "我想咨询家附近的天气和空气质量。",
  "请问你们支持办理手机卡和套餐吗？",
  "帮我把这段英文翻译成中文。",
  "你能帮我写一份求职自我介绍吗？",
  "请告诉我今天晚上有什么电影上映。",
].map((query, index) => ({
  id: `phase1-v2-no-answer-${String(index + 1).padStart(3, "0")}`,
  category: "no-answer",
  query,
  history: [],
  contextRequired: false,
  expectedSource: null,
  expectedHandoff: false,
  source: { dataset: "ServicePilot phase1 new no-answer supplement", split: "new", dialogueId: `no-answer-${index + 1}`, originalIntent: "out-of-scope", questionUtteranceIds: [], form: "new-evaluation-query" },
  transformations: [],
  evaluationTags: ["no-answer", "wrong-route-recovery"],
  sourceRole: "new-generalization-supplement",
}));

async function main() {
  const source = (await Promise.all(sourceFiles.map((file) => fs.readFile(file, "utf8").then(JSON.parse)))).flatMap((payload) => payload.cases);
  const excluded = (await Promise.all(excludedFiles.map((file) => fs.readFile(file, "utf8").then(JSON.parse)))).flatMap((payload) => payload.cases);
  const excludedDialogueIds = new Set(excluded.map((item) => item.source?.dialogueId).filter((id) => id !== undefined));
  const excludedIds = new Set(excluded.map((item) => item.id));
  const deduped = [...new Map(source.filter((item) => !excludedIds.has(item.id) && !excludedDialogueIds.has(item.source?.dialogueId)).map((item) => [item.source?.dialogueId ?? item.id, item])).values()];
  const quotas = { "real-refund": 25, "real-invoice": 25, "real-address": 25, "real-damage": 25 };
  const cases = [];
  for (const [category, quota] of Object.entries(quotas)) {
    const selected = deduped.filter((item) => item.category === category).sort((left, right) => digest(`phase1-v2-additional:${left.id}`).localeCompare(digest(`phase1-v2-additional:${right.id}`))).slice(0, quota);
    if (selected.length < quota) throw new Error(`INSUFFICIENT_CASES:${category}:${selected.length}/${quota}`);
    cases.push(...selected.map((item) => ({ ...item, evaluationTags: tagQuery(item.query), sourceRole: "new-generalization-candidate" })));
  }
  const dialogueIds = cases.map((item) => item.source?.dialogueId).filter((id) => id !== undefined);
  const expandedCases = [...cases.map((item) => ({ ...item, evaluationTags: [...new Set([...item.evaluationTags, ...(item.expectedSource && ["KB-114", "KB-301", "KB-401", "KB-208"].includes(item.expectedSource) ? ["parent-child-competition"] : [])])] })), ...noAnswerCases];
  const report = {
    version: "phase1-v2-additional-evaluation-110",
    description: "Phase 1.1新增泛化集候选；来自CSDS test/val，排除当前冻结集 holdout2/generalization/holdout3 的 DialogueID，不修改既有冻结集。",
    sampling: { method: "deterministic-sha256-dialogue-deduped-plus-new-no-answer-supplement", sourceFiles, excludedFiles, quotas, total: expandedCases.length, uniqueDialogueIds: new Set([...dialogueIds, ...noAnswerCases.map((item) => item.source.dialogueId)]).size, contextRequired: expandedCases.filter((item) => item.contextRequired).length },
    freeze: { locked: true, casesSha256: digest(JSON.stringify(expandedCases)) },
    coverageTags: Object.fromEntries(["refund", "damage", "address", "invoice", "multi-intent", "ambiguous-wording", "keyword-exact-match", "semantic-paraphrase", "parent-child-competition", "wrong-route-recovery", "no-answer"].map((tag) => [tag, expandedCases.filter((item) => item.evaluationTags.includes(tag)).length])),
    cases: expandedCases,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath, version: report.version, total: expandedCases.length, uniqueDialogueIds: report.sampling.uniqueDialogueIds, coverageTags: report.coverageTags, sha256: report.freeze.casesSha256 }, null, 2)}\n`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
