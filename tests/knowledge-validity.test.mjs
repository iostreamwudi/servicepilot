import test from "node:test";
import assert from "node:assert/strict";
import { knowledgeValidity } from "../lib/knowledge-validity.ts";

const now = Date.parse("2026-09-10T00:00:00.000Z");

test("knowledge validity distinguishes not started, current, current expiring, and expired windows", () => {
  assert.equal(knowledgeValidity(null, null, now), "unscheduled");
  assert.equal(knowledgeValidity("2026-09-11T00:00:00.000Z", null, now), "not_started");
  assert.equal(knowledgeValidity("2026-09-01T00:00:00.000Z", "2026-09-30T00:00:00.000Z", now), "current");
  assert.equal(knowledgeValidity(null, "2026-09-15T00:00:00.000Z", now), "expiring");
  assert.equal(knowledgeValidity(null, "2026-09-09T23:59:59.000Z", now), "expired");
});
