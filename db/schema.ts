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
  resolutionCategory: text("resolution_category"), resolutionSummary: text("resolution_summary"), customerConfirmed: integer("customer_confirmed", { mode: "boolean" }), resolvedByEmail: text("resolved_by_email"), resolvedAt: text("resolved_at"),
  reopenCount: integer("reopen_count").notNull().default(0), lastReopenedAt: text("last_reopened_at"), lastReopenedByEmail: text("last_reopened_by_email"), lastReopenReason: text("last_reopen_reason"),
  priority: text("priority", { enum: ["P1", "P2", "P3"] }), slaPolicy: text("sla_policy"), slaStartedAt: text("sla_started_at"), slaDueAt: text("sla_due_at"), riskSource: text("risk_source"),
  traceId: text("trace_id"), sourceType: text("source_type").notNull().default("production"), sourceId: text("source_id"), isSynthetic: integer("is_synthetic", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(), conversationId: text("conversation_id").notNull().references(() => conversations.id),
  senderType: text("sender_type", { enum: ["customer", "agent", "ai", "system"] }).notNull(), content: text("content").notNull(),
  citationsJson: text("citations_json").notNull().default("[]"), toolTraceJson: text("tool_trace_json").notNull().default("[]"),
  traceId: text("trace_id"), sourceType: text("source_type").notNull().default("production"), sourceId: text("source_id"), isSynthetic: integer("is_synthetic", { mode: "boolean" }).notNull().default(false), failureCode: text("failure_code"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const agentConversationStates = sqliteTable("agent_conversation_states", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  conversationId: text("conversation_id").notNull().unique(), activeIntent: text("active_intent"),
  summary: text("summary").notNull().default(""), stateJson: text("state_json").notNull().default("{}"), lastUserMessage: text("last_user_message").notNull().default(""),
  turnCount: integer("turn_count").notNull().default(0), expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  conversationId: text("conversation_id").references(() => conversations.id), title: text("title").notNull(), customerName: text("customer_name").notNull(),
  priority: text("priority", { enum: ["P1", "P2", "P3"] }).notNull(), state: text("state", { enum: ["unassigned", "in_progress", "waiting_customer", "resolved", "closed"] }).notNull(),
  ownerUserId: text("owner_user_id").references(() => users.id), teamKey: text("team_key"), slaStartedAt: text("sla_started_at"), slaDueAt: text("sla_due_at").notNull(), firstResponseAt: text("first_response_at"), resolvedAt: text("resolved_at"), closedAt: text("closed_at"),
  resolutionCategory: text("resolution_category"), resolutionSummary: text("resolution_summary"), reopenCount: integer("reopen_count").notNull().default(0), lastReopenReason: text("last_reopen_reason"),
  triggerReason: text("trigger_reason"), summary: text("summary"), createRequestId: text("create_request_id").unique(), sourceType: text("source_type").notNull().default("production"), sourceId: text("source_id"), traceId: text("trace_id"), isSynthetic: integer("is_synthetic", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ticketSavedViews = sqliteTable("ticket_saved_views", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  name: text("name").notNull(), scope: text("scope", { enum: ["personal", "team"] }).notNull().default("personal"), teamKey: text("team_key"),
  filter: text("filter").notNull().default("all"), view: text("view").notNull().default("all"), ownerFilter: text("owner_filter").notNull().default(""), teamFilter: text("team_filter").notNull().default(""), sort: text("sort").notNull().default("updated"), query: text("query").notNull().default(""), openOnly: integer("open_only", { mode: "boolean" }).notNull().default(false), isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ticketExportJobs = sqliteTable("ticket_export_jobs", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), actorUserId: text("actor_user_id").notNull().references(() => users.id),
  mode: text("mode", { enum: ["filtered"] }).notNull(), filtersJson: text("filters_json").notNull().default("{}"), status: text("status", { enum: ["queued", "ready", "failed"] }).notNull().default("queued"),
  rowCount: integer("row_count").notNull().default(0), fileName: text("file_name").notNull(), content: text("content"), error: text("error"), expiresAt: text("expires_at").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), customerName: text("customer_name").notNull(), status: text("status").notNull(), totalAmount: real("total_amount").notNull(), paymentChannelMasked: text("payment_channel_masked"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), orderId: text("order_id").notNull().references(() => orders.id), status: text("status").notNull(), approvedAt: text("approved_at"), expectedBusinessDays: text("expected_business_days"), amount: real("amount"), sourceType: text("source_type").notNull().default("production"), sourceId: text("source_id"), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shipments = sqliteTable("shipments", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), orderId: text("order_id").notNull().references(() => orders.id), status: text("status").notNull(), carrier: text("carrier"), trackingNumberMasked: text("tracking_number_masked"), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const customerProfiles = sqliteTable("customer_profiles", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), customerName: text("customer_name").notNull(), tier: text("tier"), orderCount: integer("order_count").notNull().default(0), lifetimeValue: real("lifetime_value").notNull().default(0), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const knowledgeDocuments = sqliteTable("knowledge_documents", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), title: text("title").notNull(),
  version: text("version").notNull(), ownerTeam: text("owner_team").notNull(), ownerUserId: text("owner_user_id").references(() => users.id), content: text("content").notNull(),
  category: text("category", { enum: ["refund", "damage", "address", "invoice"] }).notNull().default("refund"),
  keywordsJson: text("keywords_json").notNull().default("[]"),
  risk: text("risk", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
  handoff: integer("handoff", { mode: "boolean" }).notNull().default(false),
  sourceType: text("source_type", { enum: ["official", "internal_demo", "generated-internal-review"] }).notNull().default("internal_demo"),
  sourceTitle: text("source_title"), sourceUrl: text("source_url"),
  state: text("state", { enum: ["draft", "review", "active", "archived"] }).notNull(), coverage: real("coverage").notNull().default(0),
  validFrom: text("valid_from"), validUntil: text("valid_until"), isSynthetic: integer("is_synthetic", { mode: "boolean" }).notNull().default(false), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const knowledgeSavedViews = sqliteTable("knowledge_saved_views", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  name: text("name").notNull(), scope: text("scope", { enum: ["personal", "team"] }).notNull().default("personal"), teamKey: text("team_key"),
  stateFilter: text("state_filter").notNull().default("all"), categoryFilter: text("category_filter").notNull().default("all"), sort: text("sort").notNull().default("updated"), query: text("query").notNull().default(""), ownerFilter: text("owner_filter").notNull().default(""), isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const knowledgeVersions = sqliteTable("knowledge_versions", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), documentId: text("document_id").notNull().references(() => knowledgeDocuments.id),
  version: text("version").notNull(), title: text("title").notNull(), ownerTeam: text("owner_team").notNull(), content: text("content").notNull(),
  category: text("category", { enum: ["refund", "damage", "address", "invoice"] }).notNull(), keywordsJson: text("keywords_json").notNull().default("[]"),
  risk: text("risk", { enum: ["low", "medium", "high"] }).notNull(), handoff: integer("handoff", { mode: "boolean" }).notNull().default(false),
  sourceType: text("source_type", { enum: ["official", "internal_demo", "generated-internal-review"] }).notNull(), sourceTitle: text("source_title"), sourceUrl: text("source_url"),
  state: text("state", { enum: ["draft", "review", "active", "archived", "rolled_back"] }).notNull(), coverage: real("coverage").notNull().default(0), validFrom: text("valid_from"), validUntil: text("valid_until"),
  createdByUserId: text("created_by_user_id").references(() => users.id), publishedByUserId: text("published_by_user_id").references(() => users.id), releasePercent: integer("release_percent").notNull().default(0),
  changeSummary: text("change_summary").notNull().default(""), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), publishedAt: text("published_at"),
});

export const knowledgeSourceSnapshots = sqliteTable("knowledge_source_snapshots", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), documentId: text("document_id").notNull().references(() => knowledgeDocuments.id), versionId: text("version_id"),
  sourceType: text("source_type", { enum: ["official", "internal_demo", "generated-internal-review"] }).notNull(), sourceTitle: text("source_title"), sourceUrl: text("source_url"), sourceVersion: text("source_version").notNull().default("unknown"),
  contentHash: text("content_hash").notNull().default(""), snapshotContent: text("snapshot_content").notNull(), syncStatus: text("sync_status", { enum: ["captured", "stale", "failed"] }).notNull().default("captured"), fetchedAt: text("fetched_at").notNull(), createdByUserId: text("created_by_user_id").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const knowledgeConflicts = sqliteTable("knowledge_conflicts", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), documentId: text("document_id").notNull().references(() => knowledgeDocuments.id), conflictingDocumentId: text("conflicting_document_id").notNull().references(() => knowledgeDocuments.id),
  kind: text("kind", { enum: ["duplicate", "conflict"] }).notNull(), severity: text("severity", { enum: ["high", "medium"] }).notNull(), status: text("status", { enum: ["open", "resolved", "false_positive"] }).notNull().default("open"), title: text("title").notNull(), reason: text("reason").notNull(), scope: text("scope").notNull().default("同服务域"), ownerUserId: text("owner_user_id").references(() => users.id), resolutionNote: text("resolution_note").notNull().default(""), resolvedByUserId: text("resolved_by_user_id").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), resolvedAt: text("resolved_at"),
});

