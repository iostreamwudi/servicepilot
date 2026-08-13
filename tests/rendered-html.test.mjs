import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("contains a role-based enterprise product surface", async () => {
  const page = await source("app/page.tsx");
  for (const label of ["运营总览", "会话中心", "工单管理", "知识库", "质检中心", "策略中心", "数据分析", "资源权限", "安全审计"]) {
    assert.match(page, new RegExp(label));
  }
  for (const role of ["服务主管", "一线客服", "AI 运营", "系统管理员"]) {
    assert.match(page, new RegExp(role));
  }
  assert.match(page, /我的工作台/);
  assert.match(page, /全局搜索/);
  assert.match(page, /当前角色/);
  assert.doesNotMatch(page, /aria-label="业务域导航"/);
  assert.match(page, /\/api\/bootstrap/);
  assert.match(page, /\/api\/agent\/respond/);
  assert.match(page, /置信度/);
  assert.match(page, /转接人工客服/);
});

test("ships person-level task-interface-metric access control", async () => {
  const access = await source("app/resource-access.tsx");
  assert.match(access, /任务 → 接口 → 指标/);
  assert.match(access, /直接配置/);
  assert.match(access, /父级继承/);
  assert.match(access, /查看权限/);
  assert.match(access, /修改权限/);
  assert.match(access, /保存权限/);
  assert.match(access, /prefers-reduced-motion|resource-access/);
  assert.doesNotMatch(access, /角色|部门|用户组/);
});

test("enforces grounded answers and safe fallback in the Agent route", async () => {
  const route = await source("app/api/agent/respond/route.ts");
  assert.match(route, /oai-authenticated-user-email/);
  assert.match(route, /query\.length > 500/);
  assert.match(route, /不得承诺赔付或执行资金、账户操作/);
  assert.match(route, /safe-fallback/);
  assert.match(route, /deterministic-safe/);
  assert.match(route, /model-grounded/);
  assert.match(route, /LLM_API_KEY/);
  assert.match(route, /AbortSignal\.timeout\(8_000\)/);
  assert.match(route, /routeIntent/);
  assert.match(route, /matchedSignals/);
  assert.match(route, /agentConversationStates/);
  assert.match(route, /conversationId is invalid/);
  assert.match(route, /30 \* 60_000/);
  assert.match(route, /继承会话状态/);
  assert.match(route, /retrieveKnowledge/);
  assert.match(route, /knowledgeDocuments/);
  assert.match(route, /eq\(knowledgeDocuments\.state, "active"\)/);
});

test("ships a traceable database-backed knowledge library", async () => {
  const [seedText, corpusText, schema, bootstrap, api, page] = await Promise.all([
    source("data/knowledge-seed.json"),
    source("data/knowledge-official-corpus.json"),
    source("db/schema.ts"),
    source("app/api/bootstrap/route.ts"),
    source("app/api/knowledge/route.ts"),
    source("app/page.tsx"),
  ]);
  const seed = JSON.parse(seedText);
  const corpus = JSON.parse(corpusText);
  assert.ok(seed.documents.length >= 20);
  assert.equal(new Set(seed.documents.map((item) => item.id)).size, seed.documents.length);
  for (const category of ["refund", "damage", "address", "invoice"]) {
    assert.ok(seed.documents.some((item) => item.category === category));
  }
  assert.ok(seed.documents.filter((item) => item.sourceType === "official" && item.sourceUrl?.startsWith("https://")).length >= 12);
  assert.ok(seed.documents.every((item) => Array.isArray(item.keywords) && item.keywords.length >= 4));
  assert.ok(corpus.documents.length >= 1000);
  assert.equal(new Set(corpus.documents.map((item) => item.id)).size, corpus.documents.length);
  assert.ok(corpus.documents.every((item) => item.state === "review" && item.sourceType === "official" && /^[a-f0-9]{64}$/.test(item.contentSha256)));
  assert.ok(corpus.sources.length >= 20);
  assert.match(schema, /source_type/);
  assert.match(schema, /keywords_json/);
  assert.match(bootstrap, /onConflictDoUpdate/);
  assert.match(api, /documents\.map/);
  assert.match(api, /\.limit\(limit\)\.offset\(offset\)/);
  assert.match(page, /\/api\/knowledge/);
  assert.doesNotMatch(page, /知识条目<\/span><b>1,284/);
});

