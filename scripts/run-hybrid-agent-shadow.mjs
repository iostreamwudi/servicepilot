import fs from "node:fs/promises";

const appBaseUrl = process.env.SERVICEPILOT_APP_URL ?? "http://127.0.0.1:3000";
const indexPath = process.env.SERVICEPILOT_EMBEDDING_INDEX ?? "/data/knowledge-embeddings-qwen3.7-text-embedding.json";
const casesPath = process.env.SERVICEPILOT_EVAL_CASES ?? "/tmp/eval-cases.json";
const baselinePath = process.env.SERVICEPILOT_ACTUAL_RESULTS ?? "/tmp/latest-eval.json";
const varsPath = process.env.SERVICEPILOT_VARS ?? "/app/deploy/.dev.vars";
const model = process.env.LLM_MODEL ?? "qwen3.7-plus";
const vectorWeight = Number(process.env.HYBRID_VECTOR_WEIGHT ?? 0.5);

function keyFrom(text) { return text.split(/\r?\n/).find((line) => line.startsWith("LLM_API_KEY="))?.slice("LLM_API_KEY=".length).trim() ?? ""; }
function normalize(value) { return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?；;：:]/g, ""); }
function cosine(left, right) { let dot = 0, lm = 0, rm = 0; for (let i = 0; i < left.length; i += 1) { dot += left[i] * right[i]; lm += left[i] ** 2; rm += right[i] ** 2; } return lm && rm ? dot / Math.sqrt(lm * rm) : 0; }
function categoryFor(item) { if (item.expectedSource?.startsWith("KB-1")) return "refund"; if (item.expectedSource?.startsWith("KB-2")) return "damage"; if (item.expectedSource?.startsWith("KB-3")) return "address"; if (item.expectedSource?.startsWith("KB-4")) return "invoice"; return null; }
const parentByChild = { "KB-117": "KB-114", "KB-118": "KB-114", "KB-119": "KB-114", "KB-120": "KB-114", "KB-209": "KB-208", "KB-210": "KB-208", "KB-212": "KB-208", "KB-213": "KB-208", "KB-214": "KB-208", "KB-215": "KB-208", "KB-216": "KB-208", "KB-302": "KB-301", "KB-303": "KB-301", "KB-304": "KB-301", "KB-402": "KB-401", "KB-403": "KB-401", "KB-404": "KB-401", "KB-405": "KB-401" };
const actionByChild = {
  "KB-117": /拆封|包装|说明书|商品完好|二次销售|试用/, "KB-118": /赠品|组合商品|一起退|配件一起退/, "KB-119": /运费|邮费|谁承担|到付/, "KB-120": /退款期限|退回商品|收到退货|法定期限/,
  "KB-209": /质量|故障|不能用|用不了|不合格|瑕疵|描述不一致/, "KB-210": /快递破损|运输破损|保价|快递赔偿/, "KB-212": /少件|缺件|短少|漏发|缺少配件/, "KB-213": /丢件|丢失|遗失|找不到|未收到/, "KB-214": /维修|返修|修理|维修点|寄修|上门维修/, "KB-215": /保修|质保|保修期|质保期|联保|保修凭证/, "KB-216": /三包|包修|包换|包退|七天退|十五天换/,
  "KB-302": /手机号|电话|收件人|姓名|联系人/, "KB-303": /无法投递|拒收|拦截|退回|派送失败|联系不上/, "KB-304": /物流查询|快递客服|处理时限|物流延误|物流投诉/,
  "KB-402": /抬头|税号|公司名称|开错|修改发票|重开/, "KB-403": /红冲|红字发票|入账确认|用途确认/, "KB-404": /退货发票|退款发票|销售折让|服务中止|退货后发票/, "KB-405": /查发票|下载发票|打印发票|发票查验/,
};
function defaultFor(category) { return category === "refund" ? "KB-114" : category === "damage" ? "KB-208" : category === "address" ? "KB-301" : category === "invoice" ? "KB-401" : undefined; }
function actionScore(candidate, query, defaultDocumentId) { const text = normalize(query); const actionRule = actionByChild[candidate.record.id]; if (actionRule) return actionRule.test(text) ? 3 : -3; const isParent = Object.values(parentByChild).includes(candidate.record.id); const hasMatchedChild = Object.entries(actionByChild).some(([childId, terms]) => parentByChild[childId] === candidate.record.id && terms.test(text)); return isParent && !hasMatchedChild ? (candidate.record.id === defaultDocumentId ? 2 : 1) : 0; }
function acceptableSource(expected, actual, query) { return expected === actual || Boolean(expected && actual && parentByChild[actual] === expected && actionByChild[actual]?.test(normalize(query))); }
function checkAnswer(item, answer) { const normalized = normalize(answer); const failures = []; for (const text of item.mustContain ?? []) if (!normalized.includes(normalize(text))) failures.push(`缺少必要信息：${text}`); for (const text of item.mustNotContain ?? []) if (normalized.includes(normalize(text))) failures.push(`包含禁止内容：${text}`); return failures; }
async function docs() { const response = await fetch(`${appBaseUrl}/api/knowledge?state=active&limit=100&offset=0`, { headers: { "oai-authenticated-user-email": "shadow@servicepilot.local", "x-servicepilot-environment": "test", "x-servicepilot-channel": "customer-demo" } }); const payload = await response.json(); return payload.documents ?? []; }

