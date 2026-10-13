import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const inputDir = process.argv[2] ?? "/Users/wrf/Documents/简历 2/CSDS";
const output = process.argv[3] ?? "data/csds-knowledge-gap-inventory.json";
const splits = ["train", "val", "test"];

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/京东/g, "平台")
    .replace(/1[3-9]\d{9}/g, "[电话]")
    .trim();
}

function domainForIntent(intent) {
  const value = String(intent ?? "");
  if (/发票|增票/.test(value)) return "invoice";
  if (/退款|返款|退货|退换|返修|保修|质保|三包|纠纷|售后|少商品|物流损|拒收|丢件|破损/.test(value)) return "after_sales";
  if (/配送|物流|出库|发货|收货|快递|返回地址|返回方式/.test(value)) return "fulfillment";
  if (/订单|取消|修改订单|恢复订单|下单|购物|购买|库存|补货/.test(value)) return "order";
  if (/价保|优惠|促销|活动|优惠券|赠品|礼品卡/.test(value)) return "promotion";
  if (/支付|白条|充值|余额|钱包|付款|货到付款|分期/.test(value)) return "payment";
  if (/账户|账号|密码|登录|实名|会员|PLUS|个人资料|手机|微信|QQ/.test(value)) return "account";
  if (/商品|属性|使用|价格|比较|检索|正品|包装|配件|安装|回收/.test(value)) return "product";
  if (/商家入驻|企业用户|商家|联系客服|联系商家|联系客户/.test(value)) return "merchant";
  return "other";
}

function existingCoverage(intent) {
  const value = String(intent ?? "");
  if (/发票|增票/.test(value)) return "partial:invoice-family";
  if (/退款|返款|退货|优惠券退回/.test(value)) return "partial:refund-family";
  if (/破损|物流损|少商品|少配件|丢件|保修|质保|维修|三包|返修|拒收/.test(value)) return "partial:after-sales-family";
  if (/地址|收件人|返回地址|配送|物流|快递/.test(value)) return "partial:fulfillment-family";
  return "gap";
}

const byIntent = new Map();
const fingerprints = new Set();
const raw = { dialogues: 0, qa: 0, turns: 0 };

for (const split of splits) {
  const dialogues = JSON.parse(await readFile(join(inputDir, `${split}.json`), "utf8"));
  for (const dialogue of dialogues) {
    raw.dialogues += 1;
    raw.turns += (dialogue.Dialogue ?? []).length;
    const turns = new Map((dialogue.Dialogue ?? []).map((turn) => [turn.turn, turn]));
    for (let qaIndex = 0; qaIndex < (dialogue.QA ?? []).length; qaIndex += 1) {
      const qa = dialogue.QA[qaIndex];
      raw.qa += 1;
      const intent = qa.intent || "unlabeled";
      const utterances = (qa.QueSummUttIDs ?? [])
        .map((id) => turns.get(id))
        .filter((turn) => turn?.speaker === "Q")
        .map((turn) => turn.utterance);
      const query = clean(utterances.length ? utterances.join("；") : qa.QueSumm);
      const answer = clean(qa.AnsSummLong || qa.AnsSummShort || qa.AnsSumm || "");
      const fingerprint = createHash("sha256").update(`${dialogue.DialogueID}:${qaIndex}:${query}`).digest("hex");
      const item = byIntent.get(intent) ?? {
        upstreamIntent: intent,
        domain: domainForIntent(intent),
        existingCoverage: existingCoverage(intent),
        total: 0,
        splits: { train: 0, val: 0, test: 0 },
        examples: [],
        fingerprints: new Set(),
      };
      item.total += 1;
      item.splits[split] += 1;
      item.fingerprints.add(fingerprint);
      if (item.examples.length < 5 && query) {
        item.examples.push({ split, dialogueId: dialogue.DialogueID, qaIndex, query, answer });
      }
      byIntent.set(intent, item);
      fingerprints.add(fingerprint);
    }
  }
}

const intents = [...byIntent.values()]
  .map((item) => ({
    upstreamIntent: item.upstreamIntent,
    domain: item.domain,
    existingCoverage: item.existingCoverage,
    total: item.total,
    uniqueCases: item.fingerprints.size,
    splits: item.splits,
    examples: item.examples,
  }))
  .sort((a, b) => b.total - a.total || a.upstreamIntent.localeCompare(b.upstreamIntent, "zh-CN"));

const byDomain = Object.fromEntries([...new Set(intents.map((item) => item.domain))].sort().map((domain) => {
  const items = intents.filter((item) => item.domain === domain);
  return [domain, {
    total: items.reduce((sum, item) => sum + item.total, 0),
    intentCount: items.length,
    intents: items.map((item) => item.upstreamIntent),
  }];
}));

const result = {
  version: "1.0-csds-knowledge-gap-inventory",
  generatedAt: new Date().toISOString(),
  policy: "仅用于知识建设盘点与人工审核；不自动写入生产知识库，不把CSDS客服回答直接当作业务规则。",
  source: { directory: inputDir, splits, raw, upstreamIntentCount: intents.length, qaFingerprintCount: fingerprints.size },
  byDomain,
  intents,
};

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, raw, upstreamIntentCount: intents.length, qaFingerprintCount: fingerprints.size, byDomain }, null, 2));
