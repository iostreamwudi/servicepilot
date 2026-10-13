import assert from "node:assert/strict";
import test from "node:test";
import { buildChatCompletionRequest } from "../lib/model-gateway.ts";

const messages = [{ role: "user", content: "你好" }];

test("uses GLM-5.2 non-thinking mode without overriding provider sampling defaults", () => {
  const request = buildChatCompletionRequest("glm-5.2", messages);
  assert.equal(request.enable_thinking, false);
  assert.equal("temperature" in request, false);
});

test("keeps the established sampling behavior for non-GLM models", () => {
  const request = buildChatCompletionRequest("qwen3.7-plus", messages);
  assert.equal(request.temperature, 0.1);
  assert.equal("enable_thinking" in request, false);
});

test("omits unsupported temperature for kimi-k3", () => {
  const request = buildChatCompletionRequest("kimi-k3", messages);
  assert.equal("temperature" in request, false);
});
