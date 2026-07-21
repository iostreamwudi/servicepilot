import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const input = process.argv[2];
const output = process.argv[3] ?? "data/eval-csds-real.json";
const split = process.argv[4] ?? "test";
const perCategory = Number(process.argv[5] ?? (split === "val" ? 10 : split === "train" ? 250 : 25));
if (!input || !Number.isInteger(perCategory) || perCategory < 1) throw new Error("Usage: node scripts/build-csds-eval.mjs <csds.json> [output] [split] [per-category]");

const dialogues = JSON.parse(await readFile(input, "utf8"));
const quotas = { refund: perCategory, invoice: perCategory, address: perCategory, damage: perCategory };
const buckets = { refund: [], invoice: [], address: [], damage: [] };
const explicitSignals = {
  refund: /退款|到账|退回|退钱|返还|退货|钱/,
  invoice: /发票|开票|税号|抬头|专票|增票/,
  address: /地址|收货信息|电话|号码|改址/,
  damage: /破|损|坏|质量|少|漏|化了|碎/,
};

function clean(text) {
  return text
    .replace(/\s+/g, "")
    .replace(/\[\s*USERID[^\]]*\]/gi, "[账号]")
    .replace(/1[3-9]\d{9}/g, "[电话]")
    .replace(/\d{17}[\dXx]/g, "[身份证号]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[邮箱]")
    .replace(/京东/g, "平台")
    .trim();
}

function classify(intent, summary) {
  const signal = `${intent}${summary}`;
  if (/发票|增票/.test(signal)) return "invoice";
  if (/地址|收货信息|联系电话|手机号码|手机号/.test(summary) && /修改|更改|改|填错|确认/.test(summary)) return "address";
  if (/物流损/.test(intent) || /破损|损坏|质量问题|融化|坏了|少商品|少配件/.test(summary)) return "damage";
  if (/退款|返款|到账/.test(signal)) return "refund";
  return null;
}

function expectedHandoff(category, query) {
  if (category === "damage") return true;
  if (category === "address") return /帮我|给我|我要|我想|请求|改一下|更改一下|修改一下/.test(query);
  if (category === "invoice") return /帮我|给我|请求|重开|重新开|作废/.test(query);
  return /还没|没有到账|未到账|不到账|退到哪里|退哪|异常|少退|只退|查一下|查询一下/.test(query);
}

function buildHistory(dialogue, utteranceIds) {
  const firstTurn = Math.min(...utteranceIds.filter(Number.isFinite));
  if (!Number.isFinite(firstTurn)) return [];
  return dialogue.Dialogue
    .filter((item) => item.turn < firstTurn)
    .slice(-4)
    .map((item) => ({ role: item.speaker === "Q" ? "user" : "assistant", content: clean(item.utterance) }))
    .filter((item) => item.content.length > 0 && item.content.length <= 500);
}

for (const dialogue of dialogues) {
  const turns = new Map(dialogue.Dialogue.map((item) => [item.turn, item]));
  for (let qaIndex = 0; qaIndex < dialogue.QA.length; qaIndex += 1) {
    const qa = dialogue.QA[qaIndex];
    const category = classify(qa.intent ?? "", qa.QueSumm ?? "");
    if (!category) continue;
    const utterances = (qa.QueSummUttIDs ?? []).map((id) => turns.get(id)).filter((item) => item?.speaker === "Q").map((item) => item.utterance);
    const query = clean(utterances.length ? utterances.join("；") : qa.QueSumm);
    if (query.length < 4 || query.length > 180) continue;
    const history = buildHistory(dialogue, qa.QueSummUttIDs ?? []);
    const contextRequired = !explicitSignals[category].test(query);
    const sourceMap = { refund: "KB-114", damage: "KB-208", address: "KB-301", invoice: "KB-401" };
    const fingerprint = createHash("sha256").update(`${dialogue.DialogueID}:${qaIndex}:${query}`).digest("hex");
    buckets[category].push({
      id: `csds-${split}-${category}-${dialogue.DialogueID}-${qaIndex}`,
      category: `real-${category}`,
      query,
      history,
      contextRequired,
      expectedSource: sourceMap[category],
      expectedHandoff: expectedHandoff(category, query),
      source: {
        dataset: "CSDS",
        split,
        dialogueId: dialogue.DialogueID,
        originalIntent: qa.intent || "unlabeled",
        questionUtteranceIds: qa.QueSummUttIDs ?? [],
        form: utterances.length ? "verbatim-key-utterances" : "human-annotated-question-summary",
      },
      transformations: ["detokenized", "platform-name-generalized", "secondary-pii-redaction"],
      fingerprint,
    });
  }
}

const cases = [];
for (const [category, quota] of Object.entries(quotas)) {
  const unique = [...new Map(buckets[category].map((item) => [item.query, item])).values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  if (unique.length < quota) throw new Error(`Not enough ${category} cases: ${unique.length}/${quota}`);
  cases.push(...unique.slice(0, quota));
}

const piiPatterns = [/[1][3-9]\d{9}/, /\d{17}[\dXx]/, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/];
for (const item of cases) {
  const scanText = [item.query, ...item.history.map((turn) => turn.content)].join("\n");
  if (piiPatterns.some((pattern) => pattern.test(scanText))) throw new Error(`PII scan failed for ${item.id}`);
}

const result = {
  version: "2.0",
  description: split === "val" ? "从 CSDS 官方验证集冻结抽取的中文电商客服盲测问题；首次运行前禁止查看具体样本。" : `从 CSDS 官方${split === "train" ? "训练" : "测试"}集分层抽取的真实中文电商客服问题；仅用于私有研究评测。`,
  source: {
    name: "CSDS: A Fine-grained Chinese Dataset for Customer Service Dialogue Summarization",
    upstream: "https://github.com/xiaolinAndy/CSDS",
    paper: "https://aclanthology.org/2021.emnlp-main.365/",
    upstreamCommit: "1421348842ae3041574cc85fea21e15c3a2106cb",
    rawSplitSize: dialogues.length,
    licenseNote: "Upstream repository does not state an explicit dataset license; keep this derived subset private and use for research/evaluation only.",
  },
  sampling: { method: "deterministic-stratified-sha256", quotas, total: cases.length, contextRequired: cases.filter((item) => item.contextRequired).length },
  privacy: { upstreamAnonymized: true, secondaryScan: true, directIdentifiersFound: 0 },
  freeze: { locked: split === "val", casesSha256: createHash("sha256").update(JSON.stringify(cases.map((item) => ({ id: item.id, query: item.query, expectedSource: item.expectedSource, expectedHandoff: item.expectedHandoff })))).digest("hex") },
  cases: cases.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => key !== "fingerprint"))),
};

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, total: cases.length, categories: Object.fromEntries(Object.keys(quotas).map((key) => [key, cases.filter((item) => item.category === `real-${key}`).length])) }));