test("ships complete CSDS coverage plus a reproducible focused routing evaluation", async () => {
  const [trainText, valText, testText, reportText, completeText, manifestText, api, page] = await Promise.all([
    source("data/eval-csds-full-train.json"),
    source("data/eval-csds-full-val.json"),
    source("data/eval-csds-full-test.json"),
    source("data/routing-full-baseline.json"),
    source("data/routing-csds-complete-baseline.json"),
    source("data/real-data-manifest.json"),
    source("app/api/evaluations/scale/route.ts"),
    source("app/page.tsx"),
  ]);
  const datasets = [JSON.parse(trainText), JSON.parse(valText), JSON.parse(testText)];
  const report = JSON.parse(reportText);
  const complete = JSON.parse(completeText);
  const manifest = JSON.parse(manifestText);
  assert.equal(datasets.reduce((sum, item) => sum + item.cases.length, 0), 4196);
  assert.equal(report.overall.total, 4196);
  assert.equal(complete.raw.dialogues, 10701);
  assert.equal(complete.raw.turns, 277399);
  assert.equal(complete.raw.annotatedQuestions, 21126);
  assert.equal(complete.overall.total, 21126);
  assert.equal(complete.privacy.directIdentifiersFound, 0);
  assert.match(complete.datasetFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(manifest.totals.upstreamDialogues, 10701);
  assert.equal(manifest.totals.fullCoverageEvaluationCases, 21126);
  assert.equal(manifest.quality.duplicateEvaluationQueries, 0);
  assert.equal(manifest.quality.directIdentifiersFound, 0);
  assert.ok(datasets.every((item) => /^[a-f0-9]{64}$/.test(item.freeze.casesSha256)));
  assert.ok(datasets.every((item) => item.privacy.directIdentifiersFound === 0));
  assert.match(api, /trainSet/);
  assert.match(api, /manifest/);
  assert.match(api, /completeBaseline/);
  assert.match(page, /21,126 个标注问题全部逐条测试/);
  assert.match(page, /四类专项场景浏览器/);
  assert.match(page, /全量评测口径/);
});

test("ships a representative offline evaluation seed", async () => {
  const evaluation = JSON.parse(await source("data/eval-seed.json"));
  assert.equal(evaluation.version, "0.1");
  assert.ok(evaluation.cases.length >= 15);
  const categories = new Set(evaluation.cases.map((item) => item.category));
  for (const category of ["normal", "high-risk", "boundary", "unknown", "adversarial", "privacy"]) {
    assert.ok(categories.has(category), `missing category: ${category}`);
  }
  assert.ok(evaluation.cases.some((item) => item.expectedHandoff === true));
  assert.ok(evaluation.cases.some((item) => Array.isArray(item.mustNotContain)));
});

test("ships a traceable, privacy-scanned real-world evaluation set", async () => {
  const evaluation = JSON.parse(await source("data/eval-csds-real.json"));
  assert.equal(evaluation.version, "1.0");
  assert.equal(evaluation.cases.length, 85);
  assert.equal(evaluation.privacy.directIdentifiersFound, 0);
  assert.equal(new Set(evaluation.cases.map((item) => item.id)).size, 85);
  assert.ok(evaluation.cases.every((item) => item.source.dataset === "CSDS" && item.source.dialogueId !== undefined));
  assert.ok(evaluation.cases.every((item) => Array.isArray(item.history) && item.history.length <= 4));
  assert.ok(evaluation.cases.some((item) => item.contextRequired === true));
});

test("ships a frozen blind suite from an unseen upstream split", async () => {
  const blind = JSON.parse(await source("data/eval-csds-blind.json"));
  assert.equal(blind.cases.length, 40);
  assert.equal(blind.freeze.locked, true);
  assert.match(blind.freeze.casesSha256, /^[a-f0-9]{64}$/);
  assert.equal(blind.privacy.directIdentifiersFound, 0);
  assert.ok(blind.cases.every((item) => item.source.split === "val"));
});

test("keeps enterprise tool calls read-only, validated and masked", async () => {
  const [tool, records, agent] = await Promise.all([
    source("app/api/tools/order-refund/route.ts"),
    source("lib/order-tool.ts"),
    source("app/api/agent/respond/route.ts"),
  ]);
  assert.match(records, /\^OR-\\d\{6\}\$/);
  assert.match(records, /尾号 \*\*/);
  assert.match(tool, /readOnly: true/);
  assert.match(tool, /piiMasked: true/);
  assert.match(tool, /tool\.order_refund\.read/);
  assert.match(agent, /订单工具未返回结果，禁止模型猜测/);
  assert.match(agent, /可信工具结果（只读、已脱敏）/);
  assert.match(agent, /订单状态只能引用此结果，不得自行推断/);
});

test("runs guarded model evaluations and exposes the quality dashboard", async () => {
  const [route, reviews, schema, page] = await Promise.all([
    source("app/api/evaluations/route.ts"),
    source("app/api/evaluations/reviews/route.ts"),
    source("db/schema.ts"),
    source("app/page.tsx"),
  ]);
  assert.match(route, /runWithConcurrency\(items, request, 5\)/);
  assert.match(route, /请等待 5 分钟后再次运行/);
  assert.match(route, /realEvaluationSet/);
  assert.match(route, /blindEvaluationSet/);
  assert.match(route, /当前系统版本已经运行过冻结盲测/);
  assert.match(route, /history: item\.history/);
  assert.match(route, /index \+= 4/);
  assert.match(route, /评测运行未完成，系统已记录失败原因/);
  assert.match(route, /run\.status === "completed"/);
  assert.match(route, /知识来源不符合预期/);
  assert.match(route, /转人工决策不符合预期/);
  assert.match(schema, /evaluation_runs/);
  assert.match(schema, /evaluation_results/);
  assert.match(schema, /evaluation_reviews/);
  assert.match(schema, /agent_conversation_states/);
  assert.match(schema, /system_version/);
  assert.match(schema, /source_dataset/);
  assert.match(schema, /context_required/);
  assert.match(schema, /routing_intent/);
  assert.match(schema, /routing_signals_json/);
  assert.match(page, /CSDS 全量覆盖 \+ 混合意图路由 \+ qwen-plus 端到端回归/);
  assert.match(page, /未支持意图安全兜底/);
  assert.match(page, /确认系统失败/);
  assert.match(page, /标记标签问题/);
  assert.match(page, /行为可接受/);
  assert.match(page, /30 分钟会话记忆/);
  assert.doesNotMatch(page, /useEffect\(load,/);
  assert.match(page, /createDemoConversationId/);
  assert.match(page, /getRandomValues/);
  assert.doesNotMatch(page, /crypto\.randomUUID\(\)/);
  assert.match(reviews, /Reviewer role required/);
  assert.match(reviews, /evaluation\.review/);
  assert.match(reviews, /onConflictDoUpdate/);
  assert.match(page, /总体通过率/);
  assert.match(page, /高风险通过率/);
});
