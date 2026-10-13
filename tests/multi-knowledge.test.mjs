import assert from "node:assert/strict";
import test from "node:test";
import { demandedEvidenceSlots, selectComplementaryKnowledge } from "../lib/multi-knowledge.ts";

function knowledge(id, overrides = {}) {
  return {
    id, title: "知识", version: "v1", terms: [], answer: "处理流程",
    sourceTitle: "统一规范", sourceUrl: "https://example.com/rule", ...overrides,
  };
}

function candidate(document, overrides = {}) {
  return {
    id: document.id, lexicalScore: 5, vectorScore: 0.8, fusedScore: 8,
    scoreDeltaFromCurrent: -1, matchedKeywords: ["材料"], actionMatched: false,
    knowledge: document, ...overrides,
  };
}

test("extracts several explicit evidence demands without using case-specific IDs", () => {
  assert.deepEqual(demandedEvidenceSlots("申请售后需要什么照片，大概多久处理？"), ["timing", "evidence", "action"]);
});

test("keeps one source when the question has only one evidence demand", () => {
  const primary = knowledge("KB-208", { answer: "请提交照片和面单证据" });
  const result = selectComplementaryKnowledge({
    query: "需要什么照片？", primary, candidates: [], indexVersion: "idx-1",
  });
  assert.deepEqual(result.selected, []);
});

test("selects at most one compatible source that fills a missing slot", () => {
  const primary = knowledge("KB-401", { answer: "提交申请后下载发票" });
  const supplemental = knowledge("KB-403", { answer: "确认单发起后72小时未确认会自动作废" });
  const result = selectComplementaryKnowledge({
    query: "发票怎么处理，大概多少小时？", primary,
    candidates: [candidate(supplemental)], indexVersion: "idx-1",
  });
  assert.deepEqual(result.selected.map((item) => item.id), ["KB-403"]);
});

test("rejects cross-family sources and semantic-only evidence", () => {
  const primary = knowledge("KB-301", { sourceTitle: "履约规范", sourceUrl: null, answer: "申请修改地址" });
  const unrelated = knowledge("KB-403", { sourceTitle: "发票规范", sourceUrl: null, answer: "72小时后确认单作废" });
  const result = selectComplementaryKnowledge({
    query: "怎么修改，大概多少小时？", primary,
    candidates: [candidate(unrelated, { matchedKeywords: [], actionMatched: false })], indexVersion: "idx-1",
  });
  assert.deepEqual(result.selected, []);
});

test("rejects candidates when the active index version is unavailable", () => {
  const primary = knowledge("KB-401", { answer: "提交申请" });
  const supplemental = knowledge("KB-403", { answer: "72小时后确认单作废" });
  const result = selectComplementaryKnowledge({
    query: "怎么处理，大概多少小时？", primary,
    candidates: [candidate(supplemental)], indexVersion: null,
  });
  assert.deepEqual(result.selected, []);
});

test("rejects near-duplicate knowledge that does not add an independent rule", () => {
  const primary = knowledge("KB-401", { title: "电子发票申请", answer: "提交申请后可下载电子发票，并可打印。" });
  const duplicate = knowledge("KB-405", { title: "电子发票下载", answer: "电子发票提交申请后可以下载，也可以打印。" });
  const result = selectComplementaryKnowledge({
    query: "电子发票怎么申请、下载和打印？", primary,
    candidates: [candidate(duplicate, { matchedKeywords: ["下载", "打印"] })], indexVersion: "idx-1",
  });
  assert.deepEqual(result.selected, []);
});

test("rejects a supplemental rule that conflicts with an explicit order state", () => {
  const primary = knowledge("KB-301", { answer: "地址修改需要先核验订单。" });
  const unshippedOnly = knowledge("KB-302", { answer: "订单未出库时可提交修改，通常当天处理。" });
  const result = selectComplementaryKnowledge({
    query: "订单已经出库，地址怎么改、多久处理？", primary,
    candidates: [candidate(unshippedOnly, { matchedKeywords: ["多久"] })], indexVersion: "idx-1",
  });
  assert.deepEqual(result.selected, []);
});