export const knowledgeFeedback = sqliteTable("knowledge_feedback", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), knowledgeId: text("knowledge_id").notNull().references(() => knowledgeDocuments.id), actorUserId: text("actor_user_id").notNull().references(() => users.id), reason: text("reason").notNull(), content: text("content").notNull(), status: text("status", { enum: ["open", "in_review", "resolved", "dismissed"] }).notNull().default("open"), resolutionNote: text("resolution_note").notNull().default(""), resolvedByUserId: text("resolved_by_user_id").references(() => users.id), resolvedAt: text("resolved_at"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const knowledgeAccessRequests = sqliteTable("knowledge_access_requests", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), requesterUserId: text("requester_user_id").notNull().references(() => users.id), requestedRole: text("requested_role").notNull(), feature: text("feature").notNull(), reason: text("reason").notNull(), status: text("status", { enum: ["open", "approved", "rejected"] }).notNull().default("open"), reviewerUserId: text("reviewer_user_id").references(() => users.id), reviewNote: text("review_note").notNull().default(""), reviewedAt: text("reviewed_at"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const knowledgeSourceRefreshRequests = sqliteTable("knowledge_source_refresh_requests", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), knowledgeId: text("knowledge_id").notNull().references(() => knowledgeDocuments.id), requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id), ownerUserId: text("owner_user_id").references(() => users.id), reason: text("reason").notNull(), status: text("status", { enum: ["open", "queued", "cancelled"] }).notNull().default("open"), note: text("note").notNull().default(""), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
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
  model: text("model").notNull(), datasetVersion: text("dataset_version").notNull(), suite: text("suite").notNull().default("regression"),
  systemVersion: text("system_version").notNull().default("legacy"),
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
  historyJson: text("history_json").notNull().default("[]"), routingIntent: text("routing_intent"),
  routingConfidence: real("routing_confidence"), routingSignalsJson: text("routing_signals_json").notNull().default("[]"),
  traceId: text("trace_id"), promptTokens: integer("prompt_tokens"), completionTokens: integer("completion_tokens"), totalTokens: integer("total_tokens"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const evaluationReviews = sqliteTable("evaluation_reviews", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  evaluationResultId: text("evaluation_result_id").notNull().unique().references(() => evaluationResults.id),
  reviewerEmail: text("reviewer_email").notNull(),
  decision: text("decision", { enum: ["confirmed_failure", "label_issue", "accepted_behavior"] }).notNull(),
  correctedSource: text("corrected_source"), correctedHandoff: integer("corrected_handoff", { mode: "boolean" }),
  note: text("note").notNull().default(""), reviewedAt: text("reviewed_at").notNull(),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(), traceId: text("trace_id").notNull().unique(), organizationId: text("organization_id").notNull().references(() => organizations.id), conversationId: text("conversation_id"),
  model: text("model"), query: text("query").notNull(), intent: text("intent"), routingConfidence: real("routing_confidence"),
  knowledgeJson: text("knowledge_json").notNull().default("[]"), toolCallsJson: text("tool_calls_json").notNull().default("[]"), traceJson: text("trace_json").notNull().default("[]"),
  answer: text("answer"), handoff: integer("handoff", { mode: "boolean" }).notNull().default(false), mode: text("mode").notNull(), status: text("status").notNull(), failureCode: text("failure_code"),
  promptTokens: integer("prompt_tokens"), completionTokens: integer("completion_tokens"), totalTokens: integer("total_tokens"), latencyMs: integer("latency_ms").notNull().default(0), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const knowledgeEmbeddings = sqliteTable("knowledge_embeddings", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  documentId: text("document_id").notNull().references(() => knowledgeDocuments.id), model: text("model").notNull(),
  dimensions: integer("dimensions").notNull(), vectorJson: text("vector_json").notNull(), contentHash: text("content_hash").notNull(),
  documentVersion: text("document_version").notNull(), indexVersion: text("index_version").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const embeddingIndexVersions = sqliteTable("embedding_index_versions", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  model: text("model").notNull(), currentIndexVersion: text("current_index_version").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const retrievalShadowRuns = sqliteTable("retrieval_shadow_runs", {
  id: text("id").primaryKey(), traceId: text("trace_id").notNull().unique(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  intent: text("intent"), currentSourceId: text("current_source_id"), candidateSourceId: text("candidate_source_id"),
  changed: integer("changed", { mode: "boolean" }).notNull().default(false), status: text("status", { enum: ["completed", "failed", "skipped"] }).notNull(),
  embeddingModel: text("embedding_model"), indexVersion: text("index_version"), candidatesJson: text("candidates_json").notNull().default("[]"),
  selectionReason: text("selection_reason"), latencyMs: integer("latency_ms").notNull().default(0), errorCode: text("error_code"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const retrievalShadowReviews = sqliteTable("retrieval_shadow_reviews", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  shadowRunId: text("shadow_run_id").notNull().unique().references(() => retrievalShadowRuns.id),
  reviewerEmail: text("reviewer_email").notNull(),
  decision: text("decision", { enum: ["improvement", "regression", "equivalent", "inconclusive"] }).notNull(),
  correctedSourceId: text("corrected_source_id"), note: text("note").notNull().default(""),
  reviewedAt: text("reviewed_at").notNull(),
});