async function main() {
  const apiKey = keyFrom(await fs.readFile(varsPath, "utf8"));
  const embeddingIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const allCases = (JSON.parse(await fs.readFile(casesPath, "utf8"))).cases;
  const cases = allCases.slice(0, Number(process.env.SHADOW_LIMIT ?? 15));
  const knowledge = await docs();
  const byId = new Map(knowledge.map((item) => [item.id, item]));
  const embResponse = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: "qwen3.7-text-embedding", input: cases.map((item) => item.query) }) });
  const embPayload = await embResponse.json();
  if (!embResponse.ok) throw new Error(embPayload?.error?.message ?? "EMBEDDING_FAILED");
  const vectors = (embPayload.data ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const baseline = new Map((JSON.parse(await fs.readFile(baselinePath, "utf8")).results ?? []).map((row) => [row.caseId, row]));
  const outputs = [];
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const category = baseline.get(item.id)?.routingIntent ?? null;
    const candidates = (category ? embeddingIndex.records.filter((record) => record.category === category) : []).map((record) => {
      const document = byId.get(record.id);
      const hits = (document?.keywords ?? []).filter((keyword) => normalize(item.query).includes(normalize(keyword)));
      const lexicalScore = hits.reduce((score, keyword) => score + 1 + Math.min(normalize(keyword).length, 8), 0);
      return { record, document, lexicalScore, vectorScore: cosine(vectors[index].embedding, record.vector), coverage: document?.coverage ?? 0 };
    });
    const ranked = [...candidates].sort((a, b) => (b.lexicalScore + b.vectorScore * vectorWeight + b.coverage + actionScore(b, item.query, defaultFor(category))) - (a.lexicalScore + a.vectorScore * vectorWeight + a.coverage + actionScore(a, item.query, defaultFor(category))));
    const selected = ranked[0];
    const rule = selected?.document;
    const messages = [{ role: "system", content: "你是企业客服助手。能依据可信知识时再回答业务事实；没有可信知识时不要猜测、不要编造政策或订单状态，用自然、简短的真人客服语气说明需要进一步核实。不得承诺赔付或执行资金、账户操作。回答控制在150字以内。" }, ...(rule ? [{ role: "system", content: `可信知识：${rule.title} ${rule.version}\n${rule.content}` }] : [{ role: "system", content: "当前没有命中的可信知识。请只做自然问候或说明需要核实，不要编造业务答案。" }]), ...(item.history ?? []), { role: "user", content: item.query }];
    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0.1, messages }) });
    const payload = await response.json();
    const answer = payload.choices?.[0]?.message?.content?.trim() ?? "";
    const failures = checkAnswer(item, answer);
    outputs.push({ id: item.id, query: item.query, expectedSource: item.expectedSource, hybridSource: rule?.id ?? null, baselineSource: baseline.get(item.id)?.actualSource ?? null, answerFailures: failures, answer });
  }
  const sourcePassed = outputs.filter((item) => acceptableSource(item.expectedSource, item.hybridSource, item.query)).length;
  const baselinePassed = outputs.filter((item) => acceptableSource(item.expectedSource, item.baselineSource, item.query)).length;
  const answerPassed = outputs.filter((item) => item.answerFailures.length === 0).length;
  console.log(JSON.stringify({ model, cases: outputs.length, baselineSource: baselinePassed, hybridSource: sourcePassed, hybridAnswerChecks: answerPassed, results: outputs }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
