import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const output = process.argv[2] ?? "data/knowledge-official-corpus.json";
const sources = [
  { code: "CPL", title: "中华人民共和国消费者权益保护法", url: "https://www.samr.gov.cn/zfjcj/tzgg/art/2023/art_615af9ed6bcd4974bf853dd2e02bc663.html", category: "refund" },
  { code: "RETURN", title: "网络购买商品七日无理由退货暂行办法", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2023/art_26ca8fe29e184edd899fa0a7a060d935.html", category: "refund" },
  { code: "EXPRESS", title: "快递暂行条例（2025年修订）", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_ccea5d29862840979d0ff2304edabbb2.html", category: "address" },
  { code: "TRADE", title: "网络交易监督管理办法（2025年修正）", url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2025/art_4b47c79b8d994a42bba4835997688faa.html", category: "refund" },
  { code: "ECOM", title: "中华人民共和国电子商务法", url: "https://www.samr.gov.cn/zfjcj/tzgg/art/2023/art_d337c3291e8b40459ca03dea54395856.html", category: "refund" },
  { code: "PIPL", title: "中华人民共和国个人信息保护法", url: "https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm", category: "address" },
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
  if (source.code === "EXPRESS" && /损毁|丢失|短少|赔偿|保价|验收|包装/.test(content)) return "damage";
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
  version: "2026.07-scale-1",
  generatedAt: new Date().toISOString(),
  policy: "官方原文按条切片，仅进入待复核区；不得在未完成人工审核前用于自动回答。",
  sources,
  total: documents.length,
  corpusSha256: createHash("sha256").update(JSON.stringify(documents.map(({ id, contentSha256 }) => ({ id, contentSha256 })))).digest("hex"),
  documents,
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, total: documents.length, corpusSha256: result.corpusSha256 }));
