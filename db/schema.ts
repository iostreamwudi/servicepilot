import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role", { enum: ["agent", "supervisor", "knowledge_operator", "quality_reviewer", "product_admin", "system_admin"] }).notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  customerName: text("customer_name").notNull(), topic: text("topic").notNull(), channel: text("channel").notNull(),
  status: text("status", { enum: ["ai_active", "needs_human", "human_active", "ticketed", "resolved"] }).notNull(),
  risk: text("risk", { enum: ["low", "medium", "high"] }).notNull(), aiScore: real("ai_score"),
  sentiment: text("sentiment").notNull().default("neutral"), assignedUserId: text("assigned_user_id").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(), conversationId: text("conversation_id").notNull().references(() => conversations.id),
  senderType: text("sender_type", { enum: ["customer", "agent", "ai", "system"] }).notNull(), content: text("content").notNull(),
  citationsJson: text("citations_json").notNull().default("[]"), toolTraceJson: text("tool_trace_json").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  conversationId: text("conversation_id").references(() => conversations.id), title: text("title").notNull(), customerName: text("customer_name").notNull(),
  priority: text("priority", { enum: ["P1", "P2", "P3"] }).notNull(), state: text("state", { enum: ["unassigned", "in_progress", "waiting_customer", "resolved", "closed"] }).notNull(),
  ownerUserId: text("owner_user_id").references(() => users.id), slaDueAt: text("sla_due_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const knowledgeDocuments = sqliteTable("knowledge_documents", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), title: text("title").notNull(),
  version: text("version").notNull(), ownerTeam: text("owner_team").notNull(), content: text("content").notNull(),
  state: text("state", { enum: ["draft", "review", "active", "archived"] }).notNull(), coverage: real("coverage").notNull().default(0),
  validFrom: text("valid_from"), validUntil: text("valid_until"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const qualityReviews = sqliteTable("quality_reviews", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id), status: text("status", { enum: ["pending", "confirmed", "appealed"] }).notNull(),
  risk: text("risk", { enum: ["low", "medium", "high"] }).notNull(), autoScore: real("auto_score").notNull(), humanScore: real("human_score"),
  failureCategory: text("failure_category"), reviewerUserId: text("reviewer_user_id").references(() => users.id), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const strategyVersions = sqliteTable("strategy_versions", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), version: text("version").notNull(),
  state: text("state", { enum: ["draft", "pending_approval", "active", "rolled_back"] }).notNull(), configJson: text("config_json").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id), approvedByUserId: text("approved_by_user_id").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), actorUserId: text("actor_user_id").references(() => users.id),
  actorType: text("actor_type", { enum: ["user", "agent", "system"] }).notNull(), action: text("action").notNull(), resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(), result: text("result", { enum: ["allowed", "blocked", "failed"] }).notNull(),
  risk: text("risk", { enum: ["low", "medium", "high"] }).notNull(), metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const evaluationRuns = sqliteTable("evaluation_runs", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  model: text("model").notNull(), datasetVersion: text("dataset_version").notNull(),
  status: text("status", { enum: ["running", "completed", "failed"] }).notNull(),
  totalCases: integer("total_cases").notNull(), passedCases: integer("passed_cases").notNull().default(0),
  passRate: real("pass_rate").notNull().default(0), highRiskPassRate: real("high_risk_pass_rate").notNull().default(0),
  averageLatencyMs: real("average_latency_ms").notNull().default(0),
  startedAt: text("started_at").notNull(), completedAt: text("completed_at"),
});

export const evaluationResults = sqliteTable("evaluation_results", {
  id: text("id").primaryKey(), runId: text("run_id").notNull().references(() => evaluationRuns.id),
  caseId: text("case_id").notNull(), category: text("category").notNull(), query: text("query").notNull(),
  passed: integer("passed", { mode: "boolean" }).notNull(), expectedSource: text("expected_source"), actualSource: text("actual_source"),
  expectedHandoff: integer("expected_handoff", { mode: "boolean" }).notNull(), actualHandoff: integer("actual_handoff", { mode: "boolean" }).notNull(),
  latencyMs: integer("latency_ms").notNull(), mode: text("mode").notNull(), failuresJson: text("failures_json").notNull().default("[]"),
  answer: text("answer").notNull(), sourceDataset: text("source_dataset").notNull().default("ServicePilot synthetic seed"),
  sourceRecordId: text("source_record_id"), contextRequired: integer("context_required", { mode: "boolean" }).notNull().default(false),
  historyJson: text("history_json").notNull().default("[]"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
