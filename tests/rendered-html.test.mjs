import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("contains the complete enterprise product surface", async () => {
  const page = await source("app/page.tsx");
  for (const label of ["运营总览", "会话中心", "工单管理", "知识库", "质检中心", "策略中心", "数据分析", "安全审计"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /\/api\/bootstrap/);
  assert.match(page, /\/api\/agent\/respond/);
  assert.match(page, /置信度/);
  assert.match(page, /转接人工客服/);
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
  assert.match(schema, /system_version/);
  assert.match(schema, /source_dataset/);
  assert.match(schema, /context_required/);
  assert.match(schema, /routing_intent/);
  assert.match(schema, /routing_signals_json/);
  assert.match(page, /qwen-plus 基线评测/);
  assert.match(page, /冻结盲测 40 条/);
  assert.match(page, /确认系统失败/);
  assert.match(page, /标记标签问题/);
  assert.match(page, /行为可接受/);
  assert.match(reviews, /Reviewer role required/);
  assert.match(reviews, /evaluation\.review/);
  assert.match(reviews, /onConflictDoUpdate/);
  assert.match(page, /总体通过率/);
  assert.match(page, /高风险通过率/);
});
