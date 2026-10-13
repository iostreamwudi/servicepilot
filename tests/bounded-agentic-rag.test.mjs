import assert from "node:assert/strict";
import test from "node:test";
import { BoundedAgenticRun } from "../lib/bounded-agentic-rag.ts";

test("permits one bounded evidence-tool-generation-review path", () => {
  const run = new BoundedAgenticRun({ startedAt: 100, timeoutMs: 1000 });
  assert.equal(run.enter("retrieval", undefined, 110), true);
  assert.equal(run.enter("tool-decision", undefined, 120), true);
  assert.equal(run.enter("tool", "tool", 130), true);
  assert.equal(run.enter("evidence", undefined, 140), true);
  assert.equal(run.enter("generation", "model", 150), true);
  assert.equal(run.enter("review", undefined, 160), true);
  assert.deepEqual(run.snapshot().steps, ["retrieval", "tool-decision", "tool", "evidence", "generation", "review"]);
});

test("denies a second tool or model call instead of looping", () => {
  const tools = new BoundedAgenticRun({ startedAt: 0, timeoutMs: 1000 });
  assert.equal(tools.enter("tool", "tool", 1), true);
  assert.equal(tools.enter("tool", "tool", 2), false);
  assert.equal(tools.snapshot().exhaustedReason, "tool_limit");

  const models = new BoundedAgenticRun({ startedAt: 0, timeoutMs: 1000 });
  assert.equal(models.enter("generation", "model", 1), true);
  assert.equal(models.enter("generation", "model", 2), false);
  assert.equal(models.snapshot().exhaustedReason, "model_limit");
});

test("denies new work after the hard deadline", () => {
  const run = new BoundedAgenticRun({ startedAt: 100, timeoutMs: 50 });
  assert.equal(run.enter("retrieval", undefined, 150), false);
  assert.equal(run.snapshot().exhaustedReason, "deadline");
});
