import type { ToolDecision } from "./tool-decision.ts";

export type AnswerReviewFinding = {
  code: "MISSING_REQUIRED_PARAMETER" | "TOOL_FAILURE_STATE_CLAIM" | "UNAUTHORIZED_ACTION_CLAIM" | "UNSUPPORTED_NUMERIC_CLAIM" | "UNSUPPORTED_CERTAINTY" | "TOOL_STATE_CONFLICT";
  severity: "warning" | "block";
  detail: string;
};

export type AnswerReviewResult = {
  answer: string;
  status: "passed" | "rewritten" | "blocked";
  findings: AnswerReviewFinding[];
  handoff: boolean;
};

const sentenceBoundary = /(?<=[。！？!?；;])/u;
const unauthorizedActionPattern = /(?:已经|已|刚刚)(?:为您|帮您)?(?:退款|退货|改址|修改地址|重开发票|作废发票|取消订单|赔付|补偿|补发|换货|维修|办理完成)/;
const certaintyPattern = /保证|百分之百|100%|一定会|肯定会|绝对会|今天一定|马上到账|立即到账/;
const liveStateClaimPattern = /退款状态(?:为|是)|退款(?:已经|已)?(?:完成|到账)|(?:已经|已)(?:审核通过|到账|原路退回|退款完成)|当前(?:正在处理|处理中|已完成)/;
const numericClaimPattern = /(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千万]+)(?:\s*[至到—–-]\s*(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千万]+))?\s*(?:个?工作日|天|小时|分钟|元|%)/g;

function normalizeEvidence(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[—–至到-]/g, "~").replace(/\s+/g, "").replace(/[，。！？、,.!?；;：:]/g, "");
}

function unsupportedNumericClaims(answer: string, evidence: string) {
  const normalizedEvidence = normalizeEvidence(evidence);
  return [...answer.matchAll(numericClaimPattern)]
    .map((match) => match[0])
    .filter((claim) => !normalizedEvidence.includes(normalizeEvidence(claim)));
}

function removeUnsafeSentences(answer: string, unsafePatterns: readonly RegExp[]) {
  const sentences = answer.split(sentenceBoundary).map((item) => item.trim()).filter(Boolean);
  const kept = sentences.filter((sentence) => !unsafePatterns.some((pattern) => pattern.test(sentence)));
  return kept.join("").trim();
}

function statusLabel(status: string | null | undefined) {
  return status === "approved" ? "已审核通过" : status === "processing" ? "处理中" : status === "completed" ? "已完成" : null;
}

/**
 * Reviews draft claims against the evidence envelope. It never consults an
 * evaluation label or a model, so the same policy applies to every request.
 */
export function reviewGroundedAnswer(input: {
  draft: string;
  knowledgeEvidence: readonly string[];
  toolDecision: ToolDecision | null;
  toolResult: { ok: boolean; record?: { status?: string } } | null;
  handoff: boolean;
}): AnswerReviewResult {
  const findings: AnswerReviewFinding[] = [];
  const evidence = [...input.knowledgeEvidence, input.toolResult?.ok ? JSON.stringify(input.toolResult.record ?? {}) : ""].join("；");

  if (input.toolDecision?.action === "request_parameter") {
    const hasOrderRequest = /订单号|OR-/.test(input.draft);
    if (!hasOrderRequest) findings.push({ code: "MISSING_REQUIRED_PARAMETER", severity: "block", detail: "实时事实查询缺少订单号追问" });
    return {
      answer: hasOrderRequest ? input.draft : "如需查询这笔退款的实时状态，请提供订单号（格式为 OR- 加 6 位数字）。在订单号核验前，我不会推测退款进度。",
      status: hasOrderRequest ? "passed" : "blocked",
      findings,
      handoff: input.handoff,
    };
  }

  if (input.toolDecision?.action === "invoke" && !input.toolResult?.ok) {
    if (liveStateClaimPattern.test(input.draft)) findings.push({ code: "TOOL_FAILURE_STATE_CLAIM", severity: "block", detail: "工具失败后草稿仍声明实时业务状态" });
    return {
      answer: "暂时无法核验这笔退款的实时状态。为避免根据不完整信息推测，我会请人工继续核查。",
      status: "blocked",
      findings: findings.length ? findings : [{ code: "TOOL_FAILURE_STATE_CLAIM", severity: "block", detail: "工具失败，使用固定安全降级" }],
      handoff: true,
    };
  }

  const unsafePatterns: RegExp[] = [];
  if (unauthorizedActionPattern.test(input.draft)) {
    findings.push({ code: "UNAUTHORIZED_ACTION_CLAIM", severity: "block", detail: "回答声称已执行未授权业务动作" });
    unsafePatterns.push(unauthorizedActionPattern);
  }
  if (certaintyPattern.test(input.draft)) {
    findings.push({ code: "UNSUPPORTED_CERTAINTY", severity: "warning", detail: "回答包含无法由证据支持的确定性承诺" });
    unsafePatterns.push(certaintyPattern);
  }
  const unsupportedNumbers = unsupportedNumericClaims(input.draft, evidence);
  if (unsupportedNumbers.length) {
    findings.push({ code: "UNSUPPORTED_NUMERIC_CLAIM", severity: "warning", detail: `数字或时效缺少证据：${unsupportedNumbers.join("、")}` });
    unsafePatterns.push(new RegExp(numericClaimPattern.source));
  }

  const expectedStatus = input.toolResult?.ok ? statusLabel(input.toolResult.record?.status) : null;
  const mentionedStatuses = ["已审核通过", "处理中", "已完成"].filter((item) => input.draft.includes(item));
  if (expectedStatus && mentionedStatuses.some((item) => item !== expectedStatus)) {
    findings.push({ code: "TOOL_STATE_CONFLICT", severity: "block", detail: "回答状态与只读工具结果冲突" });
    unsafePatterns.push(liveStateClaimPattern);
  }

  if (!findings.length) return { answer: input.draft, status: "passed", findings, handoff: input.handoff };
  const rewritten = removeUnsafeSentences(input.draft, unsafePatterns);
  const fallback = input.knowledgeEvidence[0]?.trim() || "我会依据已核验的信息继续为您处理。";
  return {
    answer: (rewritten || fallback).slice(0, 180),
    status: findings.some((item) => item.severity === "block") ? "blocked" : "rewritten",
    findings,
    handoff: input.handoff || findings.some((item) => item.severity === "block"),
  };
}
