import fs from "node:fs/promises";

const appBaseUrl = process.env.SERVICEPILOT_APP_URL ?? "http://127.0.0.1:3000";
const varsPath = process.env.SERVICEPILOT_VARS ?? "/app/deploy/.dev.vars";
const outputPath = process.env.SERVICEPILOT_EMBEDDING_OUTPUT ?? "/data/knowledge-embeddings-qwen3.7-text-embedding.json";
const model = process.env.EMBEDDING_MODEL ?? "qwen3.7-text-embedding";
const batchSize = Number(process.env.EMBEDDING_BATCH_SIZE ?? 16);

function readKey(text) {
  const line = text.split(/\r?\n/).find((item) => item.startsWith("LLM_API_KEY="));
  return line?.slice("LLM_API_KEY=".length).trim() ?? "";
}

async function fetchKnowledge() {
  const documents = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${appBaseUrl}/api/knowledge?state=active&limit=100&offset=${offset}`, { headers: { "oai-authenticated-user-email": "embedding-indexer@servicepilot.local", "x-servicepilot-environment": "test", "x-servicepilot-channel": "customer-demo" } });
    if (!response.ok) throw new Error(`KNOWLEDGE_HTTP_${response.status}`);
    const payload = await response.json();
    documents.push(...(payload.documents ?? []));
    if (documents.length >= payload.total || !(payload.documents ?? []).length) return documents;
  }
}

async function main() {
  const apiKey = readKey(await fs.readFile(varsPath, "utf8"));
  if (!apiKey) throw new Error("LLM_API_KEY_MISSING");
  const documents = await fetchKnowledge();
  const records = [];
  for (let start = 0; start < documents.length; start += batchSize) {
    const batch = documents.slice(start, start + batchSize);
    const input = batch.map((document) => `${document.title}\n${document.content}\n关键词：${(document.keywords ?? []).join("、")}`);
    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, input }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message ?? `EMBEDDING_HTTP_${response.status}`);
    const vectors = (payload.data ?? []).sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
    if (vectors.length !== batch.length) throw new Error("EMBEDDING_COUNT_MISMATCH");
    batch.forEach((document, index) => records.push({ id: document.id, category: document.category, version: document.version, sourceType: document.sourceType, vector: vectors[index].embedding }));
    process.stdout.write(`embedded ${Math.min(start + batch.length, documents.length)}/${documents.length}\n`);
  }
  await fs.writeFile(outputPath, JSON.stringify({ model, generatedAt: new Date().toISOString(), count: records.length, records }));
  process.stdout.write(`wrote ${outputPath}\n`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
