import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("contains an authorized workspace entry and role-based product surface", async () => {
  const page = await source("app/page.tsx");
  for (const label of ["运营总览", "会话中心", "工单管理", "知识库", "质检中心", "策略中心", "数据分析", "资源权限", "安全审计"]) {
    assert.match(page, new RegExp(label));
  }
  for (const role of ["服务主管", "一线客服", "知识运营", "AI 运营", "系统管理员"]) {
    assert.match(page, new RegExp(role));
  }
  assert.match(page, /我的工作台/);
  assert.match(page, /全局搜索/);
  for (const entry of ["登录企业工作空间", "选择工作空间", "选择本次工作台", "记住本次选择"]) {
    assert.match(page, new RegExp(entry));
  }
  assert.match(page, /当前工作台/);
  assert.doesNotMatch(page, /当前角色/);
  assert.match(page, /workspaces\[workspace\]\.roles\.includes/);
  assert.match(page, /hasUiRoleAccess/);
  assert.match(page, /frontlineWorkbenchAvailable \? \[FRONTLINE_ROLE\] : \[\]/);
  assert.doesNotMatch(page, /切换授权工作台/);
  assert.doesNotMatch(page, /aria-label="业务域导航"/);
  assert.match(page, /\/api\/bootstrap/);
  assert.match(page, /\/api\/agent\/respond/);
  assert.match(page, /置信度/);
  assert.match(page, /人工接管/);
});

test("exposes only server-authorized workbenches while keeping role navigation available", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /const FRONTLINE_ROLE: RoleKey = "agent"/);
  assert.match(page, /function navigate\(next: NavKey\)/);
  assert.match(page, /current\.roles\.filter\(\(key\) => allowedRoles\.includes\(key\)\)/);
  assert.match(page, /Object\.keys\(workspaces\).*filter\(\(key\) => key === "qingyu"\)/);
  assert.match(page, /onClick=\{\(\) => navigate\(item\.key\)\}/);
  assert.match(page, /authorizedRoles\.includes\("administrator"\)/);
  assert.match(page, /setRole\(FRONTLINE_ROLE\)/);
  assert.match(page, /roleKeysFromBackend/);
  for (const capability of ["会话中心", "工单管理", "知识库"]) assert.match(page, new RegExp(capability));
});

test("knowledge workbench is reachable only for server-authorized roles", async () => {
  const [page, bootstrap, knowledge, nginx] = await Promise.all([source("app/page.tsx"), source("app/api/bootstrap/route.ts"), source("app/api/knowledge/route.ts"), source("deploy/nginx.conf")]);
  assert.match(page, /正在确认企业授权工作台/);
  assert.match(page, /frontlineWorkbenchAvailable \? \[FRONTLINE_ROLE\] : \[\]/);
  assert.doesNotMatch(page, /authorizedRoles\.filter/);
  assert.match(bootstrap, /roleRows/);
  assert.match(bootstrap, /roles: roleRows\.map/);
  assert.match(bootstrap, /尚未加入该工作空间，请联系管理员邀请/);
  assert.match(knowledge, /requireKnowledgeActor/);
  assert.match(knowledge, /当前角色只能查看已生效知识/);
  assert.match(knowledge, /KNOWLEDGE_EDITOR_ROLES/);
  assert.match(nginx, /\$http_oai_authenticated_user_email/);
  assert.match(nginx, /\$servicepilot_auth_email/);
});

test("knowledge APIs enforce tenant membership, role visibility, and resource-scoped feedback", async () => {
  const [auth, listRoute, detailRoute, feedbackRoute] = await Promise.all([
    source("lib/knowledge-auth.ts"),
    source("app/api/knowledge/route.ts"),
    source("app/api/knowledge/[id]/route.ts"),
    source("app/api/knowledge/feedback/route.ts"),
  ]);
  assert.match(auth, /tenantIdForRequest/);
  assert.match(auth, /actorFor/);
  assert.match(auth, /当前账号没有该工作空间的知识权限/);
  assert.match(auth, /canReadKnowledgeState/);
  assert.match(listRoute, /visibleCondition/);
  assert.match(listRoute, /当前角色只能查看已生效知识/);
  assert.match(detailRoute, /findReadableKnowledge/);
  assert.match(auth, /knowledgeDocuments.organizationId/);
  assert.match(feedbackRoute, /requireKnowledgeActor/);
  assert.match(feedbackRoute, /actorUserId: actor.id/);
});

test("knowledge validity is enforced for frontline retrieval and exposed to operators", async () => {
  const [api, detail, page, validity] = await Promise.all([
    source("app/api/knowledge/route.ts"),
    source("app/api/knowledge/[id]/route.ts"),
    source("app/page.tsx"),
    source("lib/knowledge-validity.ts"),
  ]);
  assert.match(api, /effectiveWindow/);
  assert.match(api, /isNull\(knowledgeDocuments\.validFrom\)/);
  assert.match(api, /knowledgeValidityLabel/);
  assert.match(detail, /knowledgeValidity\(document\.validFrom, document\.validUntil\)/);
  assert.match(page, /validityLabel/);
  assert.match(page, /已过期/);
  assert.match(validity, /expiring/);
});

test("knowledge source provenance is persisted and opens a real immutable snapshot", async () => {
  const [schema, migration, listRoute, detailRoute, page, hash] = await Promise.all([
    source("db/schema.ts"),
    source("drizzle/0024_knowledge_source_snapshots.sql"),
    source("app/api/knowledge/route.ts"),
    source("app/api/knowledge/[id]/route.ts"),
    source("app/page.tsx"),
    source("lib/content-hash.ts"),
  ]);
  assert.match(schema, /knowledgeSourceSnapshots/);
  assert.match(migration, /INSERT INTO `knowledge_source_snapshots`/);
  assert.match(listRoute, /knowledgeSourceSnapshots/);
  assert.match(listRoute, /sha256Hex/);
  assert.match(detailRoute, /sourceSnapshot/);
  assert.match(detailRoute, /snapshotContent/);
  assert.match(page, /知识来源接入/);
  assert.match(page, /knowledge-source-snapshot-content/);
  assert.match(page, /不可变来源记录/);
  assert.match(hash, /SHA-256/);
});

test("knowledge writes detect same-tenant duplicates and timing conflicts before persistence", async () => {
  const [rule, listRoute, detailRoute, page] = await Promise.all([
    source("lib/knowledge-conflicts.ts"),
    source("app/api/knowledge/route.ts"),
    source("app/api/knowledge/[id]/route.ts"),
    source("app/page.tsx"),
  ]);
  assert.match(rule, /detectKnowledgeConflicts/);
  assert.match(rule, /重复/);
  assert.match(rule, /时效表述可能不一致/);
  assert.match(listRoute, /sameCategory/);
  assert.match(listRoute, /status: 409/);
  assert.match(detailRoute, /sameCategory/);
  assert.match(detailRoute, /检测到重复或口径冲突/);
  assert.match(page, /knowledgeConflicts/);
  assert.match(page, /同域冲突\/重复/);
});

test("knowledge conflict governance persists handling, merge drafts, diffs and audit evidence", async () => {
  const [schema, migration, diff, detailRoute, page] = await Promise.all([
    source("db/schema.ts"),
    source("drizzle/0025_knowledge_conflicts.sql"),
    source("lib/knowledge-diff.ts"),
    source("app/api/knowledge/[id]/route.ts"),
    source("app/page.tsx"),
  ]);
  assert.match(schema, /knowledgeConflicts/);
  assert.match(migration, /knowledge_conflicts/);
  assert.match(diff, /diffKnowledgeText/);
  assert.match(detailRoute, /knowledge\.conflict\.resolve/);
  assert.match(detailRoute, /knowledge\.conflict\.merge/);
  assert.match(detailRoute, /auditEvidence/);
  assert.match(detailRoute, /versionDiff/);
  assert.match(page, /标记已解决/);
  assert.match(page, /合并为新草稿/);
  assert.match(page, /查看上一版本差异/);
  assert.match(page, /治理证据/);
});

test("knowledge search uses a tenant-scoped full-text index, autocomplete and cancellation", async () => {
  const [migration, search, listRoute, suggestionsRoute, page] = await Promise.all([
    source("drizzle/0026_knowledge_search.sql"),
    source("lib/knowledge-search.ts"),
    source("app/api/knowledge/route.ts"),
    source("app/api/knowledge/suggestions/route.ts"),
    source("app/page.tsx"),
  ]);
  assert.match(migration, /CREATE VIRTUAL TABLE `knowledge_fts` USING fts5/);
  assert.doesNotMatch(migration, /CREATE TRIGGER/);
  assert.match(search, /knowledge_fts MATCH/);
  assert.match(search, /syncKnowledgeSearchIndex/);
  assert.match(search, /organization_id = \$\{/);
  assert.match(listRoute, /searchKnowledgeIds/);
  assert.match(suggestionsRoute, /requireKnowledgeActor/);
  assert.match(suggestionsRoute, /searchKnowledgeIds/);
  assert.match(page, /api\/knowledge\/suggestions/);
  assert.match(page, /AbortController/);
  assert.match(page, /knowledge-search-suggestions/);
});

test("knowledge filters expose their selected state to assistive technology", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /按服务域筛选/);
  assert.match(page, /aria-pressed=\{category === item\.key\}/);
  assert.match(page, /按知识状态筛选/);
  assert.match(page, /aria-pressed=\{stateFilter === "all"\}/);
  assert.match(page, /aria-pressed=\{stateFilter === "active"\}/);
  assert.match(page, /aria-pressed=\{stateFilter === "review"\}/);
  assert.match(page, /aria-pressed=\{stateFilter === "draft"\}/);
});

