import assert from "node:assert/strict";
import test from "node:test";
import { deriveFeedbackSignals } from "../lib/feedback-loop.ts";

test("derives auditable feedback signals without changing the answer path", () => {
  const signals = deriveFeedbackSignals({
    query: "还是不行，和刚才一样没有解决",
    previousUserQueries: ["退款什么时候到账？"],
    handoff: true,
    tool: { attempted: true, ok: false },
    knowledgeAvailable: true,
  });
  assert.deepEqual(signals.map((item) => item.code), ["tool_failure", "user_negative", "handoff"]);
});

test("recognizes repeated questions and knowledge gaps for offline review", () => {
  const signals = deriveFeedbackSignals({
    query: "退款大概什么时候到账",
    previousUserQueries: ["退款大概什么时候到账？"],
    knowledgeAvailable: false,
    failureCode: "NO_TRUSTWORTHY_RETRIEVAL",
  });
  assert.deepEqual(signals.map((item) => item.code), ["knowledge_gap", "repeat_question"]);
});

test("does not create feedback signals for a normal successful answer", () => {
  assert.deepEqual(deriveFeedbackSignals({
    query: "退款规则通常多久到账？",
    handoff: false,
    tool: { attempted: false, ok: null },
    knowledgeAvailable: true,
    userFeedback: "positive",
  }), []);
});
