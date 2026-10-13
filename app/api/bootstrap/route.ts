import { and, count, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, conversations, knowledgeDocuments, memberships, organizations, qualityReviews, strategyVersions, tickets, users } from "../../../db/schema";
import { tenantIdForRequest } from "../../../lib/tenant";
import knowledgeSeed from "../../../data/knowledge-seed.json";
import knowledgeCorpus from "../../../data/knowledge-official-corpus.json";
import generatedKnowledge from "../../../data/generated/2026-08-18/generated-knowledge.json";
import { slaPolicyForRisk } from "../../../lib/conversation-sla";
import { syncKnowledgeSearchIndex } from "../../../lib/knowledge-search";

const KNOWLEDGE_SEED_AUDIT_ID = `A-KB-${knowledgeSeed.version}-${knowledgeCorpus.version}`.replace(/[^A-Za-z0-9-]/g, "-");
const GENERATED_KNOWLEDGE_AUDIT_ID = "A-KB-SYNTHETIC-2026-08-18";

function actorFrom(request: Request) {
  const email = request.headers.get("x-servicepilot-auth-email") ?? request.headers.get("oai-authenticated-user-email");
  const host = new URL(request.url).hostname;
  if (email) return { email, displayName: email.split("@")[0] };
  if (host === "localhost" || host === "127.0.0.1") return { email: "local-demo@servicepilot.local", displayName: "本地演示用户" };
  return null;
}