test("knowledge operator views expose tab and panel relationships", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /knowledge-surface-tabs.*role="tablist"/s);
  for (const id of ["knowledge-surface-tab-work", "knowledge-surface-tab-library", "knowledge-surface-tab-playbook", "knowledge-surface-panel-work", "knowledge-surface-panel-library", "knowledge-surface-panel-playbook"]) assert.match(page, new RegExp(id));
  assert.match(page, /handleTabKeyDown\(event, surfaceTabIds/);
  assert.match(page, /role="tabpanel" aria-labelledby=\{surfaceTabIds\[1\]\}/);
});

test("knowledge results expose concise names and keyboard-openable rows", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /aria-labelledby=\{`frontline-knowledge-title-\$\{doc\.id\}`\}/);
  assert.match(page, /aria-describedby=\{`frontline-knowledge-summary-\$\{doc\.id\} frontline-knowledge-meta-\$\{doc\.id\}`\}/);
  assert.match(page, /tabIndex=\{0\} aria-label=\{`打开知识 \$\{doc\.title\}`\}/);
  assert.match(page, /event\.key === "Enter" \|\| event\.key === " "/);
});

test("knowledge results expose source snapshot freshness separately from validity", async () => {
  const [page, route, policy] = await Promise.all([source("app/page.tsx"), source("app/api/knowledge/route.ts"), source("lib/knowledge-validity.ts")]);
  assert.match(page, /来源新鲜度/);
  assert.match(page, /sourceFreshnessLabel/);
  assert.match(page, /knowledge-source-freshness/);
  assert.match(route, /knowledgeSourceSnapshots/);
  assert.match(route, /sourceFetchedAt/);
  assert.match(route, /sourceSyncStatus/);
  assert.match(route, /knowledgeSourceFreshness/);
  assert.match(policy, /KnowledgeSourceFreshness/);
  assert.match(policy, /SOURCE_FRESH_WINDOW_MS/);
  assert.match(policy, /来源同步失败/);
});

test("knowledge empty and error states expose local recovery actions", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /role="alert"><span>\{error\}<\/span>/);
  assert.match(page, /重试读取/);
  assert.match(page, /清除搜索和筛选/);
  assert.match(page, /knowledgeRetryKey/);
});

test("knowledge operation feedback is announced atomically", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(page, /aria-live=\{noticeKind === "error" \? "assertive" : "polite"\}/);
  assert.match(page, /aria-atomic="true"/);
});

test("knowledge editor protects and restores unsaved drafts without publishing them", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);
  assert.match(page, /hasUnsavedDraft/);
  assert.match(page, /sessionStorage/);
  assert.match(page, /beforeunload/);
  assert.match(page, /已恢复最近未保存草稿/);
  assert.match(page, /丢弃本地修改/);
  assert.match(page, /确认丢弃当前未保存修改/);
  assert.match(page, /线上版本未改变/);
  assert.match(css, /knowledge-unsaved-banner/);
});

test("knowledge operations use real versioned CRUD and governed release actions", async () => {
  const [page, listRoute, detailRoute, migration, schema] = await Promise.all([source("app/page.tsx"), source("app/api/knowledge/route.ts"), source("app/api/knowledge/[id]/route.ts"), source("drizzle/0023_knowledge_versions.sql"), source("db/schema.ts")]);
  assert.match(page, /knowledgeAction/);
  assert.match(page, /创建草稿/);
  assert.match(page, /保存草稿/);
  assert.match(page, /提交真实复核任务/);
  assert.match(page, /查看版本与回滚/);
  assert.match(listRoute, /export async function POST/);
  assert.match(listRoute, /knowledge\.create/);
  for (const action of ["save_draft", "submit_review", "publish", "rollback"]) assert.match(detailRoute, new RegExp(`action === "${action}"`));
  assert.match(detailRoute, /knowledge\.version\.create/);
  assert.match(detailRoute, /knowledge\.review\.submit/);
  assert.match(detailRoute, /knowledge\.publish/);
  assert.match(detailRoute, /knowledge\.rollback/);
  assert.match(detailRoute, /export async function DELETE/);
  assert.match(detailRoute, /knowledge\.archive/);
  assert.match(migration, /knowledge_versions/);
  assert.match(schema, /knowledgeVersions/);
});

test("workbench uses live data with explicit freshness and failure states", async () => {
  const [page, route] = await Promise.all([source("app/page.tsx"), source("app/api/workbench/route.ts")]);
  assert.match(page, /workbenchRefreshKey/);
  assert.match(page, /正在读取工作台实时数据/);
  assert.match(page, /工作台数据加载失败/);
  assert.match(page, /实时待办数据暂不可用/);
  assert.match(page, /查看工单队列/);
  assert.match(page, /P1 已超时/);
  assert.match(page, /未来30分钟内到期/);
  assert.doesNotMatch(page, /88\.5%/);
  assert.doesNotMatch(page, /94\.2%/);
  assert.doesNotMatch(page, /我的 P1 工单/);
  assert.match(route, /p1DueSoon/);
  assert.match(route, /overdueP1/);
  assert.match(route, /updatedAt/);
  assert.match(route, /slaDueAt/);
});

test("workbench metrics aggregate at the database and bound task windows", async () => {
  const [page, route] = await Promise.all([source("app/page.tsx"), source("app/api/workbench/route.ts")]);
  assert.match(route, /count\(\)/);
  assert.match(route, /groupBy\(conversations\.topic\)/);
  assert.match(route, /limit\(100\)/);
  assert.match(route, /dataAsOf/);
  assert.match(route, /queryWindow/);
  assert.match(route, /openTicketStates/);
  assert.match(page, /onPendingChange/);
  assert.doesNotMatch(page, /workbench unavailable/);
});

