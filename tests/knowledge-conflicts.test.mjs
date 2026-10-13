import test from "node:test";
import assert from "node:assert/strict";
import { detectKnowledgeConflicts } from "../lib/knowledge-conflicts.ts";

test("knowledge conflict detection flags exact duplicates and divergent timing claims", () => {
  const existing = [{ id: "KB-114", title: "退款到账时效", category: "refund", content: "审核后1-3个工作日到账。" }];
  assert.equal(detectKnowledgeConflicts({ title: "退款到账时效", category: "refund", content: "审核后1-3个工作日到账。" }, existing)[0].kind, "duplicate");
  assert.equal(detectKnowledgeConflicts({ title: "退款到账说明", category: "refund", content: "审核后1-5个工作日到账，请耐心等待。" }, existing)[0].kind, "conflict");
  assert.equal(detectKnowledgeConflicts({ title: "地址改址", category: "address", content: "出库前可申请改址。" }, existing).length, 0);
});
