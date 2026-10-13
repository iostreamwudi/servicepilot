import { sql } from "drizzle-orm";
import type { getDb } from "../db";

type KnowledgeSearchDb = ReturnType<typeof getDb>;

function toFtsQuery(value: string) {
  return value
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(" AND ");
}

/** Returns null only when the FTS table is unavailable; an empty array means no FTS hit. */
export async function searchKnowledgeIds(db: KnowledgeSearchDb, organizationId: string, query: string) {
  const match = toFtsQuery(query);
  if (!match) return [] as string[];
  try {
    const rows = await db.all<{ document_id: string }>(sql`
      SELECT document_id
      FROM knowledge_fts
      WHERE knowledge_fts MATCH ${match}
        AND organization_id = ${organizationId}
      ORDER BY rank
      LIMIT 40
    `);
    return rows.map((row) => row.document_id);
  } catch {
    return null;
  }
}

export async function syncKnowledgeSearchIndex(db: KnowledgeSearchDb, document: { id: string; organizationId: string; title: string; content: string; category: string; ownerTeam: string; sourceTitle?: string | null }) {
  try {
    await db.run(sql`DELETE FROM knowledge_fts WHERE document_id = ${document.id} AND organization_id = ${document.organizationId}`);
    await db.run(sql`INSERT INTO knowledge_fts (document_id, organization_id, title, content, category, owner_team, source_title) VALUES (${document.id}, ${document.organizationId}, ${document.title}, ${document.content}, ${document.category}, ${document.ownerTeam}, ${document.sourceTitle ?? ""})`);
    return true;
  } catch {
    return false;
  }
}

export { toFtsQuery };