test("workbench phase four restores deep links and exposes honest interaction states", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);
  assert.match(page, /restoreNavigationFromUrl/);
  assert.match(page, /addEventListener\("popstate"/);
  assert.match(page, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(page, /aria-busy=\{workbenchRefreshing\}/);
  assert.match(page, /正在刷新工作台数据/);
  assert.match(page, /onLoadingChange/);
  assert.match(css, /button:focus-visible,a:focus-visible,input:focus-visible/);
  assert.match(css, /workbench-refresh-pulse/);
  assert.match(css, /pointer:coarse/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("workbench tasks open their real conversation or ticket details", async () => {
  const [page, route] = await Promise.all([source("app/page.tsx"), source("app/api/workbench/route.ts")]);
  assert.match(page, /onOpenTask/);
  assert.match(page, /initialConversationId/);
  assert.match(page, /initialTicketId/);
  assert.match(page, /已定位到/);
  assert.match(page, /window\.history\.pushState/);
  assert.match(page, /window\.history\.replaceState/);
  assert.match(page, /conversation-detail/);
  assert.match(page, /document\.querySelector\("\.ticket-drawer button"\)/);
  assert.match(page, /setSelectedId\(\(current\) => deepLinked\?\.id/);
  assert.match(page, /fetch\(`\/api\/tickets\/\$\{encodeURIComponent\(initialTicketId\)\}`/);
  assert.match(route, /resourceId: ticket\.id/);
  assert.match(route, /resourceId: row\.id/);
});

test("conversation queue refresh performs a real reload with honest busy state", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /queueRefreshKey/);
  assert.match(page, /setQueueRefreshKey\(\(value\) => value \+ 1\)/);
  assert.match(page, /queueRefreshing/);
  assert.match(page, /aria-busy=\{queueRefreshing\}/);
  assert.match(page, /disabled=\{queueRefreshing\}/);
  assert.match(page, /setInterval\(loadConversations, 5000\)/);
  assert.match(page, /queueError/);
  assert.match(page, /queueLastSuccessAt/);
  assert.match(page, /queueSnapshotStale/);
  assert.match(page, /最后一次成功快照/);
  assert.match(page, /重试加载/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /aria-label="刷新会话队列" onClick=\{\(\) => flash\("会话队列已刷新"\)\}/);
});

test("conversation queue keeps the last successful snapshot and exposes stale recovery", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);
  assert.match(page, /queueSnapshotRef/);
  assert.match(page, /setQueueError\(hasSnapshot/);
  assert.match(page, /setQueueSnapshotStale\(Boolean/);
  assert.match(page, /当前仍显示最后一次成功快照/);
  assert.match(page, /队列数据可能已过期/);
  assert.match(page, /function retryQueue/);
  assert.match(page, /setQueueRefreshKey\(\(value\) => value \+ 1\)/);
  assert.match(css, /queue-error-banner/);
  assert.match(css, /queue-error-empty/);
});

test("conversation queue exposes real SLA semantics instead of status copy", async () => {
  const [page, route, agentRoute, schema, migration, policy] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/route.ts"), source("app/api/agent/respond/route.ts"), source("db/schema.ts"), source("drizzle/0018_conversation_sla.sql"), source("lib/conversation-sla.ts")]);
  assert.match(page, /slaState/);
  assert.match(page, /selected\.priority/);
  assert.match(page, /selected\.riskSource/);
  assert.match(page, /已逾期|剩余/);
  assert.match(route, /effectiveSla/);
  assert.match(policy, /frontline-p1-first-response-60m/);
  assert.match(route, /slaDueAt/);
  assert.match(route, /riskSource/);
  assert.match(agentRoute, /slaPolicyForRisk/);
  assert.match(agentRoute, /slaStartedAt/);
  assert.match(agentRoute, /slaDueAt/);
  assert.match(schema, /slaDueAt/);
  assert.match(schema, /riskSource/);
  assert.match(migration, /sla_due_at/);
});

test("conversation queue uses server-side pagination and preserves deep-linked records", async () => {
  const [page, route] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/route.ts")]);
  assert.match(page, /queuePage/);
  assert.match(page, /queuePagination/);
  assert.match(page, /第 \{queuePagination\.page\} \/ \{queuePagination\.totalPages\} 页/);
  assert.match(page, /pageSize: "25"/);
  assert.match(page, /status = queueFilter/);
  assert.match(page, /conversationId/);
  assert.match(page, /setQueuePage\(1\)/);
  assert.match(route, /parsePage/);
  assert.match(route, /pageSize/);
  assert.match(route, /limit\(pageSize\)\.offset/);
  assert.match(route, /pagination = \{ page, pageSize, total, totalPages \}/);
  assert.match(route, /queueCounts/);
  assert.match(route, /inArray\(conversations\.status/);
  assert.match(route, /conversationId/);
  assert.match(route, /rows = \[linked/);
});

test("conversation polling cancels stale requests and detail history loads incrementally", async () => {
  const [page, listRoute, detailRoute, css] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/route.ts"), source("app/api/conversations/[id]/route.ts"), source("app/globals.css")]);
  assert.match(page, /queueRequestRef/);
  assert.match(page, /queueRequestIdRef/);
  assert.match(page, /signal: controller\.signal/);
  assert.match(page, /historyRequestRef/);
  assert.match(page, /loadConversationHistory/);
  assert.match(page, /loadOlderConversationMessages/);
  assert.match(page, /加载更早消息/);
  assert.match(page, /setHistoryByConversation/);
  assert.match(page, /demoRefreshRef/);
  assert.match(page, /demoRefreshIdRef/);
  assert.match(listRoute, /\.limit\(13\)/);
  assert.match(listRoute, /historyHasMore/);
  assert.match(listRoute, /historyCursor/);
  assert.match(detailRoute, /searchParams\.get\("before"\)/);
  assert.match(detailRoute, /limit \+ 1/);
  assert.match(detailRoute, /hasMore/);
  assert.match(detailRoute, /nextBefore/);
  assert.match(detailRoute, /orderBy\(desc\(messages\.createdAt\)\)/);
  assert.match(css, /load-more-messages/);
});

test("conversation trace is sourced from persisted Agent runs and explains failures", async () => {
  const [page, listRoute, detailRoute] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/route.ts"), source("app/api/conversations/[id]/route.ts")]);
  assert.match(page, /selectedTrace/);
  assert.match(page, /selectedTraceId/);
  assert.match(page, /selectedTraceStatus/);
  assert.match(page, /traceStatusText/);
  assert.match(page, /失败码/); // The failure-code explanation is rendered from the persisted step metadata.
  assert.match(page, /当前消息没有可用执行记录/);
  assert.match(page, /该消息未持久化可展示的 Trace/);
  assert.match(page, /Trace ID/);
  assert.match(listRoute, /agentRuns/);
  assert.match(listRoute, /agentRun:/);
  assert.match(listRoute, /traceJson/);
  assert.match(listRoute, /toolTraceJson/);
  assert.match(detailRoute, /normalizedTurns/);
  assert.match(detailRoute, /agentRun:/);
  assert.match(detailRoute, /failureCode/);
  assert.doesNotMatch(page, /识别服务意图/);
});

test("mobile conversation workflow keeps queue, detail, context and AI assistance reachable", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);
  assert.match(page, /mobileConversationView/);
  assert.match(page, /setMobileConversationView\("detail"\)/);
  assert.match(page, /返回会话队列/);
  assert.match(page, /mobileInsightOpen/);
  assert.match(page, /打开服务上下文和 AI 协助/);
  assert.match(page, /mobile-insight-scrim/);
  assert.match(page, /服务上下文和 AI 协助/);
  assert.match(css, /mobile-conversation-queue/);
  assert.match(css, /mobile-conversation-detail/);
  assert.match(css, /100dvh/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /mobile-insight-open/);
  assert.match(css, /min-height:44px/);
});

test("explicit tab widgets expose panels and keyboard navigation", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);
  assert.match(page, /conversation-tab-needs-human/);
  assert.match(page, /conversation-queue-panel/);
  assert.match(page, /insight-tab-context/);
  assert.match(page, /insight-panel-assist/);
  assert.match(page, /knowledge-editor-tab-content/);
  assert.match(page, /knowledge-editor-panel-history/);
  assert.match(page, /aria-controls=/);
  assert.match(page, /aria-labelledby=/);
  assert.match(page, /tabIndex=\{[^}]*-1/);
  assert.match(page, /ArrowRight/);
  assert.match(page, /ArrowLeft/);
  assert.match(page, /Home/);
  assert.match(page, /End/);
  assert.match(page, /role="tabpanel"/);
  assert.match(css, /role="tab"\]:focus-visible/);
});

test("interactive dialogs trap focus, close on Escape and restore the trigger focus", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /function useDialogFocus/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /event\.key !== "Tab"/);
  assert.match(page, /returnFocus\?\.isConnected/);
  assert.match(page, /mobileInsightDialogRef/);
  assert.match(page, /ticketDetailDialogRef/);
  assert.match(page, /feedbackDialogRef/);
  assert.match(page, /customerDemoDialogRef/);
  assert.match(page, /ref=\{closeDialogRef\}/);
  assert.match(page, /ref=\{ticketCreateDialogRef\}/);
});

test("conversation drafts persist locally and show an honest save state", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);
  assert.match(page, /servicepilot-conversation-drafts-v1/);
  assert.match(page, /readStoredConversationDrafts/);
  assert.match(page, /saveConversationDraft/);
  assert.match(page, /clearConversationDraft/);
  assert.match(page, /已保存到本机/);
  assert.match(page, /已从本机恢复/);
  assert.match(page, /本机保存失败，请复制内容/);
  assert.match(page, /AI建议，尚未保存/);
  assert.match(page, /onChange=\{\(event\) => saveConversationDraft/);
  assert.match(css, /draft-status/);
});

test("conversation internal notes use a real auditable save flow", async () => {
  const [page, route] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/[id]/route.ts")]);
  assert.match(page, /showInternalNote/);
  assert.match(page, /action: "internal_note"/);
  assert.match(page, /保存备注/);
  assert.match(page, /仅客服可见/);
  assert.match(page, /internalNoteSaving/);
  assert.match(route, /conversation\.internal_note/);
  assert.match(route, /metadataJson: JSON\.stringify\(\{ actorEmail: email, content \}\)/);
  assert.match(route, /content\.trim\(\)\.slice\(0, 2000\)/);
});

