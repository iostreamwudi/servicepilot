import type { ToolDecision } from "./tool-decision.ts";

export type KnowledgeEvidence = {
  id: string;
  title: string;
  version: string;
  content: string;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
};

export type JointEvidenceCitation = {
  id: string;
  title: string;
  version: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  evidenceType: "knowledge" | "tool";
};

export function buildJointEvidencePacket(input: {
  knowledge: readonly KnowledgeEvidence[];
  toolDecision: ToolDecision | null;
  toolResult: { ok: boolean; record?: Record<string, unknown> } | null;
}) {
  const knowledge = input.knowledge.slice(0, 2);
  const toolRecord = input.toolDecision?.action === "invoke" && input.toolResult?.ok ? input.toolResult.record ?? null : null;
  const sections = knowledge.map((item, index) => `[知识${index + 1}:${item.id}] ${item.title} ${item.version}\n${item.content}`);
  if (toolRecord) sections.push(`[只读工具:${input.toolDecision?.tool}] 实时业务事实\n${JSON.stringify(toolRecord)}`);
  const constraints = toolRecord
    ? "先区分知识中的通用规则与工具中的当前事实；当前状态只能引用工具结果，流程和条件只能引用知识，不得把两类证据改写成新的承诺。"
    : "当前只有知识证据；可以解释规则和流程，但不得声称已读取、修改或完成任何客户订单操作。";
  const citations: JointEvidenceCitation[] = knowledge.map((item) => ({
    id: item.id, title: item.title, version: item.version,
    sourceTitle: item.sourceTitle ?? null, sourceUrl: item.sourceUrl ?? null, evidenceType: "knowledge",
  }));
  if (toolRecord) citations.push({
    id: String(toolRecord.sourceId ?? input.toolDecision?.orderId ?? "order.refund.get"),
    title: "退款状态只读查询",
    version: String(toolRecord.dataFreshness ?? "current"),
    sourceTitle: "ServicePilot 订单退款只读工具",
    sourceUrl: null,
    evidenceType: "tool",
  });
  return {
    prompt: `可信证据包：\n${sections.join("\n\n")}\n\n回答约束：${constraints}`,
    citations,
    mode: toolRecord ? "knowledge+tool" as const : "knowledge-only" as const,
    evidenceCount: sections.length,
  };
}
