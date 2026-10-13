export type EmbeddingConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

type EmbeddingResponse = {
  data?: Array<{ embedding?: unknown; index?: number }>;
  error?: { message?: string };
};

export function normalizeEmbedding(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const vector = value.map((item) => typeof item === "number" && Number.isFinite(item) ? item : NaN);
  return vector.every(Number.isFinite) ? vector : null;
}

export async function createEmbeddings(inputs: string[], config: EmbeddingConfig): Promise<number[][]> {
  if (!inputs.length) return [];
  if (!config.apiKey) throw new Error("EMBEDDING_API_KEY_MISSING");
  const fetcher = config.fetcher ?? fetch;
  const response = await fetcher(`${config.baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, input: inputs }),
    signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
  });
  const payload = await response.json() as EmbeddingResponse;
  if (!response.ok) throw new Error(payload.error?.message || `EMBEDDING_HTTP_${response.status}`);
  const vectors = (payload.data ?? []).sort((left, right) => (left.index ?? 0) - (right.index ?? 0)).map((item) => normalizeEmbedding(item.embedding));
  if (vectors.length !== inputs.length || vectors.some((vector): vector is null => vector === null)) throw new Error("EMBEDDING_INVALID_RESPONSE");
  return vectors as number[][];
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}
