import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { routeIntent, shouldHandoff } from "../lib/intent-router.ts";

const inputDir = process.argv[2];
const output = process.argv[3] ?? "data/routing-csds-complete-baseline.json";
if (!inputDir) throw new Error("Usage: node scripts/evaluate-csds-complete.mjs <csds-directory> [output]");

const sourceMap = { refund: "KB-114", physical_damage: "KB-208", quality_issue: "KB-209", missing_item: "KB-212", lost_parcel: "KB-213", repair: "KB-214", warranty: "KB-215", three_guarantees: "KB-216", address: "KB-301", invoice: "KB-401" };
const explicitSignals = {
  refund: /退款|到账|退回|退钱|返还|退货|钱/,
  invoice: /发票|开票|税号|抬头|专票|增票/,
  address: /地址|收货信息|电话|号码|改址/,
  physical_damage: /破|损|裂|碎|烂|漏|划痕|磕碰/,
  quality_issue: /质量|故障|不能用|用不了|开不了机|没反应|异响|噪音/,
  missing_item: /少件|缺件|短少|少商品|少配件|漏发|缺少/,
  lost_parcel: /丢件|丢失|遗失|不见了|找不到/,
  repair: /维修|返修|修理|维修点/,
  warranty: /保修|质保|保修期|质保期|联保/,
  three_guarantees: /三包|包修|包换|包退|七天退|十五天换/,
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

function classify(intent, summary, query) {
  const signal = `${intent}${summary}`;
  // Secondary after-sales labels require evidence in the actual customer
  // utterance. Upstream summaries can describe an earlier topic and must not
  // be used to manufacture a route for the current turn.
  const text = query;
  if (/发票|增票/.test(signal) || /发票|开票|税号|专票|增值税票|发票抬头|补开|换开|重开|带票|什么时候.*开好|能开好/.test(query)) return "invoice";
  if ((/地址|收货信息|联系电话|手机号码|手机号/.test(summary) && /修改|更改|改|填错|确认/.test(summary)) || /(收货|收件)?地址.*(错|改|修改|更改)|(街道|门牌号).*(错|改)|改.*(地址|街道|门牌号|收件人|收货人|手机号|电话)|收件人电话.*错/.test(query)) return "address";
  if (/三包|包修|包换|包退|七天退|十五天换/.test(text)) return "three_guarantees";
  if (/保修|质保|保修期|质保期|联保/.test(text)) return "warranty";
  if (/维修|返修|修理|维修点/.test(text)) return "repair";
  if (/丢件|丢失|遗失|丢了|快递.*不见|包裹.*不见|找不到.*(包裹|快递|货)/.test(text)) return "lost_parcel";
  if (/少件|缺件|短少|少商品|少配件|漏发|缺少|拿漏/.test(text)) return "missing_item";
  if (/质量问题|故障|不能用|用不了|开不了机|没反应|异响|噪音|失灵/.test(text)) return "quality_issue";
  if (/破损|损坏|融化|碎了|腐烂|烂了|烂的|不新鲜|发霉|漏液|划痕|磕碰|压烂/.test(text)) return "physical_damage";
  if (/退款|返款|到账/.test(signal) || /退款|退钱|返款|反款|原路退|款.*(没到|未到|不到账|退到)|钱.*没(到|返回|退)|回款|退费|退.*(白条|银行卡|微信|支付宝|余额)/.test(query)) return "refund";
  return null;
}

function expectedHandoff(category, query) {
  if (["physical_damage", "quality_issue", "missing_item", "lost_parcel", "repair", "warranty", "three_guarantees"].includes(category)) return true;
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
      const category = classify(qa.intent ?? "", qa.QueSumm ?? "", query);
      const routing = routeIntent(query, history);
      const expectedSource = category ? sourceMap[category] : null;
      const expectedTransfer = category ? expectedHandoff(category, query) : true;
      const actualSource = routing?.retrievalKnowledgeId ?? null;
      const actualTransfer = routing ? shouldHandoff(routing.intent, query) : true;
      const sourcePassed = category ? actualSource === expectedSource : actualSource === null;
      const handoffPassed = category ? actualTransfer === expectedTransfer : actualTransfer === true;
      const passed = category ? sourcePassed && handoffPassed : sourcePassed;
      const contextRequired = category ? !explicitSignals[category].test(query) : false;
      const id = `csds-complete-${split}-${dialogue.DialogueID}-${qaIndex}`;
      fingerprint.update(`${id}\0${query}\0${upstreamIntent}\n`);
      records.push({ id, split, upstreamIntent, category, query, contextRequired, expectedSource, actualSource, expectedHandoff: expectedTransfer, actualHandoff: actualTransfer, sourcePassed, handoffPassed, passed, routingIntent: routing?.intent ?? null, routingSignals: routing?.matchedSignals ?? [] });
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
  version: "router-v3.0-csds-expanded-taxonomy-1",
  generatedAt: new Date().toISOString(),
  source: {
    name: "CSDS: A Fine-grained Chinese Dataset for Customer Service Dialogue Summarization",
    upstream: "https://github.com/xiaolinAndy/CSDS",
    paper: "https://aclanthology.org/2021.emnlp-main.365/",
    localInput: "user-provided complete train/val/test files",
    licenseNote: "Upstream repository does not state an explicit dataset license; raw data and row-level complete outputs remain local and are used only for private research/evaluation.",
  },
  policy: "每个 CSDS 人工标注问题均执行一次测试。退款、地址、发票及七类售后二级意图检查知识路由与转人工；其余问题检查是否安全兜底，避免错误引用现有知识。",
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
  unsupportedByRoute: Object.fromEntries(Object.keys(sourceMap).map((intent) => {
    const items = unsupported.filter((item) => item.routingIntent === intent);
    return [intent, { total: items.length, topSignals: Object.entries(items.flatMap((item) => item.routingSignals).reduce((counts, signal) => ({ ...counts, [signal]: (counts[signal] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 20) }];
  })),
  unsupportedFalsePositiveSample: unsupported.filter((item) => item.actualSource !== null).slice(0, 500),
  failureSample: records.filter((item) => !item.passed).slice(0, 100),
};

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, raw: report.raw, overall: report.overall, supported: report.supported, unsupported: report.unsupported, privacy: report.privacy, fingerprint: report.datasetFingerprint }, null, 2));