test("conversation summary feedback is persisted instead of toast-only", async () => {
  const [page, route] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/[id]/route.ts")]);
  assert.match(page, /submitSummaryFeedback/);
  assert.match(page, /action: "summary_feedback"/);
  assert.match(page, /summaryFeedbackSaving/);
  assert.match(page, /已提交摘要问题/);
  assert.match(route, /conversation\.summary_feedback/);
  assert.match(route, /feedbackType: "summary_inaccurate"/);
  assert.doesNotMatch(page, /摘要不准确？反馈问题"\}>/);
});

test("conversation suggestion feedback is persisted instead of toast-only", async () => {
  const [page, route] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/[id]/route.ts")]);
  assert.match(page, /submitSuggestionFeedback/);
  assert.match(page, /action: "suggestion_feedback"/);
  assert.match(page, /suggestionFeedbackSaving/);
  assert.match(page, /已提交反馈/);
  assert.match(route, /conversation\.suggestion_feedback/);
  assert.match(route, /feedbackType: "suggestion_not_helpful"/);
  assert.doesNotMatch(page, /标记无帮助"\}>/);
});

test("conversation suggested next action creates an auditable read-only request", async () => {
  const [page, route] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/[id]/route.ts")]);
  assert.match(page, /requestSuggestedAction/);
  assert.match(page, /action: "next_action_request"/);
  assert.match(page, /nextActionSaving/);
  assert.match(page, /已发起核验/);
  assert.doesNotMatch(page, /已完成，结果已写入会话记录/);
  assert.match(route, /conversation\.next_action_request/);
  assert.match(route, /requestedAction/);
});

test("conversation transfer updates a real assignee with tenant-scoped audit", async () => {
  const [page, listRoute, detailRoute] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/route.ts"), source("app/api/conversations/[id]/route.ts")]);
  assert.match(page, /showTransfer/);
  assert.match(page, /action: "transfer"/);
  assert.match(page, /assigneeId: transferAssigneeId/);
  assert.match(page, /确认转交/);
  assert.match(listRoute, /assignees/);
  assert.match(listRoute, /eq\(memberships\.organizationId, organizationId\)/);
  assert.match(detailRoute, /conversation\.transfer/);
  assert.match(detailRoute, /指定负责人不在当前工作空间/);
  assert.match(detailRoute, /assignedUserId: assignee\.id/);
});

test("conversation reopen persists status and audit instead of local-only state", async () => {
  const [page, route, migration, schema] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/[id]/route.ts"), source("drizzle/0017_reopen_loop.sql"), source("db/schema.ts")]);
  assert.match(page, /reopenConversation/);
  assert.match(page, /async function updateConversation\(action: "claim" \| "reply" \| "resolve" \| "reopen"/);
  assert.match(page, /updateConversation\("reopen", undefined, \{ reopenReason \}\)/);
  assert.match(page, /aria-busy=\{reopenSaving\}/);
  assert.match(page, /重新打开中…/);
  assert.match(page, /重新打开原因（必填）/);
  assert.match(page, /上一轮结案/);
  assert.match(page, /role="alert"/);
  assert.match(route, /action === "reopen"/);
  assert.match(route, /conversation\.reopen/);
  assert.match(route, /previousStatus: conversation\.status/);
  assert.match(route, /conversation\.status !== "resolved"/);
  assert.match(route, /reopenReason is required/);
  assert.match(route, /lastReopenReason: reopenReason/);
  assert.match(route, /customerConfirmed: false/);
  assert.match(route, /previousResolutionSummary: conversation\.resolutionSummary/);
  assert.match(route, /status: "human_active"/);
  assert.match(route, /updated\.changes/);
  assert.match(migration, /reopen_count/);
  assert.match(schema, /lastReopenReason/);
});

test("conversation supervisor escalation creates a truthful auditable request", async () => {
  const [page, route] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/[id]/route.ts")]);
  assert.match(page, /requestSupervisorEscalation/);
  assert.match(page, /action: "supervisor_escalation_request"/);
  assert.match(page, /supervisorEscalationSaving/);
  assert.match(page, /已提交升级请求/);
  assert.match(page, /不会虚报已升级成功/);
  assert.match(route, /conversation\.supervisor_escalation_request/);
  assert.match(route, /risk: "high"/);
  assert.match(route, /reason/);
});

test("conversation console persists agent presence instead of toast-only busy state", async () => {
  const [page, listRoute, detailRoute] = await Promise.all([source("app/page.tsx"), source("app/api/conversations/route.ts"), source("app/api/conversations/[id]/route.ts")]);
  assert.match(page, /togglePresence/);
  assert.match(page, /action: "set_presence"/);
  assert.match(page, /presenceSaving/);
  assert.match(page, /状态已保存/);
  assert.match(listRoute, /workspace_presence/);
  assert.match(listRoute, /agent\.presence\.busy/);
  assert.match(detailRoute, /action === "set_presence"/);
  assert.match(detailRoute, /presence must be busy or available/);
  assert.match(detailRoute, /agent\.presence\.available/);
});

test("conversation resolution persists structured close facts and audit metadata", async () => {
  const [page, listRoute, detailRoute, schema, migration] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/conversations/route.ts"),
    source("app/api/conversations/[id]/route.ts"),
    source("db/schema.ts"),
    source("drizzle/0016_structured_resolution.sql"),
  ]);
  assert.match(page, /resolutionSummary/);
  assert.match(page, /action, content, \.\.\.extra/);
  assert.match(page, /resolutionSummary: resolutionSummary\.trim\(\)/);
  assert.match(page, /结案中…/);
  assert.match(page, /form onSubmit/);
  assert.match(page, /解决摘要（必填）/);
  assert.match(page, /closeError/);
  assert.match(page, /className="close-error" role="alert"/);
  assert.match(page, /selected\.resolutionSummary/);
  assert.match(listRoute, /resolutionCategory/);
  assert.match(listRoute, /customerConfirmed/);
  assert.match(detailRoute, /resolutionSummary is required/);
  assert.match(detailRoute, /customerConfirmed must be true/);
  assert.match(detailRoute, /resolvedByEmail: email/);
  assert.match(detailRoute, /conversation\.resolve/);
  assert.match(schema, /resolutionCategory/);
  assert.match(schema, /resolvedAt/);
  assert.match(migration, /resolution_summary/);
  assert.match(migration, /customer_confirmed/);
});

test("keeps portfolio host isolated from the ServicePilot upstream", async () => {
  const [nginx, compose] = await Promise.all([source("deploy/nginx.conf"), source("deploy/docker-compose.yml")]);
  assert.match(nginx, /server_name iamwudi\.ltd www\.iamwudi\.ltd/);
  assert.match(nginx, /server_name portfolio\.iamwudi\.ltd/);
  assert.match(nginx, /root \/usr\/share\/nginx\/html\/portfolio/);
  assert.match(nginx, /try_files \$uri \$uri\.html \$uri\/index\.html \$uri\/ \/index\.html/);
  assert.match(compose, /\/opt\/portfolio\/current:\/usr\/share\/nginx\/html\/portfolio:ro/);
});

test("ships a real paginated ticket workflow instead of placeholder rows", async () => {
  const [page, listRoute, detailRoute] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/tickets/route.ts"),
    source("app/api/tickets/[id]/route.ts"),
  ]);
  for (const capability of ["工单队列", "搜索工单", "上一页", "下一页", "新建真实工单", "处理记录", "领取工单", "标记已解决", "重新打开", "打开关联会话"]) assert.match(page, new RegExp(capability));
  assert.match(page, /fetch\(`\/api\/tickets\?\$\{params\.toString\(\)\}`/);
  assert.match(page, /action: \"add_note\"/);
  assert.match(page, /action: \"claim\"/);
  assert.match(listRoute, /pageSize/);
  assert.match(listRoute, /limit\(pageSize\)\.offset/);
  assert.match(listRoute, /pagination:/);
  assert.match(listRoute, /dataAsOf/);
  assert.match(listRoute, /assignees/);
  assert.match(listRoute, /conversationId/);
  assert.match(detailRoute, /export async function GET/);
  assert.match(detailRoute, /export async function PATCH/);
  assert.match(detailRoute, /ticket\.note/);
  assert.match(detailRoute, /action === "assign"/);
  assert.match(detailRoute, /Unsupported ticket action/);
});

test("ticket queue makes data scope and stale snapshot state explicit", async () => {
  const page = await source("app/page.tsx");
  const css = await source("app/globals.css");
  assert.match(page, /type TicketSyncState/);
  assert.match(page, /当前显示最近一次成功快照/);
  assert.match(page, /setSyncState\(hasSnapshot \? "stale" : "error"\)/);
  assert.match(page, /数据范围：/);
  assert.match(page, /合成记录/);
  assert.match(page, /请重试后再做批量或 SLA 判断/);
  assert.match(css, /ticket-sync-strip\.stale/);
  assert.match(css, /ticket-sync-indicator/);
});

test("ticket queue supports efficient desktop pagination, counts, direct metric queues, and stable sorting", async () => {
  const [page, route, css] = await Promise.all([source("app/page.tsx"), source("app/api/tickets/route.ts"), source("app/globals.css")]);
  for (const capability of ["pageSizeOptions", "每页显示数量", "跳转页码", "viewCounts", "filterCounts", "仅开放", "优先级", "创建时间", "P1 未解决工单"]) assert.match(page, new RegExp(capability));
  assert.match(page, /setPageSize\(next as \(typeof pageSizeOptions\)\[number\]\)/);
  assert.match(page, /openMetricQueue\("P1", true\)/);
  assert.match(page, /openMetricQueue\("all", true\)/);
  assert.match(route, /parsePage\(url\.searchParams\.get\("pageSize"\), 25, 5, 100\)/);
  assert.match(route, /viewCounts/);
  assert.match(route, /filterCounts/);
  assert.match(route, /sort === "priority"/);
  assert.match(css, /ticket-view-count/);
  assert.match(css, /ticket-page-jump/);
});

test("ticket queue views and rows expose non-conflicting keyboard semantics", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);
  assert.match(page, /const ticketViewTabs/);
  assert.match(page, /role="tablist" aria-label="工单视图"/);
  assert.match(page, /role="tab" aria-selected=\{view === item\.key\}/);
  assert.match(page, /aria-controls="ticket-queue-results"/);
  assert.match(page, /handleTabKeyDown\(event, ticketViewTabIds/);
  assert.match(page, /数据范围：/);
  assert.match(page, /aria-busy=\{loading\}/);
  assert.match(page, /id="ticket-queue-results" role="tabpanel"/);
  assert.doesNotMatch(page, /className="ticket-row" tabIndex=\{0\} role="button"/);
  assert.match(page, /className="ticket-row-title" onClick=\{\(\) => void openDetail\(ticket\)\}/);
  assert.match(css, /ticket-row-title:focus-visible/);
});

test("ticket queue keeps SLA copy decision-friendly and mobile actions usable", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);
  assert.match(page, /已超时 \$\{days\} 天/);
  assert.match(page, /SLA截止/);
  assert.match(css, /\.ticket-actions button\{white-space:nowrap\}/);
  assert.match(css, /\.ticket-actions\{display:grid;grid-template-columns:repeat\(2/);
  assert.match(css, /\.ticket-actions \.primary-button\{grid-column:1 \/ -1\}/);
});

test("ticket SLA exposes explainable states, policy facts, and honest KPI scope", async () => {
  const [page, listRoute, detailRoute, policy, css] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/tickets/route.ts"),
    source("app/api/tickets/[id]/route.ts"),
    source("lib/ticket-policy.ts"),
    source("app/globals.css"),
  ]);
  assert.match(policy, /TicketSlaState/);
  assert.match(policy, /ticketSlaPolicy/);
  assert.match(policy, /return "unknown"/);
  assert.match(page, /return slaStatus\(ticket\.slaDueAt, ticket\.state, now\)/);
  assert.match(listRoute, /slaState: slaStatus/);
  assert.match(listRoute, /slaExplanation/);
  assert.match(listRoute, /syntheticExcludedFromKpis/);
  assert.match(detailRoute, /slaFacts:/);
  assert.match(detailRoute, /takeoverAt/);
  assert.match(page, /中国标准时间 UTC\+8/);
  assert.match(page, /SLA 时间线/);
  assert.match(page, /暂停 \/ 恢复/);
  assert.match(page, /状态未知/);
  assert.match(css, /ticket-sla-facts/);
});

