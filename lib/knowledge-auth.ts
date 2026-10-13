import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { knowledgeDocuments } from "../db/schema";
import { actorFor, authenticatedEmail } from "./request-auth";
import { tenantIdForRequest } from "./tenant";

export const KNOWLEDGE_ROLES = ["agent", "supervisor", "knowledge_operator", "ai_operator", "product_admin", "system_admin"] as const;
export const KNOWLEDGE_EDITOR_ROLES = ["knowledge_operator", "supervisor", "product_admin", "system_admin"] as const;
export const KNOWLEDGE_PUBLISHER_ROLES = ["supervisor", "product_admin", "system_admin"] as const;

type KnowledgeAuth = {
  db: ReturnType<typeof getDb>;
  organizationId: string;
  email: string;
  actor: { id: string; displayName: string; role: string };
};

export async function requireKnowledgeActor(request: Request, roles: readonly string[] = KNOWLEDGE_ROLES): Promise<{ context: KnowledgeAuth } | { response: Response }> {
  const email = authenticatedEmail(request);
  if (!email) return { response: Response.json({ error: "Authentication required" }, { status: 401 }) };
  const db = getDb();
  const organizationId = tenantIdForRequest(request);
  const actor = await actorFor(db, organizationId, email);
  if (!actor) return { response: Response.json({ error: "当前账号没有该工作空间的知识权限" }, { status: 403 }) };
  if (!roles.includes(actor.role)) return { response: Response.json({ error: "当前角色无权访问该知识资源" }, { status: 403 }) };
  return { context: { db, organizationId, email, actor } };
}

export function canReadKnowledgeState(role: string, state: string) {
  return (role !== "agent" && role !== "ai_operator") || state === "active";
}

export async function findReadableKnowledge(db: ReturnType<typeof getDb>, organizationId: string, role: string, id: string) {
  const [document] = await db.select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.organizationId, organizationId))).limit(1);
  if (!document || !canReadKnowledgeState(role, document.state)) return null;
  return document;
}
