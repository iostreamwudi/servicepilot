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
