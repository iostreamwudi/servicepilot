import test from "node:test";
import assert from "node:assert/strict";
import { diffKnowledgeText } from "../lib/knowledge-diff.ts";

test("knowledge version diff marks changed lines and preserves unchanged context", () => {
  assert.deepEqual(diffKnowledgeText("退款需审核。\n1-3 个工作日到账。", "退款需审核。\n1-5 个工作日到账。"), [
    { type: "same", text: "退款需审核。" },
    { type: "removed", text: "1-3 个工作日到账。" },
    { type: "added", text: "1-5 个工作日到账。" },
  ]);
});
