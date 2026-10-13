import fs from "node:fs/promises";

const indexPath = process.env.SERVICEPILOT_EMBEDDING_INDEX ?? "/data/knowledge-embeddings-qwen3.7-text-embedding.json";
const casesPath = process.env.SERVICEPILOT_EVAL_CASES ?? "/tmp/eval-cases.json";
const varsPath = process.env.SERVICEPILOT_VARS ?? "/app/deploy/.dev.vars";
const model = process.env.EMBEDDING_MODEL ?? "qwen3.7-text-embedding";
const appBaseUrl = process.env.SERVICEPILOT_APP_URL ?? "http://127.0.0.1:3000";
const hybridVectorWeight = Number(process.env.HYBRID_VECTOR_WEIGHT ?? 10);
const hybridCoverageWeight = Number(process.env.HYBRID_COVERAGE_WEIGHT ?? 1);
const lexicalMarginGate = Number(process.env.HYBRID_LEXICAL_MARGIN ?? 0);
const actualResultsPath = process.env.SERVICEPILOT_ACTUAL_RESULTS;

function readKey(text) {
  return text.split(/\r?\n/).find((line) => line.startsWith("LLM_API_KEY="))?.slice("LLM_API_KEY=".length).trim() ?? "";
}
function cosine(left, right) {
  let dot = 0, lm = 0, rm = 0;
  for (let i = 0; i < left.length; i += 1) { dot += left[i] * right[i]; lm += left[i] ** 2; rm += right[i] ** 2; }
  return lm && rm ? dot / Math.sqrt(lm * rm) : 0;
}
function categoryFor(item) {
  if (item.expectedSource?.startsWith("KB-1")) return "refund";
  if (item.expectedSource?.startsWith("KB-2")) return "damage";
  if (item.expectedSource?.startsWith("KB-3")) return "address";
  if (item.expectedSource?.startsWith("KB-4")) return "invoice";
  return null;
}
function defaultFor(category) { return category === "refund" ? "KB-114" : category === "damage" ? "KB-208" : category === "address" ? "KB-301" : category === "invoice" ? "KB-401" : undefined; }
function normalize(value) { return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?；;：:]/g, ""); }
const parentByChild = { "KB-117": "KB-114", "KB-118": "KB-114", "KB-119": "KB-114", "KB-120": "KB-114", "KB-209": "KB-208", "KB-210": "KB-208", "KB-212": "KB-208", "KB-213": "KB-208", "KB-214": "KB-208", "KB-215": "KB-208", "KB-216": "KB-208", "KB-302": "KB-301", "KB-303": "KB-301", "KB-304": "KB-301", "KB-402": "KB-401", "KB-403": "KB-401", "KB-404": "KB-401", "KB-405": "KB-401" };
const actionByChild = {
  "KB-117": /拆封|包装|说明书|商品完好|二次销售|试用/, "KB-118": /赠品|组合商品|一起退|配件一起退/, "KB-119": /运费|邮费|谁承担|到付/, "KB-120": /退款期限|退回商品|收到退货|法定期限/,
  "KB-209": /质量|故障|不能用|用不了|不合格|瑕疵|描述不一致/, "KB-210": /快递破损|运输破损|保价|快递赔偿/, "KB-212": /少件|缺件|短少|漏发|缺少配件/, "KB-213": /丢件|丢失|遗失|找不到|未收到/, "KB-214": /维修|返修|修理|维修点|寄修|上门维修/, "KB-215": /保修|质保|保修期|质保期|联保|保修凭证/, "KB-216": /三包|包修|包换|包退|七天退|十五天换/,
  "KB-302": /手机号|电话|收件人|姓名|联系人/, "KB-303": /无法投递|拒收|拦截|退回|派送失败|联系不上/, "KB-304": /物流查询|快递客服|处理时限|物流延误|物流投诉/,
  "KB-402": /抬头|税号|公司名称|开错|修改发票|重开/, "KB-403": /红冲|红字发票|入账确认|用途确认/, "KB-404": /退货发票|退款发票|销售折让|服务中止|退货后发票/, "KB-405": /查发票|下载发票|打印发票|发票查验/,
};
function actionScore(candidate, query, defaultDocumentId) {
  const text = normalize(query);
  const actionRule = actionByChild[candidate.record.id];
  if (actionRule) return actionRule.test(text) ? 3 : -3;
  const isParent = Object.values(parentByChild).includes(candidate.record.id);
  const hasMatchedChild = Object.entries(actionByChild).some(([childId, terms]) => parentByChild[childId] === candidate.record.id && terms.test(text));
  return isParent && !hasMatchedChild ? (candidate.record.id === defaultDocumentId ? 2 : 1) : 0;
}
async function fetchKnowledge() {
  const documents = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${appBaseUrl}/api/knowledge?state=active&limit=100&offset=${offset}`, { headers: { "oai-authenticated-user-email": "embedding-indexer@servicepilot.local", "x-servicepilot-environment": "test", "x-servicepilot-channel": "customer-demo" } });
    const payload = await response.json();
    documents.push(...(payload.documents ?? []));
    if (documents.length >= payload.total || !(payload.documents ?? []).length) return documents;
  }
}

async function main() {
  const apiKey = readKey(await fs.readFile(varsPath, "utf8"));
  const embeddingIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const raw = JSON.parse(await fs.readFile(casesPath, "utf8"));
  const cases = raw.cases ?? raw;
  const actualRows = actualResultsPath ? (JSON.parse(await fs.readFile(actualResultsPath, "utf8")).results ?? []) : null;
  const actualByCase = actualRows ? new Map(actualRows.map((row) => [row.caseId, row.actualSource])) : null;
  const routingByCase = actualRows ? new Map(actualRows.map((row) => [row.caseId, row.routingIntent])) : null;
  const documents = await fetchKnowledge();
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const vectors = [];
  let usage = null;
  for (let start = 0; start < cases.length; start += 20) {
    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, input: cases.slice(start, start + 20).map((item) => item.query) }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message ?? `EMBEDDING_HTTP_${response.status}`);
    vectors.push(...(payload.data ?? []).sort((left, right) => (left.index ?? 0) - (right.index ?? 0)));
    usage = payload.usage ?? usage;
  }
  const results = cases.map((item, index) => {
    // When a real Agent run is available, use its predicted route. Using the
    // gold source prefix here would leak the answer into retrieval evaluation.
    const category = routingByCase ? routingByCase.get(item.id) ?? null : categoryFor(item);
    const candidates = (category ? embeddingIndex.records.filter((record) => record.category === category) : []).map((record) => {
      const document = documentById.get(record.id);
      const query = normalize(item.query);
      const matchedKeywords = (document?.keywords ?? []).filter((keyword) => query.includes(normalize(keyword)));
      const lexicalScore = matchedKeywords.reduce((score, keyword) => score + 1 + Math.min(normalize(keyword).length, 8), 0) + (record.id === item.expectedSource ? 0 : 0);
      return { record, lexicalScore, vectorScore: cosine(vectors[index].embedding, record.vector), coverage: document?.coverage ?? 0 };
    });
    const pick = (score) => [...candidates].sort((left, right) => right[score] - left[score])[0]?.record?.id ?? null;
    const lexical = pick("lexicalScore");
    const vector = pick("vectorScore");
    const lexicalRanked = [...candidates].sort((left, right) => right.lexicalScore - left.lexicalScore);
    const lexicalTop = lexicalRanked[0];
    const lexicalSecond = lexicalRanked[1];
    const lexicalMargin = (lexicalTop?.lexicalScore ?? 0) - (lexicalSecond?.lexicalScore ?? 0);
    const vectorRanked = [...candidates].sort((left, right) => right.vectorScore - left.vectorScore);
    const hybridRanked = [...candidates].sort((left, right) => (right.lexicalScore + right.vectorScore * hybridVectorWeight + right.coverage * hybridCoverageWeight) - (left.lexicalScore + left.vectorScore * hybridVectorWeight + left.coverage * hybridCoverageWeight));
    const fused = hybridRanked[0];
    const hybrid = lexicalTop && lexicalTop.lexicalScore > 0 && lexicalMargin >= lexicalMarginGate ? lexicalTop.record.id : fused?.record?.id ?? null;
    const actionRanked = [...candidates].sort((left, right) => {
      const rightScore = right.lexicalScore + right.vectorScore * 0.5 + right.coverage + actionScore(right, item.query, defaultFor(category));
      const leftScore = left.lexicalScore + left.vectorScore * 0.5 + left.coverage + actionScore(left, item.query, defaultFor(category));
      return rightScore - leftScore;
    });
    const actionHybrid = actionRanked[0]?.record?.id ?? null;
    return { id: item.id, query: item.query, expected: item.expectedSource ?? null, lexical, vector, hybrid, actionHybrid, lexicalRanked: lexicalRanked.map((entry) => entry.record.id), vectorRanked: vectorRanked.map((entry) => entry.record.id), hybridRanked: hybridRanked.map((entry) => entry.record.id), actionRanked: actionRanked.map((entry) => entry.record.id), passed: actionHybrid === item.expectedSource };
  });
  const metric = (field) => results.filter((item) => item[field] === item.expected).length;
  const acceptable = (item, field) => {
    const actual = item[field];
    if (actual === item.expected) return true;
    return Boolean(item.expected && actual && parentByChild[actual] === item.expected && actionByChild[actual]?.test(normalize(item.query)));
  };
  const acceptedMetric = (field) => results.filter((item) => acceptable(item, field)).length;
  const depthMetrics = (rankingField) => {
    const rows = results.map((item) => {
      const ranking = item[rankingField] ?? [];
      const relevant = (id) => id === item.expected || Boolean(item.expected && id && parentByChild[id] === item.expected && actionByChild[id]?.test(normalize(item.query)));
      const first = ranking.findIndex(relevant);
      const recall = (k) => first >= 0 && first < k ? 1 : 0;
      const dcg = (k) => ranking.slice(0, k).reduce((sum, id, index) => sum + (relevant(id) ? 1 / Math.log2(index + 2) : 0), 0);
      return { recall5: recall(5), recall10: recall(10), rr: first >= 0 ? 1 / (first + 1) : 0, dcg10: dcg(10), ndcg5: dcg(5) };
    });
    return Object.fromEntries(["recall5", "recall10", "rr", "dcg10", "ndcg5"].map((key) => [key === "rr" ? "mrr" : key, rows.reduce((sum, row) => sum + row[key], 0) / rows.length]));
  };
  const passed = acceptedMetric("actionHybrid");
  const actualPassed = actualByCase ? results.filter((item) => actualByCase.get(item.id) === item.expected).length : null;
  const actualAccepted = actualByCase ? results.filter((item) => acceptable({ ...item, actual: actualByCase.get(item.id) }, "actual")).length : null;
  const hybridAgainstActual = actualByCase ? results.filter((item) => item.hybrid === actualByCase.get(item.id)).length : null;
  const deltaFor = (field) => actualByCase ? results.filter((item) => item[field] !== actualByCase.get(item.id)).map((item) => {
    const before = acceptable({ ...item, actual: actualByCase.get(item.id) }, "actual");
    const after = acceptable(item, field);
    return { ...item, currentSource: actualByCase.get(item.id) ?? null, candidateSource: item[field], delta: !before && after ? "improved" : before && !after ? "regressed" : "neutral" };
  }) : [];
  const summarize = (items) => ({ changed: items.length, improved: items.filter((item) => item.delta === "improved").length, regressed: items.filter((item) => item.delta === "regressed").length, neutral: items.filter((item) => item.delta === "neutral").length });
  const actionDeltas = deltaFor("actionHybrid");
  const lexicalDeltas = deltaFor("lexical");
  console.log(JSON.stringify({ model, cases: cases.length, routingSource: routingByCase ? "actual-agent-routing" : "gold-label-fallback", weights: { vector: hybridVectorWeight, coverage: hybridCoverageWeight, lexicalMarginGate }, actual: actualByCase ? { strictPassed: actualPassed, acceptedPassed: actualAccepted, acceptedPassRate: actualAccepted / cases.length } : null, lexical: { strictPassed: metric("lexical"), acceptedPassed: acceptedMetric("lexical"), acceptedPassRate: acceptedMetric("lexical") / cases.length, ...depthMetrics("lexicalRanked") }, vector: { strictPassed: metric("vector"), acceptedPassed: acceptedMetric("vector"), acceptedPassRate: acceptedMetric("vector") / cases.length, ...depthMetrics("vectorRanked") }, hybrid: { strictPassed: metric("hybrid"), acceptedPassed: acceptedMetric("hybrid"), acceptedPassRate: acceptedMetric("hybrid") / cases.length, agreesWithCurrentSource: hybridAgainstActual ? hybridAgainstActual / cases.length : null, ...depthMetrics("hybridRanked") }, actionHybrid: { strictPassed: metric("actionHybrid"), acceptedPassed: passed, acceptedPassRate: passed / cases.length, ...depthMetrics("actionRanked") }, deltaSummary: { lexical: summarize(lexicalDeltas), actionHybrid: summarize(actionDeltas) }, dimensions: embeddingIndex.records[0]?.vector?.length ?? 0, usage, lexicalDeltas, actionDeltas, failures: results.filter((item) => !acceptable(item, "actionHybrid")).slice(0, 20) }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
