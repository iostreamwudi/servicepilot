import { env } from "cloudflare:workers";

type RuntimeConfig = { LLM_API_KEY?: string; LLM_BASE_URL?: string; LLM_MODEL?: string };

export async function GET() {
  const config = env as unknown as RuntimeConfig;
  const traceId = crypto.randomUUID();
  if (!config.LLM_API_KEY || !config.LLM_BASE_URL || !config.LLM_MODEL) return Response.json({ ok: false, traceId, failureCode: "MODEL_CONFIG_INCOMPLETE", model: config.LLM_MODEL ?? null }, { status: 503, headers: { "x-trace-id": traceId } });
  const started = Date.now();
  try {
    const baseUrl = config.LLM_BASE_URL.replace(/\/$/, "");
    let response = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${config.LLM_API_KEY}` }, signal: AbortSignal.timeout(8_000) });
    let probe = "models";
    // Agent Plan exposes chat completions but may not expose the OpenAI
    // model-list endpoint. A one-token probe verifies the configured model
    // without treating a provider-specific /models 404 as an outage.
    if (response.status === 404) {
      probe = "chat-completions";
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.LLM_API_KEY}` },
        body: JSON.stringify({ model: config.LLM_MODEL, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
        signal: AbortSignal.timeout(8_000),
      });
    }
    return Response.json({ ok: response.ok, traceId, model: config.LLM_MODEL, baseUrl: config.LLM_BASE_URL, probe, status: response.status, latencyMs: Date.now() - started, failureCode: response.ok ? null : "MODEL_HEALTH_HTTP_ERROR" }, { status: response.ok ? 200 : 503, headers: { "x-trace-id": traceId } });
  } catch (error) {
    return Response.json({ ok: false, traceId, model: config.LLM_MODEL, baseUrl: config.LLM_BASE_URL, latencyMs: Date.now() - started, failureCode: error instanceof Error && error.name === "TimeoutError" ? "MODEL_HEALTH_TIMEOUT" : "MODEL_HEALTH_UNREACHABLE" }, { status: 503, headers: { "x-trace-id": traceId } });
  }
}
