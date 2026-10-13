export type FeedbackSignalCode =
  | "handoff"
  | "repeat_question"
  | "user_negative"
  | "tool_failure"
  | "knowledge_gap"
  | "policy_anomaly";

export type FeedbackSignal = {
  code: FeedbackSignalCode;
  severity: "low" | "medium" | "high";
  reason: string;
};

export type FeedbackLoopInput = {
  query: string;
  previousUserQueries?: readonly string[];
  handoff?: boolean;
  tool?: { attempted: boolean; ok: boolean | null } | null;
  knowledgeAvailable?: boolean;
  failureCode?: string | null;
  userFeedback?: "positive" | "negative" | null;
  policyVersionChanged?: boolean;
};

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?；;：:]/g, "");
}

function isRepeatedQuery(query: string, previous: readonly string[]) {
  const current = normalize(query);
  if (!current || current.length < 4) return false;
  return previous.some((item) => {
    const candidate = normalize(item);
    if (!candidate) return false;
    if (candidate === current) return true;
    if (current.length < 8 || candidate.length < 8) return false;
    const currentChars = new Set(current.split("").filter(Boolean));
    const candidateChars = new Set(candidate.split("").filter(Boolean));
    const overlap = [...currentChars].filter((char) => candidateChars.has(char)).length;
    return overlap / Math.max(currentChars.size, candidateChars.size) >= 0.82;
  });
}

/**
 * Produces review signals only. It never changes a route, answer, threshold,
 * knowledge document, or strategy version. A human or offline job can use the
 * signals to prioritize review; no signal is an automatic label or release.
 */
export function deriveFeedbackSignals(input: FeedbackLoopInput): FeedbackSignal[] {
  const signals: FeedbackSignal[] = [];
  const failure = input.failureCode ?? "";
  const negativeText = /不对|不准确|答非所问|没解决|还是不行|仍然不行|没用|不满意|错了|不是这个意思/.test(input.query);

  if (input.handoff) signals.push({ code: "handoff", severity: "medium", reason: "本轮已转人工，需回看转人工原因与最终业务结果" });
  if (isRepeatedQuery(input.query, input.previousUserQueries ?? [])) signals.push({ code: "repeat_question", severity: "high", reason: "当前问法与同一会话中的历史用户问法高度重复，可能表示上一轮未解决" });
  if (input.userFeedback === "negative" || negativeText) signals.push({ code: "user_negative", severity: "high", reason: "检测到显式负向反馈或用户否定表达" });
  if (input.tool?.attempted && input.tool.ok === false) signals.push({ code: "tool_failure", severity: "high", reason: "受控工具已调用但未返回可用事实" });
  if (input.knowledgeAvailable === false || /NO_TRUSTWORTHY_RETRIEVAL|RETRIEVAL_|KNOWLEDGE_NOT_FOUND/.test(failure)) {
    signals.push({ code: "knowledge_gap", severity: "high", reason: "当前请求没有可用知识证据，需进入知识缺口复核队列" });
  }
  if (input.policyVersionChanged) signals.push({ code: "policy_anomaly", severity: "medium", reason: "策略或知识版本发生变化，需观察新旧口径差异" });

  const severityOrder = { high: 0, medium: 1, low: 2 };
  return signals.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.code.localeCompare(b.code));
}