test("ticket desktop controls expose explicit labels, pressed state, and readable support text", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);
  assert.match(page, /aria-pressed=\{filter === item\.key\}/);
  assert.match(page, /htmlFor="ticket-owner"/);
  assert.match(page, /id="ticket-owner"/);
  assert.match(page, /htmlFor="ticket-priority"/);
  assert.match(page, /id="ticket-priority"/);
  assert.match(page, /htmlFor="ticket-state"/);
  assert.match(page, /id="ticket-state"/);
  assert.match(page, /<th scope="col">工单<\/th>/);
  assert.match(page, /role="alert"/);
  assert.match(css, /\.ticket-row td small\{color:#5f6b7a/);
  assert.match(css, /\.ticket-pagination\{[^}]*color:#5f6b7a/);
});

test("ticket queue cancels stale list and detail requests without clearing the last snapshot", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /ticketRequestIdRef/);
  assert.match(page, /ticketRequestRef\.current\?\.abort\(\)/);
  assert.match(page, /signal: controller\.signal/);
  assert.match(page, /cause\.name === "AbortError"/);
  assert.match(page, /ticketDetailRequestIdRef/);
  assert.match(page, /ticketDetailRequestRef/);
  assert.match(page, /if \(!isCurrent\(\)\) return;/);
  assert.match(page, /setSyncState\(hasSnapshot \? "stale" : "error"\)/);
  assert.match(page, /没有匹配的工单/);
  assert.match(page, /清除搜索词/);
});

test("ticket queue preserves shareable URL state and governed saved views", async () => {
  const [page, viewsRoute, viewDetailRoute, schema, migration] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/ticket-views/route.ts"),
    source("app/api/ticket-views/[id]/route.ts"),
    source("db/schema.ts"),
    source("drizzle/0020_dapper_talisman.sql"),
  ]);
  assert.match(page, /ticketUrlState|TicketUrlState/);
  assert.match(page, /ticketPageSize/);
  assert.match(page, /ticketFilter/);
  assert.match(page, /ticketView/);
  assert.match(page, /ticketSort/);
  assert.match(page, /ticketQ/);
  assert.match(page, /params\.set\("ticket", ticketId\)/);
  assert.match(page, /window\.history\[mode === "push" \? "pushState" : "replaceState"\]/);
  assert.match(page, /团队共享视图/);
  assert.match(page, /复制当前链接/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.match(page, /重命名/);
  assert.match(page, /设为默认/);
  assert.match(page, /删除/);
  assert.match(viewsRoute, /ticketSavedViews/);
  assert.match(viewsRoute, /isSupervisor\(auth\.actor\.role\)/);
  assert.match(viewsRoute, /organizationId/);
  assert.match(viewDetailRoute, /ticket_view\.update/);
  assert.match(viewDetailRoute, /ticket_view\.delete/);
  assert.match(schema, /export const ticketSavedViews/);
  assert.match(migration, /CREATE TABLE `ticket_saved_views`/);
});

test("ticket queue governs bulk changes with preview, confirmation, partial recovery, and scoped exports", async () => {
  const [page, route, exportRoute, exportDetailRoute, schema, migration, exportLib, css] = await Promise.all([
    source("app/page.tsx"), source("app/api/tickets/route.ts"), source("app/api/tickets/export/route.ts"), source("app/api/tickets/export/[id]/route.ts"), source("db/schema.ts"), source("drizzle/0021_damp_goblin_queen.sql"), source("lib/ticket-export.ts"), source("app/globals.css"),
  ]);
  for (const capability of ["批量变更权限", "预览批量分配", "预览批量更新", "批量操作影响预览", "确认更新", "导出当前页", "导出已选", "导出全部筛选", "导出任务处理中", "失败，已保留失败选择"]) assert.match(page, new RegExp(capability));
  assert.match(page, /disabled=\{!canBulkOperate\}/);
  assert.match(page, /preview: true/);
  assert.match(page, /confirmed: true/);
  assert.match(route, /BULK_CONFIRMATION_REQUIRED/);
  assert.match(route, /BULK_PREVIEW_BLOCKED/);
  assert.match(route, /status: failed\.length \? 207 : 200/);
  assert.match(route, /failed: Array/);
  assert.match(exportRoute, /mode === "filtered" && !isSupervisor/);
  assert.match(exportRoute, /status: 202/);
  assert.match(exportDetailRoute, /ticketExportJobs/);
  assert.match(exportDetailRoute, /status: "ready"/);
  assert.match(exportLib, /ticketExportCsv/);
  assert.match(exportLib, /ticketExportResponse/);
  assert.match(exportLib, /filters\.ids/);
  assert.match(schema, /export const ticketExportJobs/);
  assert.match(migration, /CREATE TABLE `ticket_export_jobs`/);
  assert.match(css, /ticket-bulk-preview-modal/);
});

test("ticket creation and detail expose governed association, SLA preview, audit timeline, and idempotent retries", async () => {
  const [page, route, detailRoute, css, schema, migration] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/tickets/route.ts"),
    source("app/api/tickets/[id]/route.ts"),
    source("app/globals.css"),
    source("db/schema.ts"),
    source("drizzle/0022_wise_doctor_spectrum.sql"),
  ]);
  for (const capability of ["搜索关联会话", "可关联会话", "处理团队", "负责人（主管可指定）", "SLA 预览", "处理时间线", "审计事件", "可修正后重试"]) {
    assert.match(page, new RegExp(capability));
  }
  assert.match(page, /带 \* 为必填/);
  assert.match(page, /conversationSearchRequestRef/);
  assert.match(page, /\/api\/conversations\?q=/);
  assert.match(page, /timelineEvents/);
  assert.match(page, /timelineSummary/);
  assert.match(page, /createSlaPreview/);
  assert.match(page, /idempotencyKey/);
  assert.match(page, /网络重试不会重复创建/);
  assert.match(page, /aria-invalid/);
  assert.match(page, /create-summary/);
  assert.match(route, /ownerEmail/);
  assert.match(route, /teamKey/);
  assert.match(route, /关联会话不存在/);
  assert.match(route, /ownerUserId/);
  assert.match(route, /ticket\.create/);
  assert.match(route, /idempotencyKey/);
  assert.match(route, /createRequestId/);
  assert.match(route, /idempotent: true/);
  assert.match(detailRoute, /events/);
  assert.match(detailRoute, /ticket\.note/);
  assert.match(detailRoute, /ticket\.resolve/);
  assert.match(detailRoute, /slaFacts/);
  assert.match(schema, /createRequestId/);
  assert.match(migration, /tickets_create_request_id_unique/);
  assert.match(css, /ticket-event-list/);
  assert.match(css, /ticket-conversation-options/);
});

test("ships a frontline agent resolution workspace instead of an AI monitoring screen", async () => {
  const page = await source("app/page.tsx");
  for (const capability of [
    "人工接管原因",
    "已核验事实",
    "上下文已完整交接，无需用户重复描述",
    "内部备注",
    "结构化结案",
    "用户已确认问题解决",
    "72 小时内再次咨询将重新打开",
    "退款、补偿、账户与地址变更需要身份核验或审批",
  ]) assert.match(page, new RegExp(capability));
  assert.match(page, /type ConversationState/);
  assert.match(page, /setStates/);
  assert.match(page, /setDrafts/);
  assert.match(page, /customerConfirmed/);
  assert.doesNotMatch(page, /AI置信度：/);
});

test("ships a governed reply playbook workspace for human-like Agent responses", async () => {
  const page = await source("app/page.tsx");
  for (const capability of ["话术训练", "让客服回答更像人", "推荐回复", "避免表达", "训练影响", "提交主管复核", "批准并发布到 Agent", "知识运营：编辑 · 提交", "服务主管：批准 · 发布 · 回滚"]) {
    assert.match(page, new RegExp(capability));
  }
  assert.match(page, /type ReplyPlaybook/);
  assert.match(page, /status: "published"/);
  assert.match(page, /canPublishPlaybook/);
  assert.match(page, /不会覆盖业务知识/);
});

test("ships person-level task-interface-metric access control", async () => {
  const access = await source("app/resource-access.tsx");
  assert.match(access, /任务 → 接口 → 指标/);
  assert.match(access, /直接配置/);
  assert.match(access, /父级继承/);
  assert.match(access, /查看权限/);
  assert.match(access, /修改权限/);
  assert.match(access, /保存权限/);
  assert.match(access, /prefers-reduced-motion|resource-access/);
  assert.doesNotMatch(access, /角色|部门|用户组/);
});

