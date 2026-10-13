import { createHash } from "node:crypto";
import fs from "node:fs/promises";

const inputPath = process.argv[2];
const organizationId = process.env.SERVICEPILOT_ORG_ID ?? "org-qingyu";
if (!inputPath) throw new Error("Usage: node scripts/import-embedding-index.mjs <index.json>");
const index = JSON.parse(await fs.readFile(inputPath, "utf8"));
if (!index.model || !Array.isArray(index.records) || !index.records.length) throw new Error("INVALID_EMBEDDING_INDEX");
const indexVersion = index.generatedAt ?? `index-${createHash("sha256").update(JSON.stringify(index.records.map((row) => [row.id, row.version]))).digest("hex").slice(0, 12)}`;
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const statements = [];
for (const record of index.records) {
  if (!record.id || !record.version || !Array.isArray(record.vector) || !record.vector.length || !record.vector.every(Number.isFinite)) throw new Error(`INVALID_EMBEDDING_RECORD:${record.id ?? "unknown"}`);
  const vectorJson = JSON.stringify(record.vector);
  const contentHash = createHash("sha256").update(vectorJson).digest("hex");
  const id = `${organizationId}:${index.model}:${record.id}:${record.version}`;
  statements.push(`INSERT OR REPLACE INTO knowledge_embeddings (id, organization_id, document_id, model, dimensions, vector_json, content_hash, document_version, index_version, active) VALUES (${quote(id)}, ${quote(organizationId)}, ${quote(record.id)}, ${quote(index.model)}, ${record.vector.length}, ${quote(vectorJson)}, ${quote(contentHash)}, ${quote(record.version)}, ${quote(indexVersion)}, 0);`);
}
const pointerId = `${organizationId}:${index.model}`;
statements.push(`INSERT OR REPLACE INTO embedding_index_versions (id, organization_id, model, current_index_version, updated_at) VALUES (${quote(pointerId)}, ${quote(organizationId)}, ${quote(index.model)}, ${quote(indexVersion)}, CURRENT_TIMESTAMP);`);
statements.push(`UPDATE knowledge_embeddings SET active = CASE WHEN index_version = ${quote(indexVersion)} THEN 1 ELSE 0 END WHERE organization_id = ${quote(organizationId)} AND model = ${quote(index.model)};`);
process.stdout.write(`${statements.join("\n")}\n`);
