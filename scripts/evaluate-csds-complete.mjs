import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { routeIntent, shouldHandoff } from "../lib/intent-router.ts";

const inputDir = process.argv[2];
const output = process.argv[3] ?? "data/routing-csds-complete-baseline.json";
if (!inputDir) throw new Error("Usage: node scripts/evaluate-csds-complete.mjs <csds-directory> [output]");

const sourceMap = { refund: "KB-114", damage: "KB-208", address: "KB-301", invoice: "KB-401" };
const explicitSignals = {
  refund: /退款|到账|退回|退钱|返还|退货|钱/,
  invoice: /发票|开票|税号|抬头|专票|增票/,
  address: /地址|收货信息|电话|号码|改址/,
  damage: /破|损|坏|质量|少|漏|化了|碎/,
};
const piiPatterns = [/[1][3-9]\d{9}/, /\d{17}[\dXx]/, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/];

function clean(text) {
  return String(text ?? "")
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
    .map((item) => ({ role: item.speaker === "Q" ? "user" : "assistant", content: clean(item.utterance).slice(0, 500) }))
    .filter((item) => item.content.length > 0);
}

function metrics(items) {
  const passed = items.filter((item) => item.passed).length;
  return { total: items.length, passed, passRate: Number((passed / Math.max(items.length, 1)).toFixed(4)) };
}

const splits = ["train", "val", "test"];
const records = [];
const raw = { dialogues: 0, turns: 0, annotatedQuestions: 0, upstreamIntents: new Set() };
const privacy = { directIdentifiersFound: 0, truncatedQueries: 0, emptyQueries: 0 };
const fingerprint = createHash("sha256");

for (const split of splits) {
  const dialogues = JSON.parse(await readFile(join(inputDir, `${split}.json`), "utf8"));
  raw.dialogues += dialogues.length;
  for (const dialogue of dialogues) {
    raw.turns += dialogue.Dialogue.length;
    const turns = new Map(dialogue.Dialogue.map((item) => [item.turn, item]));
    for (let qaIndex = 0; qaIndex < dialogue.QA.length; qaIndex += 1) {
      const qa = dialogue.QA[qaIndex];
      raw.annotatedQuestions += 1;
      const upstreamIntent = qa.intent || "unlabeled";
      raw.upstreamIntents.add(upstreamIntent);
      const utterances = (qa.QueSummUttIDs ?? []).map((id) => turns.get(id)).filter((item) => item?.speaker === "Q").map((item) => item.utterance);
      const fullQuery = clean(utterances.length ? utterances.join("；") : qa.QueSumm);
      if (!fullQuery) privacy.emptyQueries += 1;
      if (fullQuery.length > 500) privacy.truncatedQueries += 1;
      const query = (fullQuery || "[无可用问题文本]").slice(0, 500);
      const history = buildHistory(dialogue, qa.QueSummUttIDs ?? []);
      const scanText = [query, ...history.map((turn) => turn.content)].join("\n");
      if (piiPatterns.some((pattern) => pattern.test(scanText))) privacy.directIdentifiersFound += 1;
      const category = classify(qa.intent ?? "", qa.QueSumm ?? "");
      const routing = routeIntent(query, history);
      const expectedSource = category ? sourceMap[category] : null;
      const expectedTransfer = category ? expectedHandoff(category, query) : true;
      const actualSource = routing?.knowledgeId ?? null;
      const actualTransfer = routing ? shouldHandoff(routing.intent, query) : true;
      const sourcePassed = category ? actualSource === expectedSource : actualSource === null;
      const handoffPassed = category ? actualTransfer === expectedTransfer : actualTransfer === true;
      const passed = category ? sourcePassed && handoffPassed : sourcePassed;
      const contextRequired = category ? !explicitSignals[category].test(query) : false;
      const id = `csds-complete-${split}-${dialogue.DialogueID}-${qaIndex}`;
      fingerprint.update(`${id}\0${query}\0${upstreamIntent}\n`);
      records.push({ id, split, upstreamIntent, category, query, contextRequired, expectedSource, actualSource, expectedHandoff: expectedTransfer, actualHandoff: actualTransfer, sourcePassed, handoffPassed, passed, routingIntent: routing?.intent ?? null });
    }
  }
}

if (privacy.directIdentifiersFound) throw new Error(`Privacy scan failed: ${privacy.directIdentifiersFound} direct identifiers remain`);
const supported = records.filter((item) => item.category);
const unsupported = records.filter((item) => !item.category);
const byUpstreamIntent = Object.fromEntries([...raw.upstreamIntents].sort().map((intent) => {
  const items = records.filter((item) => item.upstreamIntent === intent);
  const routed = items.filter((item) => item.actualSource !== null).length;
  return [intent, { ...metrics(items), routed, routedRate: Number((routed / Math.max(items.length, 1)).toFixed(4)), supportedLabels: items.filter((item) => item.category).length }];
}));

const report = {
  version: "router-v2.0-csds-complete-1",
  generatedAt: new Date().toISOString(),
  source: {
    name: "CSDS: A Fine-grained Chinese Dataset for Customer Service Dialogue Summarization",
    upstream: "https://github.com/xiaolinAndy/CSDS",
    paper: "https://aclanthology.org/2021.emnlp-main.365/",
    localInput: "user-provided complete train/val/test files",
    licenseNote: "Upstream repository does not state an explicit dataset license; raw data and row-level complete outputs remain local and are used only for private research/evaluation.",
  },
  policy: "每个 CSDS 人工标注问题均执行一次测试。四类已支持业务问题检查知识路由与转人工；其余问题检查是否安全兜底，避免错误引用现有知识。",
  raw: { dialogues: raw.dialogues, turns: raw.turns, annotatedQuestions: raw.annotatedQuestions, upstreamIntents: raw.upstreamIntents.size },
  privacy,
  datasetFingerprint: fingerprint.digest("hex"),
  overall: metrics(records),
  supported: {
    ...metrics(supported),
    sourceAccuracy: Number((supported.filter((item) => item.sourcePassed).length / Math.max(supported.length, 1)).toFixed(4)),
    handoffAccuracy: Number((supported.filter((item) => item.handoffPassed).length / Math.max(supported.length, 1)).toFixed(4)),
  },
  unsupported: {
    ...metrics(unsupported),
    safeFallbackRate: Number((unsupported.filter((item) => item.actualSource === null).length / Math.max(unsupported.length, 1)).toFixed(4)),
    falsePositiveRoutes: unsupported.filter((item) => item.actualSource !== null).length,
  },
  bySplit: Object.fromEntries(splits.map((split) => [split, metrics(records.filter((item) => item.split === split))])),
  byCategory: Object.fromEntries(Object.keys(sourceMap).map((category) => [category, metrics(supported.filter((item) => item.category === category))])),
  contextRequired: metrics(supported.filter((item) => item.contextRequired)),
  standalone: metrics(supported.filter((item) => !item.contextRequired)),
  byUpstreamIntent,
  failureCounts: {
    supportedSource: supported.filter((item) => !item.sourcePassed).length,
    supportedHandoff: supported.filter((item) => !item.handoffPassed).length,
    unsupportedFalsePositiveRoute: unsupported.filter((item) => item.actualSource !== null).length,
  },
  failureSample: records.filter((item) => !item.passed).slice(0, 100),
};

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, raw: report.raw, overall: report.overall, supported: report.supported, unsupported: report.unsupported, privacy: report.privacy, fingerprint: report.datasetFingerprint }, null, 2));
