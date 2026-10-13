import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, users } from "../db/schema";

export function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("x-servicepilot-auth-email")
    ?? request.headers.get("oai-authenticated-user-email")
    ?? ((host === "localhost" || host === "127.0.0.1") ? "local-demo@servicepilot.local" : null);
}

export async function actorFor(db: ReturnType<typeof getDb>, organizationId: string, email: string) {
  const [actor] = await db.select({ id: users.id, displayName: users.displayName, role: memberships.role })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, organizationId)))
    .where(eq(users.email, email))
    .limit(1);
  return actor ?? null;
}

export function isSupervisor(role?: string | null) {
  return role === "supervisor" || role === "system_admin" || role === "product_admin";
}