test("enforces real model answers and explicit model failure in the Agent route", async () => {
  const route = await source("app/api/agent/respond/route.ts");
  assert.match(route, /oai-authenticated-user-email/);
  assert.match(route, /query\.length > 500/);
  assert.match(route, /不得承诺赔付或执行资金、账户操作/);
  assert.match(route, /safe-fallback/); // Phase 1 V2 must expose an explicit retrieval-safe fallback.
  assert.match(route, /mode: "unavailable"/);
  assert.match(route, /MODEL_UNAVAILABLE/);
  assert.match(route, /model-grounded/);
  assert.match(route, /LLM_API_KEY/);
  assert.match(route, /AbortSignal\.timeout\(\/\^\(\?:kimi-k3\|minimax-m3\)/);
  assert.match(route, /bounded-agentic-rag-step9\.8-v2/);
  assert.match(route, /retrieval-v2/);
  assert.match(route, /routeIntent/);
  assert.match(route, /matchedSignals/);
  assert.match(route, /agentConversationStates/);
  assert.match(route, /conversationId is invalid/);
  assert.match(route, /30 \* 60_000/);
  assert.match(route, /继承会话状态/);
  assert.match(route, /retrieveKnowledge/);
  assert.match(route, /knowledgeDocuments/);
  assert.match(route, /eq\(knowledgeDocuments\.state, "active"\)/);
});

test("keeps handoff decisions internal to the customer experience", async () => {
  const [page, route] = await Promise.all([source("app/page.tsx"), source("app/api/agent/respond/route.ts")]);
  const customerDemo = page.slice(page.indexOf("function CustomerDemo"), page.indexOf("export default function Home"));
  assert.doesNotMatch(customerDemo, /result\?\.handoff/);
  assert.doesNotMatch(customerDemo, /转接人工客服/);
  assert.match(route, /sanitizeCustomerAnswer/);
  assert.match(route, /当前没有命中的可信知识/);
  assert.match(route, /mode: "model-grounded"/);
});

test("ships a traceable database-backed knowledge library", async () => {
  const [seedText, corpusText, schema, bootstrap, api, page] = await Promise.all([
    source("data/knowledge-seed.json"),
    source("data/knowledge-official-corpus.json"),
    source("db/schema.ts"),
    source("app/api/bootstrap/route.ts"),
    source("app/api/knowledge/route.ts"),
    source("app/page.tsx"),
  ]);
  const seed = JSON.parse(seedText);
  const corpus = JSON.parse(corpusText);
  assert.ok(seed.documents.length >= 20);
  assert.equal(new Set(seed.documents.map((item) => item.id)).size, seed.documents.length);
  for (const category of ["refund", "damage", "address", "invoice"]) {
    assert.ok(seed.documents.some((item) => item.category === category));
  }
  assert.ok(seed.documents.filter((item) => item.sourceType === "official" && item.sourceUrl?.startsWith("https://")).length >= 12);
  assert.ok(seed.documents.every((item) => Array.isArray(item.keywords) && item.keywords.length >= 4));
  assert.ok(corpus.documents.length >= 1000);
  assert.equal(new Set(corpus.documents.map((item) => item.id)).size, corpus.documents.length);
  assert.ok(corpus.documents.every((item) => item.state === "review" && item.sourceType === "official" && /^[a-f0-9]{64}$/.test(item.contentSha256)));
  assert.ok(corpus.sources.length >= 20);
  assert.match(schema, /source_type/);
  assert.match(schema, /keywords_json/);
  assert.match(bootstrap, /onConflictDoUpdate/);
  assert.match(api, /documents\.map/);
  assert.match(api, /\.limit\(limit\)\.offset\(offset\)/);
  assert.match(page, /\/api\/knowledge/);
  for (const operatorCapability of [
    "知识运营工作台",
    "优先处理",
    "知识缺口",
    "口径冲突",
    "客服可引用内容",
    "用真实用户问法验证",
    "提交双人复核",
    "灰度发布",
    "发布就绪度",
    "已发布知识查询",
  ]) assert.match(page, new RegExp(operatorCapability));
  assert.match(page, /operatorMode/);
  assert.match(page, /testState !== "passed"/);
  assert.match(page, /当前线上版本不受影响/);
  assert.doesNotMatch(page, /知识条目<\/span><b>1,284/);
});

test("ships a real frontline knowledge reader with citation and feedback workflow", async () => {
  const [page, knowledgeApi, feedbackApi] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/knowledge/route.ts"),
    source("app/api/knowledge/feedback/route.ts"),
  ]);
  assert.match(page, /FrontlineKnowledge/);
  assert.match(page, /已发布知识查询/);
  assert.match(page, /引用到当前会话/);
  assert.match(page, /knowledgeQuote/);
  assert.match(page, /setKnowledgeQuote/);
  assert.match(page, /\/api\/knowledge\/feedback/);
  assert.match(page, /反馈知识问题/);
  for (const category of ["退款售后", "破损质量", "物流改址", "发票服务"]) assert.match(page, new RegExp(category));
  assert.match(knowledgeApi, /searchParams\.get\("category"\)/);
  assert.match(knowledgeApi, /requireKnowledgeActor/);
  assert.doesNotMatch(knowledgeApi, /x-servicepilot-channel/);
  assert.match(feedbackApi, /knowledge\.feedback/);
  assert.match(feedbackApi, /auditLogs/);
  assert.match(feedbackApi, /knowledgeId/);
  assert.match(feedbackApi, /content/);
});

test("ships a governed knowledge feedback queue and permission request flow", async () => {
  const [page, feedbackApi, accessApi, schema, migration] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/knowledge/feedback/route.ts"),
    source("app/api/knowledge/access-requests/route.ts"),
    source("db/schema.ts"),
    source("drizzle/0030_knowledge_feedback_access.sql"),
  ]);
  for (const capability of ["知识反馈闭环", "标记处理中", "标记误报", "标记已解决", "申请治理权限", "申请知识治理权限", "权限申请已提交"]) assert.match(page, new RegExp(capability));
  assert.match(feedbackApi, /knowledgeFeedback/);
  assert.match(feedbackApi, /knowledge\.feedback\.create/);
  assert.match(feedbackApi, /knowledge\.feedback\.update/);
  assert.match(feedbackApi, /处理完成前请填写处理说明/);
  assert.match(accessApi, /knowledgeAccessRequests/);
  assert.match(accessApi, /knowledge\.access_request\.create/);
  assert.match(accessApi, /knowledge\.access_request\.review/);
  assert.match(accessApi, /已有待处理的权限申请/);
  assert.match(schema, /knowledge_feedback/);
  assert.match(schema, /knowledge_access_requests/);
  assert.match(migration, /CREATE TABLE `knowledge_feedback`/);
  assert.match(migration, /CREATE TABLE `knowledge_access_requests`/);
});

test("ships source freshness monitoring with accountable refresh requests", async () => {
  const [page, route, schema, migration] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/knowledge/source-monitor/route.ts"),
    source("db/schema.ts"),
    source("drizzle/0031_knowledge_source_refresh.sql"),
  ]);
  for (const capability of ["来源新鲜度告警", "责任人", "请求重新同步", "同步请求处理中", "重试读取"]) assert.match(page, new RegExp(capability));
  assert.match(route, /knowledgeSourceRefreshRequests/);
  assert.match(route, /knowledgeSourceFreshness/);
  assert.match(route, /knowledgeValidity/);
  assert.match(route, /agentRuns/);
  assert.match(route, /knowledgeConflicts/);
  assert.match(route, /knowledgeFeedback/);
  assert.match(route, /近90天无命中/);
  assert.match(route, /knowledge\.source_refresh\.request/);
  assert.match(route, /已有待处理的重新同步请求/);
  assert.match(schema, /knowledge_source_refresh_requests/);
  assert.match(migration, /CREATE TABLE `knowledge_source_refresh_requests`/);
});

test("ships a real knowledge operations work queue with scoped bulk claim and review", async () => {
  const [page, mutationRoute, schema, migration] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/knowledge/[id]/route.ts"),
    source("db/schema.ts"),
    source("drizzle/0027_low_rictor.sql"),
  ]);
  for (const capability of ["真实知识资产", "按负责人状态筛选", "按责任团队筛选", "知识工作队列排序", "全选当前结果", "批量认领给我", "批量提交复核", "提交真实复核任务"]) assert.match(page, new RegExp(capability));
  assert.match(page, /doc\.validUntil/);
  assert.match(page, /new Date\(a\.validUntil\)/);
  assert.match(page, /const message = action === "claim"/);
  assert.match(page, /确认将 \$\{ids\.length\} 条知识提交复核/);
  assert.match(page, /x-servicepilot-channel.*customer-demo/);
  assert.match(page, /body: JSON\.stringify\(\{ action \}\)/);
  assert.match(schema, /ownerUserId: text\("owner_user_id"\)/);
  assert.match(migration, /ALTER TABLE `knowledge_documents` ADD `owner_user_id`/);
  assert.match(mutationRoute, /action === "claim"/);
  assert.match(mutationRoute, /knowledge\.claim/);
  assert.match(mutationRoute, /action === "submit_review"/);
  assert.match(mutationRoute, /knowledge\.review\.submit/);
  assert.match(mutationRoute, /auditLogs/);
});

test("ships desktop knowledge batch archive and scoped CSV export", async () => {
  const [page, route, exportRoute] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/knowledge/[id]/route.ts"),
    source("app/api/knowledge/export/route.ts"),
  ]);
  for (const capability of ["批量归档", "导出当前结果", "导出已选", "知识导出失败，请缩小范围后重试", "当前账号仅可查看"]) assert.match(page, new RegExp(capability));
  assert.match(page, /action === "archive"/);
  assert.match(page, /method: action === "archive" \? "DELETE" : "PATCH"/);
  assert.match(route, /knowledge\.archive/);
  assert.match(exportRoute, /requireKnowledgeActor\(request, KNOWLEDGE_EDITOR_ROLES\)/);
  assert.match(exportRoute, /inArray\(knowledgeDocuments\.id, ids\)/);
  assert.match(exportRoute, /超过 5000 条/);
  assert.match(exportRoute, /knowledge\.export/);
  assert.match(exportRoute, /const safe =/);
  assert.match(exportRoute, /text\/csv; charset=utf-8/);
});

