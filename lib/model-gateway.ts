export type ChatMessage = { role: string; content: string };

export function buildChatCompletionRequest(model: string, messages: readonly ChatMessage[]) {
  const request: Record<string, unknown> = { model, messages };
  if (/^glm-5\.2(?:$|-)/i.test(model)) {
    // GLM-5.2 defaults to reasoning. Customer-service answers use the
    // documented non-thinking mode and otherwise retain provider defaults.
    request.enable_thinking = false;
  } else if (!/^kimi-k3(?:$|-)/i.test(model)) {
    request.temperature = 0.1;
  }
  return request;
}
