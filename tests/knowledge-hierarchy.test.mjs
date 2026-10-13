import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeChildRules, matchKnowledgeSource } from "../lib/knowledge-hierarchy.ts";

test("accepts a specific child knowledge when it matches the user's request", () => {
  assert.equal(matchKnowledgeSource("KB-208", "KB-214", "电视屏幕坏了，能维修吗").passed, true);
  assert.equal(matchKnowledgeSource("KB-401", "KB-402", "发票税号写错了怎么改").passed, true);
  assert.equal(matchKnowledgeSource("KB-301", "KB-302", "手机号写错了需要修改").passed, true);
});

test("does not accept an unrelated child knowledge", () => {
  assert.equal(matchKnowledgeSource("KB-208", "KB-214", "商品丢件如何处理").passed, false);
  assert.equal(matchKnowledgeSource("KB-401", "KB-402", "电子发票在哪里下载").passed, false);
  assert.equal(matchKnowledgeSource("KB-301", "KB-303", "手机号写错了").passed, false);
});

test("exposes the governed parent-child mapping for audit", () => {
  const rules = knowledgeChildRules();
  assert.ok(rules["KB-208"].some((item) => item.id === "KB-214"));
  assert.ok(rules["KB-208"].some((item) => item.id === "KB-211"));
  assert.ok(rules["KB-401"].some((item) => item.id === "KB-402"));
});

test("accepts the damage evidence child only when the query names evidence work", () => {
  assert.equal(matchKnowledgeSource("KB-208", "KB-211", "外包装破损，签收时怎么拍照留证").passed, true);
  assert.equal(matchKnowledgeSource("KB-208", "KB-211", "机器有很大的哨声，很刺耳").passed, false);
});