export async function POST(request: Request) {
  const actor = actorFrom(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    const db = getDb();
    const ORG_ID = tenantIdForRequest(request);
    const isTestTenant = ORG_ID === "org-qingyu";
    const seedNow = new Date().toISOString();
    const seedMediumSla = new Date(Date.now() + slaPolicyForRisk("medium").minutes * 60_000).toISOString();
    const seedHighSla = new Date(Date.now() + slaPolicyForRisk("high").minutes * 60_000).toISOString();
    const initialRole = actor.email.toLowerCase() === "wang.ruifeng@qingyu.cn" ? "product_admin" as const : "agent" as const;
    const existing = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, ORG_ID)).limit(1);
    const userId = `${ORG_ID}-user-${actor.email.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    let actorUserId = userId;
    if (!existing.length) {
      await db.insert(organizations).values({ id: ORG_ID, name: isTestTenant ? "青屿商城测试租户" : "青屿商城生产租户" });
      await db.insert(users).values({ id: userId, email: actor.email, displayName: actor.displayName });
      await db.insert(memberships).values({ id: `membership-${userId}`, organizationId: ORG_ID, userId, role: initialRole });
      if (isTestTenant) await db.insert(conversations).values([
        { id: "C-28471", organizationId: ORG_ID, customerName: "林女士", topic: "退款进度查询", channel: "商城 App", status: "needs_human", risk: "medium", priority: "P2", slaPolicy: slaPolicyForRisk("medium").id, slaStartedAt: seedNow, slaDueAt: seedMediumSla, riskSource: "Agent 风险策略命中人工接管", aiScore: 0.72, sentiment: "anxious" },
        { id: "C-28469", organizationId: ORG_ID, customerName: "周先生", topic: "物流改址", channel: "微信小程序", status: "ai_active", risk: "low", priority: "P3", slaPolicy: slaPolicyForRisk("low").id, riskSource: "Agent 知识置信度与业务风险评估", aiScore: 0.94, sentiment: "neutral" },
        { id: "C-28463", organizationId: ORG_ID, customerName: "陈女士", topic: "商品破损理赔", channel: "商城 App", status: "ticketed", risk: "high", priority: "P1", slaPolicy: slaPolicyForRisk("high").id, slaStartedAt: seedNow, slaDueAt: seedHighSla, riskSource: "Agent 风险策略命中人工接管", aiScore: 0.61, sentiment: "dissatisfied" },
      ]);
      if (isTestTenant) await db.insert(tickets).values([
        { id: "T-9034", organizationId: ORG_ID, conversationId: "C-28463", title: "生鲜破损理赔", customerName: "陈女士", priority: "P1", state: "in_progress", slaDueAt: new Date(Date.now() + 18 * 60_000).toISOString() },
        { id: "T-9032", organizationId: ORG_ID, conversationId: "C-28471", title: "退款到账异常", customerName: "林女士", priority: "P1", state: "unassigned", slaDueAt: new Date(Date.now() + 36 * 60_000).toISOString() },
      ]);
      if (isTestTenant) await db.insert(qualityReviews).values({ id: "QR-1021", organizationId: ORG_ID, conversationId: "C-28463", status: "pending", risk: "high", autoScore: 0.67, failureCategory: "business_rule" });
      if (isTestTenant) await db.insert(strategyVersions).values({ id: "SV-27", organizationId: ORG_ID, version: "v2.7", state: "active", configJson: JSON.stringify({ requireHumanForHighRisk: true, lowConfidenceThreshold: 0.72, requireCitation: true }), createdByUserId: userId, approvedByUserId: userId });
      await db.insert(auditLogs).values({ id: `A-BOOTSTRAP-${ORG_ID}`, organizationId: ORG_ID, actorUserId: userId, actorType: "user", action: "workspace.bootstrap", resourceType: "organization", resourceId: ORG_ID, result: "allowed", risk: "low", metadataJson: JSON.stringify({ source: isTestTenant ? "test_seed" : "production_empty_tenant" }) });
    } else {
      const knownUser = await db.select({ id: users.id }).from(users).where(eq(users.email, actor.email)).limit(1);
      if (!knownUser.length) {
        return Response.json({ error: "当前账号尚未加入该工作空间，请联系管理员邀请" }, { status: 403 });
      }
      // Existing users may have been created before the tenant-prefixed ID format.
      // Always resolve roles and audit ownership through the persisted user ID.
      actorUserId = knownUser[0].id;
    }
    const seeded = isTestTenant ? await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, KNOWLEDGE_SEED_AUDIT_ID)).limit(1) : [];
    if (isTestTenant && !seeded.length) for (const document of [...knowledgeSeed.documents, ...knowledgeCorpus.documents]) {
      const values = {
        id: document.id,
        organizationId: ORG_ID,
        title: document.title,
        version: document.version,
        ownerTeam: document.ownerTeam,
        content: document.content,
        category: document.category as "refund" | "damage" | "address" | "invoice",
        keywordsJson: JSON.stringify(document.keywords),
        risk: document.risk as "low" | "medium" | "high",
        handoff: document.handoff,
        sourceType: document.sourceType as "official" | "internal_demo",
        sourceTitle: document.sourceTitle,
        sourceUrl: document.sourceUrl,
        state: document.state as "draft" | "review" | "active" | "archived",
        coverage: document.coverage,
        updatedAt: new Date().toISOString(),
      };
      await db.insert(knowledgeDocuments).values(values).onConflictDoUpdate({
        target: knowledgeDocuments.id,
        set: values,
      });
      await syncKnowledgeSearchIndex(db, values);
    }
    if (isTestTenant && !seeded.length) await db.insert(auditLogs).values({
      id: KNOWLEDGE_SEED_AUDIT_ID,
      organizationId: ORG_ID,
      actorUserId: userId,
      actorType: "system",
      action: "knowledge.corpus.import",
      resourceType: "knowledge_corpus",
      resourceId: knowledgeCorpus.corpusSha256,
      result: "allowed",
      risk: "low",
      metadataJson: JSON.stringify({ curated: knowledgeSeed.documents.length, officialReview: knowledgeCorpus.documents.length, sources: knowledgeCorpus.sources.length }),
    });
    const generatedSeeded = isTestTenant ? await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, GENERATED_KNOWLEDGE_AUDIT_ID)).limit(1) : [];
    if (isTestTenant && !generatedSeeded.length) for (const document of generatedKnowledge) {
      const values = {
        id: document.id,
        organizationId: ORG_ID,
        title: document.title,
        version: document.version,
        ownerTeam: document.ownerTeam,
        content: document.content,
        category: document.category as "refund" | "damage" | "address" | "invoice",
        keywordsJson: JSON.stringify(document.keywords),
        risk: document.risk as "low" | "medium" | "high",
        handoff: document.handoff,
        sourceType: "generated-internal-review" as const,
        sourceTitle: document.sourceTitle,
        sourceUrl: null,
        state: document.state as "draft" | "review" | "active" | "archived",
        coverage: document.coverage,
        validFrom: document.validFrom,
        validUntil: document.validUntil,
        isSynthetic: true,
        updatedAt: new Date().toISOString(),
      };
      await db.insert(knowledgeDocuments).values(values).onConflictDoUpdate({ target: knowledgeDocuments.id, set: values });
      await syncKnowledgeSearchIndex(db, values);
    }
    if (isTestTenant && !generatedSeeded.length) await db.insert(auditLogs).values({
      id: GENERATED_KNOWLEDGE_AUDIT_ID,
      organizationId: ORG_ID,
      actorUserId: null,
      actorType: "system",
      action: "knowledge.generated_corpus.import",
      resourceType: "knowledge_corpus",
      resourceId: "generated-2026-08-18",
      result: "allowed",
      risk: "low",
      metadataJson: JSON.stringify({ documents: generatedKnowledge.length, tenant: ORG_ID, state: "review", isSynthetic: true }),
    });
    const roleRows = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.organizationId, ORG_ID), eq(memberships.userId, actorUserId)));
    const [conversationCount] = await db.select({ value: count() }).from(conversations).where(eq(conversations.organizationId, ORG_ID));
    const [ticketCount] = await db.select({ value: count() }).from(tickets).where(eq(tickets.organizationId, ORG_ID));
    const [knowledgeCount] = await db.select({ value: count() }).from(knowledgeDocuments).where(eq(knowledgeDocuments.organizationId, ORG_ID));
    const [reviewCount] = await db.select({ value: count() }).from(qualityReviews).where(eq(qualityReviews.organizationId, ORG_ID));
    return Response.json({ workspace: { id: ORG_ID, name: isTestTenant ? "青屿商城测试租户" : "青屿商城生产租户" }, actor: { ...actor, roles: roleRows.map((item) => item.role) }, counts: { conversations: conversationCount.value, tickets: ticketCount.value, knowledge: knowledgeCount.value, reviews: reviewCount.value }, mode: isTestTenant ? "persistent-test" : "persistent-production" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected database error" }, { status: 500 });
  }
}
