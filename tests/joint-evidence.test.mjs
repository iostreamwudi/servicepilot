import assert from "node:assert/strict";
import test from "node:test";
import { buildJointEvidencePacket } from "../lib/joint-evidence.ts";

const knowledge = [{ id: "KB-114", title: "退款规则", version: "v1", content: "审核通过后原路退回。", sourceTitle: "退款SOP", sourceUrl: null }];

test("keeps a knowledge-only packet when no live fact is authorized", () => {
  const packet = buildJointEvidencePacket({ knowledge, toolDecision: null, toolResult: null });
  assert.equal(packet.mode, "knowledge-only");
  assert.equal(packet.evidenceCount, 1);
  assert.match(packet.prompt, /不得声称已读取、修改或完成/);
  assert.deepEqual(packet.citations.map((item) => item.evidenceType), ["knowledge"]);
});

test("combines one governed knowledge rule with a successful read-only tool result", () => {
  const decision = { action: "invoke", tool: "order.refund.get", orderId: "OR-123456", missingParameters: [], reason: "实时查询", readOnly: true };
  const packet = buildJointEvidencePacket({
    knowledge,
    toolDecision: decision,
    toolResult: { ok: true, record: { status: "processing", sourceId: "RF-1", dataFreshness: "2026-08-24T09:00:00Z" } },
  });
  assert.equal(packet.mode, "knowledge+tool");
  assert.equal(packet.evidenceCount, 2);
  assert.match(packet.prompt, /通用规则与工具中的当前事实/);
  assert.deepEqual(packet.citations.map((item) => item.evidenceType), ["knowledge", "tool"]);
  assert.equal(packet.citations[1].id, "RF-1");
});

test("does not include an unavailable tool result as evidence", () => {
  const decision = { action: "invoke", tool: "order.refund.get", orderId: "OR-123456", missingParameters: [], reason: "实时查询", readOnly: true };
  const packet = buildJointEvidencePacket({ knowledge, toolDecision: decision, toolResult: { ok: false } });
  assert.equal(packet.mode, "knowledge-only");
  assert.equal(packet.citations.some((item) => item.evidenceType === "tool"), false);
});
