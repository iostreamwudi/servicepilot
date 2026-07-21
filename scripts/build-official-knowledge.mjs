import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const output = process.argv[2] ?? "data/knowledge-official-corpus.json";
const sources = [
  { code: "CPL", title: "中华人民共和国消费者权益保护法", url: "https://www.samr.gov.cn/zfjcj/tzgg/art/2023/art_615af9ed6bcd4974bf853dd2e02bc663.html", category: "refund" },
  { code: "CPLREG", title: "中华人民共和国消费者权益保护法实施条例", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2024/art_0aea188276a44f0baf940ab95ee00e0a.html", category: "refund" },
  { code: "RETURN", title: "网络购买商品七日无理由退货暂行办法", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2023/art_26ca8fe29e184edd899fa0a7a060d935.html", category: "refund" },
  { code: "EXPRESS", title: "快递暂行条例（2025年修订）", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_ccea5d29862840979d0ff2304edabbb2.html", category: "address" },
  { code: "EXPRESSMARKET", title: "快递市场管理办法", url: "https://xxgk.mot.gov.cn/2020/gz/202401/t20240104_3980684.html", category: "address" },
  { code: "TRADE", title: "网络交易监督管理办法（2025年修正）", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2025/art_4b47c79b8d994a42bba4835997688faa.html", category: "refund" },
  { code: "ECOM", title: "中华人民共和国电子商务法", url: "https://www.samr.gov.cn/zfjcj/tzgg/art/2023/art_d337c3291e8b40459ca03dea54395856.html", category: "refund" },
  { code: "QUALITY", title: "中华人民共和国产品质量法", url: "https://www.samr.gov.cn/zfjcj/tzgg/art/2023/art_579118cd202a45fba28b7edfd9f6fd72.html", category: "damage" },
  { code: "THREE", title: "部分商品修理更换退货责任规定", url: "https://www.samr.gov.cn/zw/zfxxgk/zc/xzgfxwj/art/2019/art_f943e66de125437d92df701e1654c47c.html", category: "damage" },
  { code: "PRICE", title: "中华人民共和国价格法", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/jls/art/2023/art_3da9131ab041449d9af2af886ee33766.html", category: "refund" },
  { code: "PRICEMARK", title: "明码标价和禁止价格欺诈规定", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2023/art_9a1f82a007964950a1a0f6c056f2fedf.html", category: "refund" },
  { code: "ADVERT", title: "中华人民共和国广告法", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2023/art_5474cf75173c45d6a0379730fb4e8d97.html", category: "refund" },
  { code: "PIPL", title: "中华人民共和国个人信息保护法", url: "https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm", category: "address" },
  { code: "DATA", title: "中华人民共和国数据安全法", url: "https://www.cac.gov.cn/2021-06/11/c_1624994566919140.htm", category: "address" },
  { code: "CYBER", title: "中华人民共和国网络安全法（2025年修正）", url: "https://www.cac.gov.cn/2025-12/29/c_1768735112911946.htm", category: "address" },
  { code: "ALGO", title: "互联网信息服务算法推荐管理规定", url: "https://www.cac.gov.cn/2022-01/04/c_1642894606364259.htm", category: "address" },
  { code: "NETCOMP", title: "网络反不正当竞争暂行规定", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2024/art_80019fe59e464196bef173dc56678a42.html", category: "refund" },
  { code: "CONSUMERPENALTY", title: "侵害消费者权益行为处罚办法", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2023/art_85a1509b801143bc8a37a1aa2722542a.html", category: "refund" },
  { code: "BLINDBOX", title: "盲盒经营行为规范指引（试行）", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/zfjcs/art/2023/art_e2facd76a7fb4e90b03912cffb5e7d53.html", category: "refund" },
  { code: "COMPLAINT", title: "市场监督管理投诉举报处理办法", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2026/art_e4d03a20c0fd49769e408c7bf3791ff5.html", category: "refund" },
  { code: "EINV", title: "国家税务总局关于推广应用全面数字化电子发票的公告", url: "https://fgk.chinatax.gov.cn/zcfgk/c100012/c5236067/content.html", category: "invoice" },
];

const keywordBank = ["退款", "退货", "七日", "无理由", "消费者", "经营者", "商品", "服务", "运费", "质量", "修理", "更换", "赔偿", "损毁", "丢失", "短少", "快件", "投递", "收件人", "地址", "验收", "投诉", "个人信息", "敏感个人信息", "同意", "删除", "安全", "发票", "数电发票", "红字", "蓝字", "确认单", "入账", "查验"];

function decodeHtml(value) {
  const entities = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return value.replace(/&(#x?[0-9a-f]+|nbsp|amp|lt|gt|quot|apos);/gi, (_, token) => {
    if (token[0] === "#") return String.fromCodePoint(Number.parseInt(token.slice(token[1]?.toLowerCase() === "x" ? 2 : 1), token[1]?.toLowerCase() === "x" ? 16 : 10));
    return entities[token.toLowerCase()] ?? " ";
  });
}

function htmlToText(html) {
  return decodeHtml(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>|<\/p>|<\/div>|<\/li>|<\/tr>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function chineseNumber(value) {
  return value.replace(/\s+/g, "");
}

function categoryFor(source, content) {
  if (["EXPRESS", "EXPRESSMARKET"].includes(source.code) && /损毁|丢失|短少|赔偿|保价|验收|包装/.test(content)) return "damage";
  return source.category;
}

const documents = [];
for (const source of sources) {
  const response = await fetch(source.url, { headers: { "user-agent": "ServicePilot-KnowledgeBuilder/1.0" } });
  if (!response.ok) throw new Error(`Failed to fetch ${source.title}: HTTP ${response.status}`);
  const text = htmlToText(await response.text());
  const pattern = /第\s*([一二三四五六七八九十百零〇0-9]+)\s*条\s*([\s\S]*?)(?=第\s*[一二三四五六七八九十百零〇0-9]+\s*条|$)/g;
  const seen = new Set();
  const extracted = [...text.matchAll(pattern)].map((match) => ({ article: chineseNumber(match[1]), body: match[2], label: `第${chineseNumber(match[1])}条` }));
  if (!extracted.length && source.code === "EINV") {
    const sectionPattern = /(?:^|\n)\s*([一二三四五六七八九十]+)、\s*([\s\S]*?)(?=\n\s*[一二三四五六七八九十]+、|$)/g;
    extracted.push(...[...text.matchAll(sectionPattern)].map((match) => ({ article: chineseNumber(match[1]), body: match[2], label: `${chineseNumber(match[1])}、` })).filter((item) => /发票|开票|受票/.test(item.body)));
  }
  for (const item of extracted) {
    const article = item.article;
    const content = `${item.label} ${item.body.replace(/\s+/g, " ").trim()}`.slice(0, 2400);
    if (content.length < 20 || seen.has(article)) continue;
    seen.add(article);
    const category = categoryFor(source, content);
    const matchedKeywords = keywordBank.filter((keyword) => content.includes(keyword));
    const keywords = [...new Set([...matchedKeywords.slice(0, 8), source.title.slice(0, 8), `第${article}条`])];
    documents.push({
      id: `LAW-${source.code}-${String(seen.size).padStart(3, "0")}`,
      category,
      title: `${source.title}·${item.label}`,
      version: "2026.07-source-snapshot",
      ownerTeam: "合规知识运营",
      content,
      keywords,
      risk: "high",
      handoff: true,
      state: "review",
      coverage: 0,
      sourceType: "official",
      sourceTitle: source.title,
      sourceUrl: source.url,
      sourceArticle: item.label,
      contentSha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  if (!seen.size) throw new Error(`No articles extracted from ${source.title}`);
  console.log(`${source.code}: ${seen.size}`);
}

const result = {
  version: "2026.07-scale-2",
  generatedAt: new Date().toISOString(),
  policy: "官方原文按条切片，仅进入待复核区；不得在未完成人工审核前用于自动回答。",
  sources,
  total: documents.length,
  corpusSha256: createHash("sha256").update(JSON.stringify(documents.map(({ id, contentSha256 }) => ({ id, contentSha256 })))).digest("hex"),
  documents,
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, total: documents.length, corpusSha256: result.corpusSha256 }));