test("ships tenant-scoped knowledge impact analysis with honest cost data", async () => {
  const [page, route] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/knowledge/impact/route.ts"),
  ]);
  for (const capability of ["发布影响分析 · 最近 30 天真实数据", "命中次数", "引用率", "负反馈率", "转人工率", "零结果率", "相关会话", "成本影响", "knowledge-impact-loading", "knowledge-impact-details", "role=\"alert\""]) assert.match(page, new RegExp(capability));
  assert.match(page, /\/api\/knowledge\/impact\?knowledgeId=/);
  assert.match(page, /AbortController/);
  for (const capability of ["agentRuns", "knowledgeJson", "citationsJson", "knowledge\.feedback", "versionComparison", "estimatedUsd: null"]) assert.match(route, new RegExp(capability));
  assert.match(route, /eq\(agentRuns\.organizationId, organizationId\)/);
  assert.match(route, /gte\(agentRuns\.createdAt, since\)/);
  assert.match(route, /Math\.min\(Math\.max\(Number\(url\.searchParams\.get\("days"/);
});

test("explains knowledge hits with tenant-scoped retrieval evidence", async () => {
  const [page, route] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/knowledge/explain/route.ts"),
  ]);
  for (const capability of ["为什么命中", "关键词命中", "路由意图", "真实检索轨迹与用户问法", "knowledge-explain-loading", "knowledge-explain-details"]) assert.match(page, new RegExp(capability));
  assert.match(page, /\/api\/knowledge\/explain\?knowledgeId=/);
  assert.match(route, /requireKnowledgeActor\(request\)/);
  for (const capability of ["agentRuns", "knowledgeJson", "traceJson", "keywordHits", "indexVersions", "parentIdForDocument", "filterNotes"]) assert.match(route, new RegExp(capability));
  assert.match(route, /eq\(agentRuns\.organizationId, organizationId\)/);
  assert.match(route, /gte\(agentRuns\.createdAt, since\)/);
  assert.match(route, /Math\.min\(Math\.max\(Number\(url\.searchParams\.get\("days"/);
});

test("ships a real knowledge import center with snapshots and conflict feedback", async () => {
  const [page, route] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/knowledge/import/route.ts"),
  ]);
  for (const capability of ["解析并生成草稿", "资料正文", "本次导入", "import-result"]) assert.match(page, new RegExp(capability));
  assert.match(page, /importResult\.conflicts\.length \? "alert" : "status"/);
  assert.match(page, /fetch\("\/api\/knowledge\/import"/);
  for (const capability of ["requireKnowledgeActor", "knowledgeDocuments", "knowledgeVersions", "knowledgeSourceSnapshots", "sha256Hex", "detectKnowledgeConflicts", "knowledge\.import", "splitSource"]) assert.match(route, new RegExp(capability));
  assert.match(route, /KNOWLEDGE_EDITOR_ROLES/);
  assert.match(route, /organizationId/);
  assert.match(route, /syncKnowledgeSearchIndex/);
});

test("routes conversation citations by the stored knowledgeId instead of a fixed refund phrase", async () => {
  const [page, conversationsApi, agentRoute] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/conversations/route.ts"),
    source("app/api/agent/respond/route.ts"),
  ]);
  assert.match(page, /引用当前会话的生效知识/);
  assert.match(page, /insertKnowledgeCitation/);
  assert.match(page, /selected\.citations/);
  assert.doesNotMatch(page, /依据已生效的退款与到账规则/);
  assert.match(conversationsApi, /knowledgeDocuments/);
  assert.match(conversationsApi, /inArray\(knowledgeDocuments\.id/);
  assert.match(conversationsApi, /activeCitationMap/);
  assert.match(conversationsApi, /当前生效引用/);
  assert.match(agentRoute, /sources = \[source/);
  assert.match(agentRoute, /sourceId: source\.id/);
});

test("ships complete CSDS coverage plus a reproducible focused routing evaluation", async () => {
  const [trainText, valText, testText, reportText, completeText, manifestText, api, page] = await Promise.all([
    source("data/eval-csds-full-train.json"),
    source("data/eval-csds-full-val.json"),
    source("data/eval-csds-full-test.json"),
    source("data/routing-full-baseline.json"),
    source("data/routing-csds-complete-baseline.json"),
    source("data/real-data-manifest.json"),
    source("app/api/evaluations/scale/route.ts"),
    source("app/page.tsx"),
  ]);
  const datasets = [JSON.parse(trainText), JSON.parse(valText), JSON.parse(testText)];
  const report = JSON.parse(reportText);
  const complete = JSON.parse(completeText);
  const manifest = JSON.parse(manifestText);
  assert.equal(datasets.reduce((sum, item) => sum + item.cases.length, 0), 4196);
  assert.equal(report.overall.total, 4196);
  assert.equal(complete.raw.dialogues, 10701);
  assert.equal(complete.raw.turns, 277399);
  assert.equal(complete.raw.annotatedQuestions, 21126);
  assert.equal(complete.overall.total, 21126);
  assert.equal(complete.privacy.directIdentifiersFound, 0);
  assert.match(complete.datasetFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(manifest.totals.upstreamDialogues, 10701);
  assert.equal(manifest.totals.fullCoverageEvaluationCases, 21126);
  assert.equal(manifest.quality.duplicateEvaluationQueries, 0);
  assert.equal(manifest.quality.directIdentifiersFound, 0);
  assert.ok(datasets.every((item) => /^[a-f0-9]{64}$/.test(item.freeze.casesSha256)));
  assert.ok(datasets.every((item) => item.privacy.directIdentifiersFound === 0));
  assert.match(api, /trainSet/);
  assert.match(api, /manifest/);
  assert.match(api, /completeBaseline/);
  assert.match(page, /21,126 个标注问题全部逐条测试/);
  assert.match(page, /四类专项场景浏览器/);
  assert.match(page, /全量评测口径/);
});

test("ships a representative offline evaluation seed", async () => {
  const evaluation = JSON.parse(await source("data/eval-seed.json"));
  assert.equal(evaluation.version, "0.1");
  assert.ok(evaluation.cases.length >= 15);
  const categories = new Set(evaluation.cases.map((item) => item.category));
  for (const category of ["normal", "high-risk", "boundary", "unknown", "adversarial", "privacy"]) {
    assert.ok(categories.has(category), `missing category: ${category}`);
  }
  assert.ok(evaluation.cases.some((item) => item.expectedHandoff === true));
  assert.ok(evaluation.cases.some((item) => Array.isArray(item.mustNotContain)));
});

test("ships a traceable, privacy-scanned real-world evaluation set", async () => {
  const evaluation = JSON.parse(await source("data/eval-csds-real.json"));
  assert.equal(evaluation.version, "1.0");
  assert.equal(evaluation.cases.length, 85);
  assert.equal(evaluation.privacy.directIdentifiersFound, 0);
  assert.equal(new Set(evaluation.cases.map((item) => item.id)).size, 85);
  assert.ok(evaluation.cases.every((item) => item.source.dataset === "CSDS" && item.source.dialogueId !== undefined));
  assert.ok(evaluation.cases.every((item) => Array.isArray(item.history) && item.history.length <= 4));
  assert.ok(evaluation.cases.some((item) => item.contextRequired === true));
});

test("ships a frozen blind suite from an unseen upstream split", async () => {
  const blind = JSON.parse(await source("data/eval-csds-blind.json"));
  assert.equal(blind.cases.length, 40);
  assert.equal(blind.freeze.locked, true);
  assert.match(blind.freeze.casesSha256, /^[a-f0-9]{64}$/);
  assert.equal(blind.privacy.directIdentifiersFound, 0);
  assert.ok(blind.cases.every((item) => item.source.split === "val"));
});

test("keeps enterprise tool calls read-only, validated and masked", async () => {
  const [tool, records, agent] = await Promise.all([
    source("app/api/tools/order-refund/route.ts"),
    source("lib/order-tool.ts"),
    source("app/api/agent/respond/route.ts"),
  ]);
  assert.match(records, /\^OR-\\d\{6\}\$/);
  assert.match(records, /paymentChannelMasked/);
  assert.doesNotMatch(records, /refundRecords|OR-773928/);
  assert.match(tool, /readOnly: true/);
  assert.match(tool, /piiMasked: true/);
  assert.match(tool, /tool\.order_refund\.read/);
  assert.match(agent, /订单工具未返回结果，禁止模型猜测/);
  assert.match(agent, /可信工具结果（只读、已脱敏）/);
  assert.match(agent, /订单状态只能引用此结果，不得自行推断/);
  assert.match(agent, /sourceType: "production"/);
});

test("does not ship production mock fallbacks and exposes agent health checks", async () => {
  const [route, page, health, tenant] = await Promise.all([
    source("app/api/agent/respond/route.ts"),
    source("app/page.tsx"),
    source("app/api/health/agent/route.ts"),
    source("lib/tenant.ts"),
  ]);
  assert.doesNotMatch(route, /fallbackRules/);
  assert.doesNotMatch(page, /const tickets =|const conversations:/);
  assert.match(health, /MODEL_CONFIG_INCOMPLETE/);
  assert.match(health, /traceId/);
  assert.match(tenant, /PRODUCTION_ORG_ID/);
  assert.match(tenant, /TEST_ORG_ID/);
});

test("runs guarded model evaluations and exposes the quality dashboard", async () => {
  const [route, reviews, schema, page] = await Promise.all([
    source("app/api/evaluations/route.ts"),
    source("app/api/evaluations/reviews/route.ts"),
    source("db/schema.ts"),
    source("app/page.tsx"),
  ]);
  assert.match(route, /runWithConcurrency\(items, request, retrievalStrategy, 2\)/);
  assert.match(route, /STEP98_V2_SYSTEM_VERSION/);
  assert.match(route, /step98v2before/);
  assert.match(route, /请等待 5 分钟后再次运行/);
  assert.match(route, /realEvaluationSet/);
  assert.match(route, /blindEvaluationSet/);
  assert.match(route, /当前系统版本已经运行过冻结盲测/);
  assert.match(route, /history: item\.history/);
  assert.match(route, /index \+= 4/);
  assert.match(route, /评测运行未完成，系统已记录失败原因/);
  assert.match(route, /run\.status === "completed"/);
  assert.match(route, /知识来源不符合预期/);
  assert.match(route, /转人工决策不符合预期/);
  assert.match(schema, /evaluation_runs/);
  assert.match(schema, /evaluation_results/);
  assert.match(schema, /evaluation_reviews/);
  assert.match(schema, /agent_conversation_states/);
  assert.match(schema, /system_version/);
  assert.match(schema, /source_dataset/);
  assert.match(schema, /context_required/);
  assert.match(schema, /routing_intent/);
  assert.match(schema, /routing_signals_json/);
  assert.match(page, /CSDS 全量覆盖 \+ 混合意图路由 \+ GLM-5\.2 端到端回归/);
  assert.match(page, /未支持意图安全兜底/);
  assert.match(page, /确认系统失败/);
  assert.match(page, /标记标签问题/);
  assert.match(page, /行为可接受/);
  assert.match(page, /30 分钟会话记忆/);
  assert.doesNotMatch(page, /useEffect\(load,/);
  assert.match(page, /createDemoConversationId/);
  assert.match(page, /getRandomValues/);
  assert.doesNotMatch(page, /crypto\.randomUUID\(\)/);
  assert.match(reviews, /Reviewer role required/);
  assert.match(reviews, /evaluation\.review/);
  assert.match(reviews, /onConflictDoUpdate/);
  assert.match(page, /总体通过率/);
  assert.match(page, /高风险通过率/);
});

test("records and reviews versioned hybrid retrieval shadows without switching production answers", async () => {
  const [agent, shadow, analysis, api, schema, config, migration, pointerMigration, reviewMigration, importer] = await Promise.all([
    source("app/api/agent/respond/route.ts"),
    source("lib/retrieval-shadow.ts"),
    source("lib/retrieval-shadow-analysis.ts"),
    source("app/api/retrieval/shadows/route.ts"),
    source("db/schema.ts"),
    source("deploy/wrangler.vps.jsonc"),
    source("drizzle/0012_fancy_mulholland_black.sql"),
    source("drizzle/0013_large_kate_bishop.sql"),
    source("drizzle/0014_fast_wrecker.sql"),
    source("scripts/import-embedding-index.mjs"),
  ]);
  assert.match(agent, /runRetrievalShadow/);
  assert.match(agent, /currentSourceId: rule\.id/);
  assert.match(agent, /getRequestExecutionContext/);
  assert.match(agent, /hybrid-evidence-step9\.2-v1/);
  assert.match(agent, /await shadowPromise/);
  assert.match(agent, /corrective-hybrid-step9\.3-v1/);
  assert.match(agent, /attempts: 1/);
  assert.match(agent, /buildCorrectiveRetrievalQuery/);
  assert.match(agent, /multi-knowledge-step9\.4-v1/);
  assert.match(agent, /selectComplementaryKnowledge/);
  assert.match(agent, /sourceCount/);
  assert.match(agent, /else keepAlive\(shadowPromise\)/);
  assert.match(shadow, /vectorWeight: 0\.5/);
  assert.match(shadow, /applyActionAwareRerank/);
  assert.match(shadow, /currentIndexVersion/);
  assert.match(shadow, /scoreDeltaFromCurrent/);
  assert.match(shadow, /Shadow telemetry must never block the Agent/);
  assert.match(analysis, /minimumConclusiveReviewedChanged: 30/);
  assert.match(analysis, /readyForGrayDesign/);
  assert.match(analysis, /p95LatencyMs/);
  assert.match(api, /retrieval_shadow\.review/);
  assert.match(api, /Only completed candidate changes can be reviewed/);
  assert.match(schema, /knowledge_embeddings/);
  assert.match(schema, /retrieval_shadow_runs/);
  assert.match(schema, /retrieval_shadow_reviews/);
  assert.match(config, /RETRIEVAL_SHADOW_ENABLED/);
  assert.match(migration, /CREATE TABLE `retrieval_shadow_runs`/);
  assert.match(pointerMigration, /CREATE TABLE `embedding_index_versions`/);
  assert.match(reviewMigration, /CREATE TABLE `retrieval_shadow_reviews`/);
  assert.match(importer, /INSERT OR REPLACE INTO knowledge_embeddings/);
  assert.match(importer, /INSERT OR REPLACE INTO embedding_index_versions/);
});

test("freezes independent 100-case CSDS suites and configured generation model", async () => {
  const [route, config, rawDataset, rawHoldout, rawHoldout3] = await Promise.all([
    source("app/api/evaluations/route.ts"),
    source("deploy/wrangler.vps.jsonc"),
    source("data/eval-csds-generalization-100.json"),
    source("data/eval-csds-holdout2-100.json"),
    source("data/eval-csds-holdout3-100.json"),
  ]);
  const dataset = JSON.parse(rawDataset);
  const holdout = JSON.parse(rawHoldout);
  const holdout3 = JSON.parse(rawHoldout3);
  assert.equal(dataset.version, "1.0-csds-train-new-agent100");
  assert.equal(dataset.cases.length, 100);
  assert.equal(new Set(dataset.cases.map((item) => String(item.source.dialogueId))).size, 100);
  assert.deepEqual(dataset.sampling.quotas, { refund: 25, invoice: 25, address: 25, damage: 25 });
  assert.equal(dataset.sampling.contextRequired, 24);
  assert.equal(dataset.freeze.casesSha256, "bc7faf1a8169a5f525b32a34b0c3ceadb47d586025008fed4b4b5df8e4d6dd4e");
  assert.equal(holdout.version, "1.0-csds-train-holdout2-agent100");
  assert.equal(holdout.cases.length, 100);
  assert.equal(new Set(holdout.cases.map((item) => String(item.source.dialogueId))).size, 100);
  assert.equal(holdout.sampling.contextRequired, 23);
  assert.equal(holdout.freeze.casesSha256, "832b4e91c419ff19e88148a98e19205cac6e34befb65d7c39befdcdc0e281656");
  const developmentDialogueIds = new Set(dataset.cases.map((item) => String(item.source.dialogueId)));
  assert.equal(holdout.cases.some((item) => developmentDialogueIds.has(String(item.source.dialogueId))), false);
  const observedDialogueIds = new Set([...developmentDialogueIds, ...holdout.cases.map((item) => String(item.source.dialogueId))]);
  assert.equal(holdout3.version, "1.0-csds-train-holdout3-agent100");
  assert.equal(holdout3.cases.length, 100);
  assert.equal(new Set(holdout3.cases.map((item) => String(item.source.dialogueId))).size, 100);
  assert.equal(holdout3.sampling.contextRequired, 32);
  assert.equal(holdout3.freeze.casesSha256, "612abf2cc546941fd982cf3d025a439527b6e27902890824a75fa3f6facf3fec");
  assert.equal(holdout3.cases.some((item) => observedDialogueIds.has(String(item.source.dialogueId))), false);
  assert.match(route, /suite: "regression" \| "blind" \| "generalization" \| "holdout" \| "holdout3"/);
  assert.match(route, /EVALUATION_MODEL = "minimax-m3"/);
  assert.match(route, /constrained-hybrid-step9\.1-v1/);
  assert.match(route, /hybrid-evidence-step9\.2-v1/);
  assert.match(route, /= "step91"/);
  assert.match(config, /"LLM_MODEL": "minimax-m3"/);
});

test("ships tenant-scoped personal and team knowledge views with permission audit", async () => {
  const [page, api, detail, schema, migration] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/knowledge/views/route.ts"),
    source("app/api/knowledge/views/[id]/route.ts"),
    source("db/schema.ts"),
    source("drizzle/0028_knowledge_saved_views.sql"),
  ]);
  assert.match(page, /已保存视图/);
  assert.match(page, /负责人范围/);
  assert.match(page, /团队共享视图/);
  assert.match(page, /保存当前筛选/);
  assert.match(page, /knowledgeViewDialogRef/);
  assert.match(page, /knowledgeView/);
  assert.match(api, /knowledgeSavedViews/);
  assert.match(api, /requireKnowledgeActor/);
  assert.match(api, /knowledge_view\.create/);
  assert.match(api, /创建团队共享视图需要主管或管理员权限/);
  assert.match(api, /eq\(knowledgeSavedViews\.organizationId, organizationId\)/);
  assert.match(detail, /你没有编辑该视图的权限/);
  assert.match(detail, /knowledge_view\.update/);
  assert.match(detail, /knowledge_view\.delete/);
  assert.match(schema, /knowledge_saved_views/);
  assert.match(schema, /owner_user_id/);
  assert.match(migration, /CREATE TABLE/);
  assert.match(migration, /knowledge_saved_views/);
});
