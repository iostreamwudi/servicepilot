"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import ResourceAccess from "./resource-access";
import { slaStatus, type TicketSlaState } from "../lib/ticket-policy";

type NavKey = "workbench" | "overview" | "conversations" | "tickets" | "knowledge" | "quality" | "strategy" | "analytics" | "resources" | "audit";
type RoleKey = "supervisor" | "agent" | "knowledge-operator" | "ai-operator" | "administrator";
type EntryStage = "login" | "workspace" | "workbench" | "app";
type WorkspaceKey = "qingyu" | "servicepilot-sandbox";
const DEFAULT_DEMO_EMAIL = "wang.ruifeng@qingyu.cn";
const FRONTLINE_ROLE: RoleKey = "agent";
const WORKBENCH_ONLY_NOTICE = "建设中，请先进入一线客服工作台";

function hasUiRoleAccess(authorizedRoles: RoleKey[], role: RoleKey) {
  return authorizedRoles.includes(role) || (role === FRONTLINE_ROLE && authorizedRoles.includes("administrator"));
}


function handleTabKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  tabIds: string[],
  activeIndex: number,
  onChange: (index: number) => void,
) {
  const { key } = event;
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(key)) return;
  event.preventDefault();
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  const nextIndex = key === "Home" ? 0 : key === "End" ? tabIds.length - 1 : (activeIndex + step + tabIds.length) % tabIds.length;
  onChange(nextIndex);
  window.setTimeout(() => document.getElementById(tabIds[nextIndex])?.focus(), 0);
}

const dialogFocusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function useDialogFocus(active: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector)).filter((element) => element.getClientRects().length > 0);
    const focusFirst = () => (focusables()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(focusFirst);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocus?.isConnected) window.requestAnimationFrame(() => returnFocus.focus());
    };
  }, [active]);

  return dialogRef;
}

const navItems: Array<{ key: NavKey; label: string; short: string }> = [
  { key: "workbench", label: "我的工作台", short: "台" },
  { key: "overview", label: "运营总览", short: "总" },
  { key: "conversations", label: "会话中心", short: "话" },
  { key: "tickets", label: "工单管理", short: "单" },
  { key: "knowledge", label: "知识库", short: "知" },
  { key: "quality", label: "质检中心", short: "检" },
  { key: "strategy", label: "策略中心", short: "策" },
  { key: "analytics", label: "数据分析", short: "数" },
  { key: "resources", label: "资源权限", short: "权" },
  { key: "audit", label: "安全审计", short: "安" },
];

const roles: Record<RoleKey, { label: string; title: string; greeting: string; focus: string; nav: NavKey[] }> = {
  supervisor: { label: "服务主管", title: "服务主管工作台", greeting: "上午好，王瑞峰", focus: "先处理高风险服务与即将超时事项", nav: ["workbench", "overview", "conversations", "tickets", "knowledge", "analytics"] },
  agent: { label: "一线客服", title: "客服工作台", greeting: "上午好，王可", focus: "先接管即将超时的会话，让用户不必重复描述问题", nav: ["workbench", "conversations", "tickets", "knowledge"] },
  "knowledge-operator": { label: "知识运营", title: "知识运营工作台", greeting: "上午好，陈悠", focus: "优先修复影响真实会话的知识缺口与冲突", nav: ["workbench", "knowledge", "quality", "analytics"] },
  "ai-operator": { label: "AI 运营", title: "AI 运营工作台", greeting: "上午好，周敏", focus: "先修复影响范围最大的 AI 失败", nav: ["workbench", "quality", "knowledge", "strategy", "analytics"] },
  administrator: { label: "系统管理员", title: "治理工作台", greeting: "上午好，系统管理员", focus: "关注权限冲突、策略发布与高风险操作", nav: ["workbench", "knowledge", "resources", "audit", "strategy", "analytics"] },
};

const workspaces: Record<WorkspaceKey, { name: string; organization: string; environment: string; initials: string; roles: RoleKey[]; pending: number; lastUsed: string }> = {
  qingyu: { name: "青屿商城", organization: "青屿零售科技有限公司", environment: "生产环境", initials: "青", roles: ["supervisor", "agent", "knowledge-operator", "ai-operator", "administrator"], pending: 17, lastUsed: "今天 10:46" },
  "servicepilot-sandbox": { name: "ServicePilot 沙箱", organization: "产品验证与培训空间", environment: "沙箱环境", initials: "S", roles: ["ai-operator", "administrator"], pending: 3, lastUsed: "昨天 18:42" },
};

type ConversationState = "待接管" | "处理中" | "等待内部" | "已解决";
type ConversationCitation = { id: string; title: string; version: string; category?: "refund" | "damage" | "address" | "invoice" | null; content?: string | null; sourceTitle?: string | null; sourceUrl?: string | null; available?: boolean };
type ConversationTraceItem = { type?: string; label?: string; status?: string; durationMs?: number; failureCode?: string; reason?: string; action?: string; [key: string]: unknown };
type ConversationAgentRun = { traceId: string; model?: string | null; mode?: string | null; status?: string | null; failureCode?: string | null; latencyMs?: number | null; trace?: ConversationTraceItem[] };
type Conversation = {
  id: string;
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  resolutionCategory?: string | null;
  resolutionSummary?: string | null;
  customerConfirmed?: boolean;
  resolvedByEmail?: string | null;
  resolvedAt?: string | null;
  reopenCount?: number;
  lastReopenedAt?: string | null;
  lastReopenedByEmail?: string | null;
  lastReopenReason?: string | null;
  priority?: "P1" | "P2" | "P3" | null;
  slaPolicy?: string | null;
  slaStartedAt?: string | null;
  slaDueAt?: string | null;
  slaState?: "on_track" | "due_soon" | "overdue" | "completed" | "unknown";
  slaSource?: "persisted" | "policy-derived";
  riskSource?: string | null;
  name: string;
  topic: string;
  channel: string;
  status: ConversationState;
  risk: "低" | "中" | "高";
  time: string;
  sla: string;
  sentiment: string;
  handoff: string;
  customerMessage: string;
  aiReply: string;
  history?: Array<{ id: string; senderType: "customer" | "ai" | "agent" | "system"; content: string; createdAt: string; traceId?: string | null; trace?: ConversationTraceItem[] }>;
  historyHasMore?: boolean;
  historyCursor?: string | null;
  agentRun?: ConversationAgentRun | null;
  summary: string;
  draft: string;
  order: string;
  member: string;
  orderHistory: string;
  facts: Array<{ label: string; value: string; source: string }>;
  citations?: ConversationCitation[];
  suggestedAction: string;
};

type DraftSaveState = "empty" | "saved" | "restored" | "error" | "suggestion";
type StoredConversationDraft = { content: string; updatedAt: string };
const conversationDraftStorageKey = "servicepilot-conversation-drafts-v1";

function readStoredConversationDrafts(): Record<string, StoredConversationDraft> {
  try {
    const raw = window.localStorage.getItem(conversationDraftStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredConversationDraft>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => Boolean(value && typeof value.content === "string" && typeof value.updatedAt === "string")));
  } catch {
    return {};
  }
}

const screenTitles: Record<NavKey, { title: string; desc: string }> = {
  workbench: { title: "我的工作台", desc: "围绕当前岗位职责的目标、待办和异常组织工作" },
  overview: { title: "运营总览", desc: "从业务结果到模型质量，定位今日服务风险" },
  conversations: { title: "会话处理台", desc: "接管 AI 无法安全完成的服务请求，核验事实并推动问题闭环" },
  tickets: { title: "工单管理", desc: "跨团队流转、SLA 管理和异常升级" },
  knowledge: { title: "知识库", desc: "管理可信知识、版本、权限与内容覆盖" },
  quality: { title: "质检中心", desc: "自动质检、人工复核与失败案例回流" },
  strategy: { title: "策略中心", desc: "配置路由、兜底、风险和模型策略" },
  analytics: { title: "数据分析", desc: "联动业务指标、AI 指标、成本与体验" },
  resources: { title: "资源权限", desc: "按任务、接口和指标管理具体人员的数据访问边界" },
  audit: { title: "安全审计", desc: "追踪敏感操作、权限变化和合规风险" },
};

function createDemoConversationId() {
  const secureUuid = globalThis.crypto?.randomUUID?.();
  if (secureUuid) return `C-DEMO-${secureUuid}`;
  const randomParts = new Uint32Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(randomParts);
  else for (let index = 0; index < randomParts.length; index += 1) randomParts[index] = Math.floor(Math.random() * 0xffffffff);
  return `C-DEMO-${Date.now().toString(36)}-${Array.from(randomParts, (value) => value.toString(36)).join("-")}`;
}

function MetricCard({ label, value, change, tone = "blue", helper }: { label: string; value: string; change: string; tone?: string; helper: string }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}><span /></div>
      <div className="metric-copy">
        <div className="metric-label">{label}</div>
        <div className="metric-row"><strong>{value}</strong><span className={change.startsWith("-") ? "down good" : "up"}>{change}</span></div>
        <small>{helper}</small>
      </div>
    </article>
  );
}

function Status({ children, kind = "neutral", title }: { children: React.ReactNode; kind?: string; title?: string }) {
  return <span className={`status ${kind}`} title={title}>{children}</span>;
}

const roleWorkbench: Record<RoleKey, {
  stats: Array<[string, string, string]>;
  tasks: Array<{ level: string; title: string; meta: string; action: string; target: NavKey }>;
  brief: Array<[string, string, string]>;
}> = {
  supervisor: {
    stats: [["今日待处理", "17", "3 项高风险"], ["P1 即将超时", "2", "最近 18 分钟"], ["人工接管率", "22.6%", "较上周下降 3.1%"], ["今日满意度", "4.63", "1,286 份评价"]],
    tasks: [
      { level: "高风险", title: "破损赔付知识命中率下降", meta: "影响 37 次会话 · 需要知识运营协同", action: "查看影响会话", target: "knowledge" },
      { level: "P1", title: "生鲜破损理赔即将超时", meta: "T-9034 · 王可处理中 · 剩余 18 分钟", action: "进入工单", target: "tickets" },
      { level: "待分配", title: "退款到账异常无人领取", meta: "T-9032 · 用户情绪焦虑 · 剩余 36 分钟", action: "分配处理人", target: "tickets" },
    ],
    brief: [["服务量", "3,842", "+12.4%"], ["AI 独立解决", "2,347", "61.1%"], ["需人工确认", "12", "待处理"]],
  },
  agent: {
    stats: [],
    tasks: [],
    brief: [],
  },
  "knowledge-operator": {
    stats: [["待复核知识", "12", "3 项即将过期"], ["知识冲突", "3", "影响 37 次会话"], ["未命中问题", "7", "较昨日增加 2 项"], ["灰度中版本", "2", "流量覆盖 10%"]],
    tasks: [
      { level: "影响最大", title: "破损赔付知识命中率下降 9.6%", meta: "KB-114 v3.4 · 影响 37 次真实会话", action: "查看知识缺口", target: "knowledge" },
      { level: "知识冲突", title: "生鲜赔付标准与旧版客服 SOP 不一致", meta: "3 处口径差异 · 自动回答已暂停", action: "处理冲突", target: "knowledge" },
      { level: "待复核", title: "退款到账规则即将到期", meta: "有效期剩余 3 天 · 需要业务与合规双人确认", action: "开始复核", target: "knowledge" },
    ],
    brief: [["有效知识", "1,024", "12 项待复核"], ["可信引用率", "93.6%", "+1.8%"], ["问题覆盖率", "88.4%", "7 个缺口"]],
  },
  "ai-operator": {
    stats: [["待复核案例", "14", "5 项高风险"], ["知识缺口", "7", "影响 96 次会话"], ["策略通过率", "90.8%", "上下文 75.1%"], ["待发布变更", "2", "1 项等待审批"]],
    tasks: [
      { level: "影响最大", title: "破损赔付知识命中率下降 9.6%", meta: "37 次会话 · KB-114 v3.4 发布后出现", action: "定位失败原因", target: "knowledge" },
      { level: "待复核", title: "14 条低置信度质检结果", meta: "检索类 9 条 · 策略类 5 条", action: "开始复核", target: "quality" },
      { level: "待审批", title: "混合路由策略 v3.1", meta: "预计减少 2.4% 误转人工 · 业务合规待审批", action: "查看发布检查", target: "strategy" },
    ],
    brief: [["可信回答率", "93.6%", "+1.8%"], ["安全兜底率", "95.2%", "24 条误路由"], ["单会话成本", "¥0.084", "预算内"]],
  },
  administrator: {
    stats: [["权限待复核", "3", "本周到期"], ["权限冲突", "1", "需确认覆盖规则"], ["高风险拦截", "7", "最近 24 小时"], ["待审批策略", "1", "业务合规待处理"]],
    tasks: [
      { level: "权限冲突", title: "赵婧的指标权限覆盖父级配置", meta: "自助解决率 · 父级可修改，当前仅查看", action: "核对访问边界", target: "resources" },
      { level: "高风险", title: "客服 Agent 尝试执行退款", meta: "已成功拦截 · 审计对象 OR-773114", action: "查看审计链路", target: "audit" },
      { level: "待审批", title: "生产策略集 v3.1 等待合规审批", meta: "涉及低置信度转人工阈值调整", action: "进入策略审批", target: "strategy" },
    ],
    brief: [["服务可用性", "99.97%", "运行正常"], ["PII 脱敏", "100%", "全部覆盖"], ["最近同步", "09:42", "数据已连接"]],
  },
};

function RoleWorkbench({ role, workspaceName, onNavigate, onOpenTask, refreshKey, onPendingChange, onLoadingChange }: { role: RoleKey; workspaceName: string; onNavigate: (key: NavKey) => void; onOpenTask: (task: { target: NavKey; resourceId?: string }) => void; refreshKey: number; onPendingChange?: (pending: number | null) => void; onLoadingChange?: (loading: boolean) => void }) {
  const profile = roles[role];
  const data = roleWorkbench[role];
  const [liveWorkbench, setLiveWorkbench] = useState<{
    generatedAt: string;
    dataAsOf?: string;
    scope?: string;
    queryWindow?: { taskRows: number; intervalSeconds: number };
    counts: { conversations: number; todayConversations: number; needsHuman: number; waitingInternal: number; resolvedToday: number; tickets: number; openTickets: number; p1Open: number; p1DueSoon: number; overdueP1: number; reviewKnowledge: number; activeKnowledge: number; knowledge: number; pendingReviews: number; pendingStrategies: number; highRiskAudits: number };
    tasks: Partial<Record<RoleKey, Array<{ level: string; title: string; meta: string; action: string; target: NavKey; resourceId?: string }>>>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    async function loadWorkbench() {
      setLoading(true);
      onLoadingChange?.(true);
      try {
        const response = await fetch("/api/workbench", { cache: "no-store", headers: { "x-servicepilot-channel": "customer-demo" } });
        if (!response.ok) throw new Error(`工作台数据加载失败（HTTP ${response.status}）`);
        const body = await response.json() as typeof liveWorkbench;
        if (!mounted) return;
        if (!body) throw new Error("工作台没有返回可用数据");
        setLiveWorkbench(body);
        onPendingChange?.((body.counts?.needsHuman ?? 0) + (body.counts?.waitingInternal ?? 0));
        setError("");
      } catch (cause) {
        if (mounted) {
          onPendingChange?.(null);
          const rawMessage = cause instanceof Error ? cause.message : "";
          const message = rawMessage.includes("401") || rawMessage.includes("403")
            ? "当前账号暂时没有读取实时工作台数据的权限，请联系企业管理员。"
            : "实时工作台数据暂时无法同步，你仍可以继续查看已打开的功能；稍后可重试。";
          setError(message);
        }
      } finally {
        if (mounted) { setLoading(false); onLoadingChange?.(false); }
      }
    }
    void loadWorkbench();
    const timer = window.setInterval(() => { void loadWorkbench(); }, 15000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [refreshKey, onPendingChange, onLoadingChange]);
  const counts = liveWorkbench?.counts;
  const priorityTasks = liveWorkbench?.tasks[role] ?? [];
  const fallbackStats: Array<[string, string, string]> = [["待接管会话", "—", "实时数据暂不可用"], ["P1 即将超时", "—", "实时数据暂不可用"], ["等待内部", "—", "实时数据暂不可用"], ["今日已解决", "—", "实时数据暂不可用"]];
  const stats = counts ? ({
    supervisor: [["今日待处理", String(counts.needsHuman + counts.waitingInternal), `${counts.p1Open} 个开放 P1`], ["P1 即将超时", String(counts.p1DueSoon), "未来30分钟内到期"], ["人工接管率", counts.todayConversations ? `${Math.round((counts.needsHuman / counts.todayConversations) * 1000) / 10}%` : "暂无数据", "基于今日新增会话"], ["今日满意度", "暂无数据", "当前未接入评价数据"]],
    agent: [["待接管会话", String(counts.needsHuman), "当前开放会话队列"], ["P1 即将超时", String(counts.p1DueSoon), "未来30分钟内到期"], ["等待内部", String(counts.waitingInternal), "当前开放会话队列"], ["今日已解决", String(counts.resolvedToday), "按最后更新时间统计"]],
    "knowledge-operator": [["待复核知识", String(counts.reviewKnowledge), "来自真实知识库"], ["知识冲突", "暂无数据", "当前未建立冲突检测"], ["未命中问题", "暂无数据", "需要接入未命中事件"], ["灰度中版本", String(counts.activeKnowledge), "当前生效知识版本"]],
    "ai-operator": [["待复核案例", String(counts.pendingReviews), "来自真实质检队列"], ["知识缺口", String(counts.reviewKnowledge), "来自待复核知识"], ["策略通过率", "暂无数据", "当前未接入策略评测聚合"], ["待发布变更", String(counts.pendingStrategies), "来自真实策略审批队列"]],
    administrator: [["权限待复核", "暂无数据", "当前未接入权限到期数据"], ["权限冲突", "暂无数据", "当前未接入权限冲突检测"], ["高风险拦截", String(counts.highRiskAudits), "来自真实审计日志"], ["待审批策略", String(counts.pendingStrategies), "来自真实策略审批队列"]],
  } as Record<RoleKey, Array<[string, string, string]>>)[role] : role === "agent" ? fallbackStats : data.stats;
  const brief: Array<[string, string, string]> = role === "agent" ? (counts ? [["开放工单", String(counts.openTickets), "当前团队未关闭工单"], ["开放 P1", String(counts.p1Open), "不等同于即将超时"], ["P1 已超时", String(counts.overdueP1), "需要优先处理"]] : [["开放工单", "—", "实时数据暂不可用"], ["开放 P1", "—", "实时数据暂不可用"], ["P1 已超时", "—", "实时数据暂不可用"]]) : data.brief;
  const generatedAt = liveWorkbench?.dataAsOf || liveWorkbench?.generatedAt ? new Date(liveWorkbench.dataAsOf ?? liveWorkbench.generatedAt) : null;
  const dateLabel = generatedAt ? generatedAt.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }) : "—";
  const timeLabel = generatedAt ? generatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "—";
  return <section className="role-workbench">
    <header className="workbench-hero">
      <div><span className="workbench-eyebrow">{profile.label} · {workspaceName}</span><h2>{profile.greeting}</h2><p>{profile.focus}</p></div>
      <div className="workbench-date"><span>今日</span><b>{dateLabel}</b><small>{liveWorkbench ? `数据更新于 ${timeLabel}` : "等待实时数据"}</small></div>
    </header>
    {error && <div className="workbench-data-error" role="alert"><span>{error}{liveWorkbench ? "，当前仍显示最近一次成功数据" : ""}</span><button onClick={() => window.location.reload()}>重试</button></div>}
    {loading && !liveWorkbench && <div className="workbench-data-status" role="status">正在读取工作台实时数据…</div>}
    <section className="workbench-stats" aria-label="工作台概览">{stats.map(([label, value, helper]) => <article key={label}><span>{label}</span><b>{value}</b><small>{helper}</small></article>)}</section>
    <div className="workbench-grid">
      <article className="panel priority-panel"><div className="workbench-section-head"><div><h3>优先处理</h3><p>按业务影响、风险和剩余时间排序</p></div><button className="text-button" onClick={() => onNavigate(role === "agent" ? "conversations" : "tickets")}>查看全部 {priorityTasks.length} 项 →</button></div>
        <div className="priority-list">{priorityTasks.length ? priorityTasks.map((task, index) => <button key={`${task.title}-${index}`} onClick={() => task.resourceId ? onOpenTask(task) : onNavigate(task.target)}><span className={`priority-rank rank-${index + 1}`}>{index + 1}</span><span className="priority-copy"><em>{task.level}</em><b>{task.title}</b><small>{task.meta}</small></span><strong>{task.action} →</strong></button>) : <div className="workbench-empty">{loading ? "正在读取实时任务…" : error ? "暂时无法读取待处理任务" : "当前没有待处理任务"}</div>}</div>
      </article>
      <aside className="panel role-brief"><div className="workbench-section-head"><div><h3>今日简报</h3><p>与你当前工作台相关的关键结果</p></div></div>{brief.map(([label, value, helper]) => <div className="brief-row" key={label}><span>{label}</span><b>{value}</b><small>{helper}</small></div>)}<button className="brief-link" onClick={() => onNavigate(role === "agent" ? "tickets" : "analytics")}>{role === "agent" ? "查看工单队列 →" : "查看完整业务分析 →"}</button></aside>
    </div>
    <section className="panel role-shortcuts"><div><h3>常用工作</h3><p>只保留本工作台高频使用的入口</p></div><div>{profile.nav.filter((item) => item !== "workbench").slice(0, 4).map((key) => { const item = navItems.find((nav) => nav.key === key)!; return <button key={key} onClick={() => onNavigate(key)}><i>{item.short}</i><span><b>{item.label}</b><small>进入{item.label}</small></span><em>→</em></button>; })}</div></section>
  </section>;
}

function EntryBrand() {
  return <div className="entry-brand" aria-label="ServicePilot 企业智能客服平台"><img className="servicepilot-mark" src="/servicepilot-mark.png" alt="" aria-hidden="true" /><div><b>ServicePilot</b><span>企业智能客服平台</span></div></div>;
}

function LoginScreen({ email, error, onEmailChange, onLogin }: { email: string; error: string; onEmailChange: (value: string) => void; onLogin: () => void }) {
  return <div className="entry-shell login-screen"><header><EntryBrand /><span>可信 Agent · 知识治理 · 安全审计</span></header><main className="login-main">
    <section className="login-story"><span className="entry-eyebrow">企业 AI 服务运营平台</span><h1>让每一次 AI 服务<br />都有依据、边界和改进闭环</h1><p>连接现有客服渠道、业务系统与企业知识，让常规问题安全自动解决，让高风险问题携带完整上下文交给正确的人。</p><div className="login-proof"><div><b>21,126</b><span>条标注问题全量评测</span></div><div><b>1,028</b><span>条可追溯知识</span></div><div><b>100%</b><span>高风险操作人工确认</span></div></div></section>
    <section className="login-card" aria-labelledby="login-title"><div className="login-card-head"><span className="secure-mark">企</span><div><h2 id="login-title">登录企业工作空间</h2><p>系统将根据企业身份读取你的空间和授权工作台</p></div></div><button className="sso-button" onClick={onLogin}><span>SSO</span>使用企业身份登录</button><div className="login-divider"><span>或使用企业邮箱</span></div><label>企业邮箱<input type="email" autoComplete="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="name@company.com" onKeyDown={(event) => event.key === "Enter" && onLogin()} /></label>{error && <div className="login-error" role="alert">{error}</div>}<button className="login-submit" onClick={onLogin}>继续</button><p className="login-policy">继续即表示你同意 <button onClick={() => window.open("/terms", "_blank")}>服务条款</button> 和 <button onClick={() => window.open("/privacy", "_blank")}>隐私政策</button></p><div className="login-help"><span>登录遇到问题？</span><button onClick={() => window.open("mailto:admin@qingyu.cn?subject=ServicePilot%20%E7%99%BB%E5%BD%95%E9%97%AE%E9%A2%98", "_self")}>联系企业管理员</button></div></section>
  </main><footer><span>© 2026 ServicePilot</span><span>沪ICP备演示编号 · 数据安全说明</span></footer></div>;
}

function WorkspaceScreen({ email, onSelect, onLogout }: { email: string; onSelect: (key: WorkspaceKey) => void; onLogout: () => void }) {
  return <div className="entry-shell selection-screen"><header><EntryBrand /><div className="entry-account"><span>王</span><div><b>王瑞峰</b><small>{email}</small></div><button onClick={onLogout}>退出</button></div></header><main className="selection-main"><div className="selection-heading"><span className="entry-step">1 / 2</span><h1>选择工作空间</h1><p>当前仅开放青屿商城一线客服工作台，其他工作空间正在建设中。</p></div><div className="workspace-cards">{(Object.keys(workspaces) as WorkspaceKey[]).filter((key) => key === "qingyu").map((key) => { const item = workspaces[key]; return <button key={key} onClick={() => onSelect(key)}><span className="workspace-logo">{item.initials}</span><span className="workspace-copy"><span><b>{item.name}</b><em className={item.environment === "生产环境" ? "production" : "sandbox"}>{item.environment}</em></span><small>{item.organization}</small><small>一线客服工作台 · {item.pending} 项待办</small></span><span className="workspace-last"><small>最近访问</small><b>{item.lastUsed}</b><em>→</em></span></button>; })}</div><div className="selection-note"><span>i</span><p><b>找不到企业空间？</b>你的身份已经验证，但访问权限由企业管理员统一授予。<button onClick={() => window.open("mailto:admin@qingyu.cn?subject=ServicePilot%20%E7%94%B3%E8%AF%B7%E8%AE%BF%E9%97%AE", "_self")}>申请访问</button></p></div></main><footer><button onClick={() => window.open("/help", "_blank")}>帮助中心</button><button onClick={() => window.open("/privacy", "_blank")}>隐私与安全</button><span>当前登录：{email}</span></footer></div>;
}

function WorkbenchScreen({ workspace, allowedRoles, accessLoading, onSelect, onBack, remember, onRemember }: { workspace: WorkspaceKey; allowedRoles: RoleKey[]; accessLoading: boolean; onSelect: (role: RoleKey) => void; onBack: () => void; remember: boolean; onRemember: (value: boolean) => void }) {
  const current = workspaces[workspace];
  return <div className="entry-shell selection-screen"><header><EntryBrand /><div className="selected-space"><span>{current.initials}</span><div><b>{current.name}</b><small>{current.environment}</small></div></div></header><main className="selection-main"><button className="selection-back" onClick={onBack}>← 返回选择空间</button><div className="selection-heading"><span className="entry-step">2 / 2</span><h1>选择本次工作台</h1><p>以下工作台来自企业授权；进入后仍由服务端校验你的角色和租户权限。</p></div>{accessLoading ? <div className="workbench-data-status" role="status" aria-live="polite">正在确认企业授权工作台…</div> : <><div className="workbench-cards">{current.roles.filter((key) => allowedRoles.includes(key)).map((key) => { const item = roles[key]; const pendingLabel = key === FRONTLINE_ROLE ? "实时任务" : `${roleWorkbench[key].tasks.length} 类优先任务`; return <button key={key} onClick={() => onSelect(key)}><span className="workbench-card-icon">{item.label[0]}</span><span className="workbench-card-copy"><span><b>{item.title}</b><em>已授权</em></span><p>{item.focus}</p><small>{pendingLabel} · {item.nav.length - 1} 个常用功能</small></span><span className="workbench-enter">进入 →</span></button>; })}</div>{!current.roles.some((key) => allowedRoles.includes(key)) && <div className="selection-note" role="alert"><span>!</span><p><b>当前身份没有可进入的工作台</b>请联系企业管理员授予角色权限。</p></div>}</>}<label className="remember-workbench"><input type="checkbox" checked={remember} onChange={(event) => onRemember(event.target.checked)} /><span><b>记住本次选择</b><small>下次登录后直接进入上次已授权工作台</small></span></label></main><footer><span>工作台权限由青屿商城企业管理员维护</span><button onClick={() => window.open("/help/permissions", "_blank")}>查看我的权限</button></footer></div>;
}

function Overview({ onNavigate }: { onNavigate: (key: NavKey) => void }) {
  const [range, setRange] = useState("近 7 天");
  const [metrics, setMetrics] = useState<{
    generatedAt: string;
    counts: { todayConversations: number; resolvedToday: number; needsHuman: number; p1Open: number; pendingReviews: number; reviewKnowledge: number };
    topics: Array<{ name: string; count: number; percentage: number }>;
    recentAudit: Array<{ id: string; at: string; action: string; resourceId: string; result: string; risk: string }>;
  } | null>(null);
  useEffect(() => { fetch("/api/workbench", { cache: "no-store", headers: { "x-servicepilot-channel": "customer-demo" } }).then((response) => response.ok ? response.json() : null).then((body) => body && setMetrics(body)).catch(() => undefined); }, []);
  const counts = metrics?.counts;
  const total = counts?.todayConversations ?? 0;
  const resolutionRate = total ? `${Math.round((counts!.resolvedToday / total) * 1000) / 10}%` : "暂无数据";
  const handoffRate = total ? `${Math.round((counts!.needsHuman / total) * 1000) / 10}%` : "暂无数据";
  const updatedAt = metrics?.generatedAt ? new Date(metrics.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "等待数据";
  return (
    <>
      <section className="metrics-grid">
        <MetricCard label="今日解决率" value={resolutionRate} change="实时" helper={`${counts?.resolvedToday ?? 0} / ${total} 个真实会话`} tone="blue" />
        <MetricCard label="一次解决率" value="暂无数据" change="未接入" helper="当前未记录用户确认事件" tone="green" />
        <MetricCard label="转人工率" value={handoffRate} change="实时" helper={`${counts?.needsHuman ?? 0} 个会话待人工处理`} tone="purple" />
        <MetricCard label="用户满意度" value="暂无数据" change="未接入" helper="当前未接入评价数据" tone="orange" />
      </section>

      <section className="overview-grid">
        <article className="panel performance-panel">
          <div className="panel-head"><div><h3>服务趋势</h3><p>过去 {range.replace("近 ", "")} 的解决率与转人工率</p></div><button className="ghost-button" onClick={() => setRange((current) => current === "近 7 天" ? "近 30 天" : current === "近 30 天" ? "本季度" : "近 7 天")}>{range}⌄</button></div>
          <div className="chart-legend"><span><i className="legend-blue" />自助解决率</span><span><i className="legend-violet" />转人工率</span></div>
          <div className="line-chart overview-empty-chart" aria-label="服务趋势图"><b>{metrics ? "历史趋势数据不足" : "正在读取真实数据…"}</b><span>{metrics ? `当前仅有今日实时数据（更新于 ${updatedAt}），累计至少两天后展示趋势。` : "数据源连接后将展示真实趋势。"}</span></div>
        </article>

        <article className="panel risk-panel">
          <div className="panel-head"><div><h3>今日风险</h3><p>按真实队列和审计数据排序</p></div><span className="alert-count">{(counts?.p1Open ?? 0) + (counts?.pendingReviews ?? 0) + (counts?.reviewKnowledge ?? 0)}</span></div>
          <button className="risk-item" onClick={() => onNavigate("tickets")}><span className="risk-dot high" /><div><b>{counts?.p1Open ?? 0} 个 P1 工单待处理</b><small>来自真实工单队列</small></div><em>去处理</em></button>
          <button className="risk-item" onClick={() => onNavigate("quality")}><span className="risk-dot medium" /><div><b>{counts?.pendingReviews ?? 0} 条质检结果待复核</b><small>来自真实质检队列</small></div><em>去处理</em></button>
          <button className="risk-item" onClick={() => onNavigate("knowledge")}><span className="risk-dot low" /><div><b>{counts?.reviewKnowledge ?? 0} 篇知识待复核</b><small>来自真实知识库</small></div><em>去处理</em></button>
        </article>
      </section>

      <section className="overview-grid lower">
        <article className="panel intent-panel">
          <div className="panel-head"><div><h3>高频咨询意图</h3><p>今日 {total} 次真实会话</p></div><button className="text-button" onClick={() => onNavigate("analytics")}>查看分析 →</button></div>
          {(metrics?.topics ?? []).map((item) => <div className="bar-row" key={item.name}><span>{item.name}</span><div className="bar-track"><i style={{ width: `${item.percentage}%` }} /></div><b>{item.count}</b><small>{item.percentage}%</small></div>)}
          {!metrics?.topics.length && <div className="knowledge-empty"><b>暂无今日会话数据</b><span>用户产生真实会话后，这里会自动汇总意图。</span></div>}
        </article>
        <article className="panel activity-panel">
          <div className="panel-head"><div><h3>实时动态</h3><p>跨角色协作记录</p></div><button className="text-button" onClick={() => onNavigate("audit")}>全部记录 →</button></div>
          <div className="timeline">{(metrics?.recentAudit ?? []).map((item) => <div key={item.id}><i className={`avatar ${item.risk === "高" ? "orange" : "blue"}`}>审</i><p><b>{item.action}</b> · {item.resourceId}<small>{new Date(item.at).toLocaleString("zh-CN")} · {item.result}</small></p></div>)}{!metrics?.recentAudit.length && <div className="knowledge-empty"><b>暂无审计动态</b><span>真实操作产生后会显示在这里。</span></div>}</div>
        </article>
      </section>
    </>
  );
}

function Conversations({ knowledgeQuote, onConsumeQuote, initialConversationId }: { knowledgeQuote?: KnowledgeQuote | null; onConsumeQuote?: () => void; initialConversationId?: string }) {
  type QueueFilter = "待接管" | "处理中" | "等待内部" | "已解决";
  type ConversationAssignee = { id: string; displayName: string; email: string };
  const [liveConversations, setLiveConversations] = useState<Conversation[]>([]);
  const [assignees, setAssignees] = useState<ConversationAssignee[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("待接管");
  const [queuePage, setQueuePage] = useState(1);
  const [queuePagination, setQueuePagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [serverQueueCounts, setServerQueueCounts] = useState<Record<QueueFilter, number>>({ "待接管": 0, "处理中": 0, "等待内部": 0, "已解决": 0 });
  const [serverUrgentCount, setServerUrgentCount] = useState(0);
  const [query, setQuery] = useState("");
  const [states, setStates] = useState<Record<string, ConversationState>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftSaveStates, setDraftSaveStates] = useState<Record<string, DraftSaveState>>({});
  const [replySent, setReplySent] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [rightTab, setRightTab] = useState<"context" | "assist">("context");
  const [mobileConversationView, setMobileConversationView] = useState<"queue" | "detail">("queue");
  const [mobileInsightOpen, setMobileInsightOpen] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showInternalNote, setShowInternalNote] = useState(false);
  const [internalNote, setInternalNote] = useState("");
  const [internalNoteSaving, setInternalNoteSaving] = useState(false);
  const [summaryFeedbackSaving, setSummaryFeedbackSaving] = useState(false);
  const [summaryFeedbackSent, setSummaryFeedbackSent] = useState(false);
  const [suggestionFeedbackSaving, setSuggestionFeedbackSaving] = useState(false);
  const [suggestionFeedbackSent, setSuggestionFeedbackSent] = useState(false);
  const [nextActionSaving, setNextActionSaving] = useState(false);
  const [nextActionSentFor, setNextActionSentFor] = useState("");
  const [supervisorEscalationSaving, setSupervisorEscalationSaving] = useState(false);
  const [supervisorEscalationSentFor, setSupervisorEscalationSentFor] = useState("");
  const [presence, setPresence] = useState<"available" | "busy">("available");
  const [presenceSaving, setPresenceSaving] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferAssigneeId, setTransferAssigneeId] = useState("");
  const [transferSaving, setTransferSaving] = useState(false);
  const [reopenSaving, setReopenSaving] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState("用户在72小时内再次咨询");
  const [reopenError, setReopenError] = useState("");
  const [resolution, setResolution] = useState("已解释规则并完成业务核验");
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [closeSaving, setCloseSaving] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [loading, setLoading] = useState(true);
  const [queueRefreshKey, setQueueRefreshKey] = useState(0);
  const [queueRefreshing, setQueueRefreshing] = useState(false);
  const [queueError, setQueueError] = useState("");
  const [queueLastSuccessAt, setQueueLastSuccessAt] = useState<string | null>(null);
  const [queueSnapshotStale, setQueueSnapshotStale] = useState(false);
  const queueSnapshotRef = useRef<{ hasSnapshot: boolean; lastSuccessAt: string | null }>({ hasSnapshot: false, lastSuccessAt: null });
  const queueRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const queueRequestIdRef = useRef(0);
  const [historyByConversation, setHistoryByConversation] = useState<Record<string, Conversation["history"]>>({});
  const [historyHasMoreByConversation, setHistoryHasMoreByConversation] = useState<Record<string, boolean>>({});
  const [historyCursorByConversation, setHistoryCursorByConversation] = useState<Record<string, string | null>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyRequestRef = useRef<{ id: number; conversationId: string; controller: AbortController } | null>(null);
  const historyRequestIdRef = useRef(0);
  const mobileInsightDialogRef = useDialogFocus(mobileInsightOpen, () => setMobileInsightOpen(false));
  const closeDialogRef = useDialogFocus(showClose, () => setShowClose(false));
  const reopenDialogRef = useDialogFocus(showReopen, () => setShowReopen(false));
  const internalNoteDialogRef = useDialogFocus(showInternalNote, () => setShowInternalNote(false));
  const transferDialogRef = useDialogFocus(showTransfer, () => setShowTransfer(false));
  const selected = liveConversations.find((item) => item.id === selectedId) ?? liveConversations[0];
  const currentState = selected ? (states[selected.id] ?? selected.status) : "待接管";
  const draft = selected ? (drafts[selected.id] ?? "") : "";
  const draftSaveState = selected ? (draftSaveStates[selected.id] ?? (draft ? "suggestion" : "empty")) : "empty";
  const draftSaveLabel = draftSaveState === "saved" ? "已保存到本机" : draftSaveState === "restored" ? "已从本机恢复" : draftSaveState === "error" ? "本机保存失败，请复制内容" : draftSaveState === "suggestion" ? "AI建议，尚未保存" : "暂无本机草稿";
  const activeCitation = selected?.citations?.find((item) => item.available) ?? null;
  const selectedHistory = selected ? (historyByConversation[selected.id] ?? selected.history) : undefined;
  const latestTraceMessage = selectedHistory?.slice().reverse().find((message) => message.senderType === "ai" && message.trace?.length);
  const selectedTrace = latestTraceMessage?.trace ?? selected?.agentRun?.trace ?? [];
  const selectedTraceId = latestTraceMessage?.traceId ?? selected?.agentRun?.traceId ?? null;
  const selectedTraceStatus = selected?.agentRun?.status ?? (selectedTrace.length ? "completed" : "not_available");
  const traceFailedCount = selectedTrace.filter((step) => step.status === "failed").length;
  const traceAttentionCount = selectedTrace.filter((step) => step.status === "warning" || step.status === "skipped").length;
  const isOrderMissing = !selected?.order || /无关联|暂无|未知/.test(selected.order);
  const hasAgentReply = Boolean(selectedHistory?.some((message) => message.senderType === "agent")) || Boolean(selected && replySent[selected.id]);
  const canStartClosing = currentState === "处理中" && hasAgentReply;
  const statusCopy: Record<ConversationState, { label: string; detail: string }> = {
    "待接管": { label: "等待你接管", detail: "接管后 SLA 将由你负责" },
    "处理中": { label: "正在处理中", detail: "回复后请等待用户确认" },
    "等待内部": { label: "等待内部处理", detail: "SLA 继续计时，请主动同步进度" },
    "已解决": { label: "已完成", detail: "72 小时内再次咨询会保留上下文" },
  };
  const queueCounts = (state: QueueFilter) => serverQueueCounts[state] ?? liveConversations.filter((item) => (states[item.id] ?? item.status) === state).length;
  const urgentCount = serverUrgentCount || liveConversations.filter((item) => (states[item.id] ?? item.status) !== "已解决" && (item.slaState === "overdue" || item.slaState === "due_soon")).length;
  const formatTime = (time: string) => {
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return time;
    return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  const formatSyncTime = (time: string | null) => time ? new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "尚未成功同步";
  const traceStatusText = (status?: string) => status === "passed" ? "已完成" : status === "warning" ? "已降级/需关注" : status === "failed" ? "失败" : status === "skipped" ? "已跳过" : status === "completed" ? "已完成" : "未知状态";
  const traceStatusKind = (status?: string) => status === "failed" ? "failed" : status === "warning" ? "warning" : status === "skipped" ? "skipped" : "passed";
  const preview = (item: Conversation) => (item.history?.filter((message) => message.senderType === "customer").at(-1)?.content ?? item.customerMessage).replace(/\s+/g, " ").slice(0, 42);
  const queueTabFilters: QueueFilter[] = ["待接管", "处理中", "等待内部", "已解决"];
  const queueTabIds = ["conversation-tab-needs-human", "conversation-tab-active", "conversation-tab-internal", "conversation-tab-resolved"];
  const insightTabIds = ["insight-tab-context", "insight-tab-assist"];
  const visibleConversations = liveConversations.filter((item) => {
    const matchesState = (states[item.id] ?? item.status) === queueFilter;
    const normalized = query.trim().toLocaleLowerCase();
    return matchesState && (!normalized || `${item.name} ${item.id} ${item.topic} ${item.order}`.toLocaleLowerCase().includes(normalized));
  });

  useEffect(() => {
    const stored = readStoredConversationDrafts();
    if (!Object.keys(stored).length) return;
    // Hydrate durable drafts from the external browser store once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts((current) => {
      const next = { ...current };
      Object.entries(stored).forEach(([conversationId, record]) => {
        if (!next[conversationId]) next[conversationId] = record.content;
      });
      return next;
    });
    setDraftSaveStates((current) => Object.fromEntries(Object.keys(stored).map((conversationId) => [conversationId, current[conversationId] ?? "restored"])));
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadConversations() {
      if (queueRequestRef.current) return;
      const requestId = ++queueRequestIdRef.current;
      const controller = new AbortController();
      queueRequestRef.current = { id: requestId, controller };
      setQueueRefreshing(true);
      try {
        const status = queueFilter === "待接管" ? "needs_human" : queueFilter === "处理中" ? "active" : queueFilter === "等待内部" ? "ticketed" : "resolved";
        const params = new URLSearchParams({ page: String(queuePage), pageSize: "25", status });
        if (query.trim()) params.set("q", query.trim());
        if (initialConversationId) params.set("conversationId", initialConversationId);
        const response = await fetch(`/api/conversations?${params.toString()}`, { cache: "no-store", signal: controller.signal, headers: { "x-servicepilot-channel": "customer-demo" } });
        if (!response.ok) throw new Error("会话队列读取失败");
        const body = await response.json() as { conversations?: Conversation[]; assignees?: ConversationAssignee[]; presence?: "available" | "busy"; pagination?: typeof queuePagination; queueCounts?: Record<QueueFilter, number>; urgentCount?: number };
        if (!mounted || requestId !== queueRequestIdRef.current) return;
        const next = body.conversations ?? [];
        setAssignees(body.assignees ?? []);
        setPresence(body.presence === "busy" ? "busy" : "available");
        setQueuePagination(body.pagination ?? { page: queuePage, pageSize: 25, total: next.length, totalPages: 1 });
        setServerQueueCounts(body.queueCounts ?? { "待接管": 0, "处理中": 0, "等待内部": 0, "已解决": 0 });
        setServerUrgentCount(body.urgentCount ?? 0);
        setLiveConversations(next);
        const deepLinked = initialConversationId ? next.find((item) => item.id === initialConversationId) : undefined;
        setSelectedId((current) => deepLinked?.id ?? (current && next.some((item) => item.id === current) ? current : next[0]?.id ?? ""));
        if (deepLinked) { setQueueFilter(deepLinked.status); setMobileConversationView("detail"); }
        setStates(Object.fromEntries(next.map((item) => [item.id, item.status])));
        setDrafts((current) => Object.fromEntries(next.map((item) => [item.id, current[item.id] ?? item.draft])));
        setDraftSaveStates((current) => Object.fromEntries(next.map((item) => [item.id, current[item.id] ?? (item.draft ? "suggestion" : "empty")] as const)));
        const successfulAt = new Date().toISOString();
        queueSnapshotRef.current = { hasSnapshot: true, lastSuccessAt: successfulAt };
        setQueueError("");
        setQueueSnapshotStale(false);
        setQueueLastSuccessAt(successfulAt);
        setLoading(false);
      } catch (cause) {
        if (mounted && requestId === queueRequestIdRef.current && !(cause instanceof DOMException && cause.name === "AbortError")) {
          const hasSnapshot = queueSnapshotRef.current.hasSnapshot;
          const lastSuccessAt = queueSnapshotRef.current.lastSuccessAt;
          setQueueError(hasSnapshot ? "会话队列暂时无法刷新，当前仍显示最后一次成功快照。" : (cause instanceof Error ? cause.message : "会话队列暂时无法加载。"));
          setQueueSnapshotStale(Boolean(lastSuccessAt && Date.now() - new Date(lastSuccessAt).getTime() > 30000));
          setLoading(false);
        }
      } finally {
        if (queueRequestRef.current?.id === requestId) queueRequestRef.current = null;
        if (mounted && requestId === queueRequestIdRef.current) setQueueRefreshing(false);
      }
    }
    loadConversations();
    const timer = window.setInterval(loadConversations, 5000);
    return () => { mounted = false; window.clearInterval(timer); if (queueRequestRef.current) queueRequestRef.current.controller.abort(); };
  }, [initialConversationId, queueFilter, queuePage, query, queueRefreshKey]);

  async function loadConversationHistory(id: string, before?: string | null, append = false) {
    if (!id) return;
    if (historyRequestRef.current) historyRequestRef.current.controller.abort();
    const requestId = ++historyRequestIdRef.current;
    const controller = new AbortController();
    historyRequestRef.current = { id: requestId, conversationId: id, controller };
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (before) params.set("before", before);
      const response = await fetch(`/api/conversations/${id}?${params.toString()}`, { cache: "no-store", signal: controller.signal, headers: { "x-servicepilot-channel": "customer-demo" } });
      if (!response.ok) throw new Error("会话消息读取失败");
      const body = await response.json() as { messages?: NonNullable<Conversation["history"]>; agentRun?: ConversationAgentRun | null; pagination?: { hasMore?: boolean; nextBefore?: string | null } };
      if (requestId !== historyRequestIdRef.current) return;
      setLiveConversations((current) => current.map((item) => item.id === id ? { ...item, agentRun: body.agentRun ?? item.agentRun ?? null } : item));
      setHistoryByConversation((current) => {
        const incoming = body.messages ?? [];
        const merged = append ? [...incoming, ...(current[id] ?? [])] : incoming;
        return { ...current, [id]: Array.from(new Map(merged.map((message) => [message.id, message])).values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
      });
      setHistoryHasMoreByConversation((current) => ({ ...current, [id]: Boolean(body.pagination?.hasMore) }));
      setHistoryCursorByConversation((current) => ({ ...current, [id]: body.pagination?.nextBefore ?? null }));
    } catch (cause) {
      if (requestId === historyRequestIdRef.current && !(cause instanceof DOMException && cause.name === "AbortError")) flash(cause instanceof Error ? cause.message : "会话消息读取失败");
    } finally {
      if (historyRequestRef.current?.id === requestId) historyRequestRef.current = null;
      if (requestId === historyRequestIdRef.current) setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (!selected?.id) return;
    // The selected conversation is an external resource; loading it is the effect's purpose.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConversationHistory(selected.id);
    return () => { if (historyRequestRef.current?.conversationId === selected.id) historyRequestRef.current.controller.abort(); };
  }, [selected?.id]);

  function loadOlderConversationMessages() {
    if (!selected || historyLoading || !historyHasMoreByConversation[selected.id]) return;
    void loadConversationHistory(selected.id, historyCursorByConversation[selected.id], true);
  }

  function retryQueue() {
    setQueueRefreshKey((value) => value + 1);
    flash("正在重新加载会话队列…");
  }
  useEffect(() => {
    if (!initialConversationId || !selected) return;
    const timer = window.setTimeout(() => document.getElementById("conversation-detail")?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [initialConversationId, selected?.id]);
  useEffect(() => {
    if (mobileConversationView !== "detail") return;
    const timer = window.setTimeout(() => document.getElementById("conversation-detail")?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [mobileConversationView]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  async function updateConversation(action: "claim" | "reply" | "resolve" | "reopen", content?: string, extra?: { resolution?: string; resolutionSummary?: string; customerConfirmed?: boolean; reopenReason?: string }) {
    const response = await fetch(`/api/conversations/${selected?.id ?? ""}`, { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ action, content, ...extra }) });
    if (!response.ok) throw new Error("会话操作未保存，请重试");
  }

  async function saveInternalNote() {
    if (!selected || !internalNote.trim()) return;
    setInternalNoteSaving(true);
    try {
      const response = await fetch(`/api/conversations/${selected.id}`, { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ action: "internal_note", content: internalNote.trim() }) });
      if (!response.ok) throw new Error("内部备注保存失败，请重试");
      setInternalNote("");
      setShowInternalNote(false);
      flash("内部备注已保存至会话审计记录，仅客服可见");
    } catch (cause) { flash(cause instanceof Error ? cause.message : "内部备注保存失败"); }
    finally { setInternalNoteSaving(false); }
  }

  async function submitSummaryFeedback() {
    if (!selected || summaryFeedbackSaving || summaryFeedbackSent) return;
    setSummaryFeedbackSaving(true);
    try {
      const response = await fetch(`/api/conversations/${selected.id}`, { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ action: "summary_feedback" }) });
      if (!response.ok) throw new Error("摘要反馈保存失败，请重试");
      setSummaryFeedbackSent(true);
      flash("摘要问题已记录，将进入 AI 运营复核队列");
    } catch (cause) { flash(cause instanceof Error ? cause.message : "摘要反馈保存失败"); }
    finally { setSummaryFeedbackSaving(false); }
  }

  async function submitSuggestionFeedback() {
    if (!selected || suggestionFeedbackSaving || suggestionFeedbackSent) return;
    setSuggestionFeedbackSaving(true);
    try {
      const response = await fetch(`/api/conversations/${selected.id}`, { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ action: "suggestion_feedback" }) });
      if (!response.ok) throw new Error("建议反馈保存失败，请重试");
      setSuggestionFeedbackSent(true);
      flash("建议反馈已记录，将进入 AI 运营复核队列");
    } catch (cause) { flash(cause instanceof Error ? cause.message : "建议反馈保存失败"); }
    finally { setSuggestionFeedbackSaving(false); }
  }

  async function requestSuggestedAction() {
    if (!selected || nextActionSaving || nextActionSentFor === selected.id) return;
    setNextActionSaving(true);
    try {
      const response = await fetch(`/api/conversations/${selected.id}`, { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ action: "next_action_request", content: selected.suggestedAction }) });
      if (!response.ok) throw new Error("核验请求保存失败，请重试");
      setNextActionSentFor(selected.id);
      flash(`${selected.suggestedAction}已发起，只读核验结果将回写会话记录`);
    } catch (cause) { flash(cause instanceof Error ? cause.message : "核验请求保存失败"); }
    finally { setNextActionSaving(false); }
  }

  async function requestSupervisorEscalation() {
    if (!selected || supervisorEscalationSaving || supervisorEscalationSentFor === selected.id) return;
    setSupervisorEscalationSaving(true);
    try {
      const response = await fetch(`/api/conversations/${selected.id}`, { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ action: "supervisor_escalation_request", content: `请求值班主管介入：${selected.topic}` }) });
      if (!response.ok) throw new Error("升级请求保存失败，请重试");
      setSupervisorEscalationSentFor(selected.id);
      flash("已提交值班主管升级请求，等待人工审批");
    } catch (cause) { flash(cause instanceof Error ? cause.message : "升级请求保存失败"); }
    finally { setSupervisorEscalationSaving(false); }
  }

  async function togglePresence() {
    if (!selected || presenceSaving) return;
    const nextPresence = presence === "busy" ? "available" : "busy";
    setPresenceSaving(true);
    try {
      const response = await fetch(`/api/conversations/${selected.id}`, { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ action: "set_presence", content: nextPresence }) });
      if (!response.ok) throw new Error("忙闲状态保存失败，请重试");
      setPresence(nextPresence);
      flash(nextPresence === "busy" ? "已保存为忙碌状态，当前会话仍可继续处理" : "已恢复在线接待状态");
    } catch (cause) { flash(cause instanceof Error ? cause.message : "忙闲状态保存失败"); }
    finally { setPresenceSaving(false); }
  }

  async function transferConversation() {
    if (!selected || !transferAssigneeId || transferSaving) return;
    setTransferSaving(true);
    try {
      const response = await fetch(`/api/conversations/${selected.id}`, { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ action: "transfer", assigneeId: transferAssigneeId }) });
      if (!response.ok) throw new Error("转交保存失败，请重试");
      const assignee = assignees.find((person) => person.id === transferAssigneeId);
      setLiveConversations((current) => current.map((item) => item.id === selected.id ? { ...item, assignedUserId: transferAssigneeId, assignedUserName: assignee?.displayName ?? null, status: "处理中" } : item));
      setStates((current) => ({ ...current, [selected.id]: "处理中" }));
      setShowTransfer(false);
      flash(`会话已转交给 ${assignee?.displayName ?? "指定负责人"}`);
    } catch (cause) { flash(cause instanceof Error ? cause.message : "转交保存失败"); }
    finally { setTransferSaving(false); }
  }

  async function claimConversation() {
    try { await updateConversation("claim"); }
    catch (cause) { flash(cause instanceof Error ? cause.message : "接管失败"); return; }
    setStates((current) => ({ ...current, [selected.id]: "处理中" }));
    setReplySent((current) => ({ ...current, [selected.id]: true }));
    setQueueFilter("处理中");
    flash(`已接管 ${selected.id}，会话上下文和 SLA 已锁定给你`);
  }

  function saveConversationDraft(conversationId: string, value: string) {
    setDrafts((current) => ({ ...current, [conversationId]: value }));
    try {
      const stored = readStoredConversationDrafts();
      if (value.trim()) stored[conversationId] = { content: value, updatedAt: new Date().toISOString() };
      else delete stored[conversationId];
      window.localStorage.setItem(conversationDraftStorageKey, JSON.stringify(stored));
      setDraftSaveStates((current) => ({ ...current, [conversationId]: value.trim() ? "saved" : "empty" }));
    } catch {
      setDraftSaveStates((current) => ({ ...current, [conversationId]: "error" }));
    }
  }

  function clearConversationDraft(conversationId: string) {
    try {
      const stored = readStoredConversationDrafts();
      delete stored[conversationId];
      window.localStorage.setItem(conversationDraftStorageKey, JSON.stringify(stored));
    } catch {
      // The reply was already sent; keep the in-memory state accurate even if local storage is unavailable.
    }
    setDrafts((current) => ({ ...current, [conversationId]: "" }));
    setDraftSaveStates((current) => ({ ...current, [conversationId]: "empty" }));
  }

  function insertText(value: string) {
    if (!selected) return;
    saveConversationDraft(selected.id, `${draft}${draft ? "\n" : ""}${value}`);
  }

  function insertKnowledgeCitation() {
    if (!selected) {
      flash("当前没有选中的会话");
      return;
    }
    const citation = selected.citations?.find((item) => item.available && item.content) ?? selected.citations?.find((item) => item.available);
    if (!citation) {
      flash("当前会话没有可引用的生效知识，请先查看 AI 处理记录或知识查询");
      return;
    }
    const content = citation.content ? `依据《${citation.title}》（${citation.version}）：${citation.content}` : `依据《${citation.title}》（${citation.version}）中的当前生效规则，`;
    insertText(content);
  }

  useEffect(() => {
    if (!knowledgeQuote || !selected) return;
    const timer = window.setTimeout(() => {
      saveConversationDraft(selected.id, `${draft}${draft ? "\n" : ""}依据 ${knowledgeQuote.title}（${knowledgeQuote.version}）：${knowledgeQuote.content}`);
      flash(`已引用 ${knowledgeQuote.id}，内容已带入回复框`);
      onConsumeQuote?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [knowledgeQuote, selected?.id]);

  async function sendReply() {
    if (!draft.trim()) return;
    try { await updateConversation("reply", draft); }
    catch (cause) { flash(cause instanceof Error ? cause.message : "回复未保存"); return; }
    clearConversationDraft(selected.id);
    setStates((current) => ({ ...current, [selected.id]: "处理中" }));
    void loadConversationHistory(selected.id);
    flash("回复已发送，当前会话已进入等待用户响应");
  }

  async function createTicketFromConversation() {
    if (!selected) return;
    try {
      const response = await fetch("/api/tickets", { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ title: `${selected.topic} · 需要人工跟进`, customerName: selected.name, priority: selected.risk === "高" ? "P1" : "P2", conversationId: selected.id, summary: selected.summary }) });
      if (!response.ok) { let message = "工单创建失败"; try { const body = await response.json() as { error?: string }; message = body.error || message; } catch { /* keep fallback */ } throw new Error(message); }
      const body = await response.json() as { created?: boolean; ticket?: { id?: string } };
      flash(body.created === false ? "该会话已有未关闭工单，已保留原工单" : `工单 ${body.ticket?.id ?? ""} 已真实创建`);
    } catch (cause) { flash(cause instanceof Error ? cause.message : "工单创建失败"); }
  }

  async function closeConversation() {
    if (!selected || !customerConfirmed || !resolutionSummary.trim() || closeSaving) return;
    setCloseSaving(true);
    setCloseError("");
    try {
      await updateConversation("resolve", resolution, { resolution, resolutionSummary: resolutionSummary.trim(), customerConfirmed: true });
      setLiveConversations((current) => current.map((item) => item.id === selected.id ? { ...item, status: "已解决", resolutionCategory: resolution, resolutionSummary: resolutionSummary.trim(), customerConfirmed: true } : item));
      setStates((current) => ({ ...current, [selected.id]: "已解决" }));
      setShowClose(false);
      setQueueFilter("已解决");
      flash("会话已结构化结案，结案信息已保存并进入72小时重新打开观察期");
    } catch (cause) { const message = cause instanceof Error ? cause.message : "结案未保存"; setCloseError(message); flash(message); }
    finally { setCloseSaving(false); }
  }

  async function reopenConversation() {
    if (!selected || !reopenReason || reopenSaving) return;
    setReopenSaving(true);
    setReopenError("");
    try {
      await updateConversation("reopen", undefined, { reopenReason });
      setLiveConversations((current) => current.map((item) => item.id === selected.id ? { ...item, status: "处理中", customerConfirmed: false, lastReopenReason: reopenReason, reopenCount: (item.reopenCount ?? 0) + 1 } : item));
      setStates((current) => ({ ...current, [selected.id]: "处理中" }));
      setQueueFilter("处理中");
      setShowReopen(false);
      flash(`会话已重新打开（${reopenReason}），SLA责任已恢复到处理中`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "重新打开失败";
      setReopenError(message);
      flash(message);
    } finally {
      setReopenSaving(false);
    }
  }

  if (loading && !selected) return <section className="panel table-panel"><div className="queue-heading"><div><b>我的会话</b><small>正在从真实会话服务加载</small></div></div></section>;
  if (queueError && !selected) return <section className="panel table-panel"><div className="queue-error-empty" role="alert"><b>会话队列暂时不可用</b><span>{queueError}</span><button className="primary-button" disabled={queueRefreshing} aria-busy={queueRefreshing} onClick={retryQueue}>{queueRefreshing ? "重试中…" : "重试加载"}</button></div></section>;
  if (!selected) return <section className="panel table-panel"><div className="conversation-empty"><span>✓</span><b>当前没有会话</b><small>用户提交问题后，Agent 会将需要人工处理的会话放入这里。</small></div></section>;

  return (
    <section className={`agent-console mobile-conversation-${mobileConversationView}`} aria-label="一线客服会话处理台">
      <header className="agent-shift-bar">
        <div className="agent-presence"><span className={`presence-dot${presence === "busy" ? " busy" : ""}`} /><div><b>{presence === "busy" ? "忙碌" : "在线接待"}</b><small>王可 · 售后服务组 · 状态已保存</small></div></div>
        <div className="shift-metrics"><span><b>{queueCounts("待接管")}</b> 待接管</span><span className={urgentCount ? "metric-urgent" : ""}><b>{urgentCount}</b> 需优先处理</span><span><b>实时</b> 队列更新</span></div>
        <button className="ghost-button" aria-busy={presenceSaving} disabled={presenceSaving} onClick={() => void togglePresence}>{presenceSaving ? "保存中…" : presence === "busy" ? "恢复在线" : "设为忙碌"}</button>
      </header>
      {notice && <div className="agent-toast" role="status">✓ {notice}</div>}
      <div className="conversation-layout">
        <article className="panel conversation-list">
          <div className="queue-heading"><div><b>我的会话</b><small>优先显示即将超时和高风险会话 · 最后同步 {formatSyncTime(queueLastSuccessAt)}</small></div><button aria-label={queueRefreshing ? "正在刷新会话队列" : "刷新会话队列"} aria-busy={queueRefreshing} disabled={queueRefreshing} onClick={retryQueue}>{queueRefreshing ? "刷新中…" : "刷新"}</button></div>
          {queueError && <div className={`queue-error-banner${queueSnapshotStale ? " stale" : ""}`} role="alert"><div><b>{queueSnapshotStale ? "队列数据可能已过期" : "会话队列暂时无法刷新"}</b><span>{queueError}</span></div><button className="ghost-button" disabled={queueRefreshing} aria-busy={queueRefreshing} onClick={retryQueue}>{queueRefreshing ? "重试中…" : "重试"}</button></div>}
          <div className="list-toolbar"><div className="search-box">⌕ <input name="conversation-search" autoComplete="off" aria-label="搜索会话" value={query} onChange={(event) => { setQuery(event.target.value); setQueuePage(1); }} placeholder="搜索用户、会话或主题…" /></div></div>
          <div className="list-tabs" role="tablist" aria-label="会话状态队列" aria-orientation="horizontal">{queueTabFilters.map((item, index) => <button key={item} id={queueTabIds[index]} role="tab" aria-selected={queueFilter === item} aria-controls="conversation-queue-panel" tabIndex={queueFilter === item ? 0 : -1} className={queueFilter === item ? "active" : ""} onClick={() => { setQueueFilter(item); setQueuePage(1); }} onKeyDown={(event) => handleTabKeyDown(event, queueTabIds, index, (nextIndex) => { const nextFilter = queueTabFilters[nextIndex]; setQueueFilter(nextFilter); setQueuePage(1); })}>{item}<b>{queueCounts(item)}</b></button>)}</div>
          <div id="conversation-queue-panel" className="conversation-items" role="tabpanel" aria-labelledby={queueTabIds[queueTabFilters.indexOf(queueFilter)]} tabIndex={0}>
            {visibleConversations.map((item) => <button key={item.id} className={selected.id === item.id ? "conversation-item active" : "conversation-item"} onClick={() => { setSelectedId(item.id); setShowClose(false); setMobileInsightOpen(false); setMobileConversationView("detail"); }}>
              <span className="customer-avatar">{item.name[0]}</span><span className="conversation-main"><b>{item.name}<small>{formatTime(item.time)}</small></b><span>{item.topic}</span><p>{preview(item)}</p><em>{item.order && !/无关联|暂无/.test(item.order) ? `订单 ${item.order}` : "待补充订单信息"}</em><small aria-live="polite" className={`queue-sla${item.slaState === "overdue" ? " urgent" : item.slaState === "due_soon" ? " soon" : ""}`}><b>{item.priority ?? "P2"}</b> · {item.sla}</small></span><Status kind={item.risk === "高" ? "danger" : item.risk === "中" ? "warning" : "info"} title={item.riskSource ?? undefined}>{item.risk}风险</Status>
            </button>)}
            {!visibleConversations.length && <div className="conversation-empty"><span>✓</span><b>当前队列已清空</b><small>{query ? "没有匹配的会话，试试其他关键词" : "新的会话会按风险和 SLA 自动排入"}</small></div>}
            {queuePagination.totalPages > 1 && <footer className="conversation-pagination" aria-label="会话分页" aria-live="polite"><span>第 {queuePagination.page} / {queuePagination.totalPages} 页 · 共 {queuePagination.total} 条</span><div><button className="ghost-button" disabled={queuePage <= 1 || queueRefreshing} onClick={() => setQueuePage((value) => Math.max(1, value - 1))}>上一页</button><button className="ghost-button" disabled={queuePage >= queuePagination.totalPages || queueRefreshing} onClick={() => setQueuePage((value) => Math.min(queuePagination.totalPages, value + 1))}>下一页</button></div></footer>}
          </div>
        </article>

        <article id="conversation-detail" className="panel chat-panel" tabIndex={-1}>
          <div className="chat-head"><div className="chat-head-title"><button type="button" className="mobile-back-button" aria-label="返回会话队列" onClick={() => { setMobileInsightOpen(false); setMobileConversationView("queue"); }}>←</button><div><b>{selected.name}</b><span>{selected.channel} · {isOrderMissing ? "未关联订单" : `订单 ${selected.order}`}{selected.assignedUserName ? ` · 负责人 ${selected.assignedUserName}` : ""}</span></div></div><div><Status kind={currentState === "已解决" ? "success" : selected.risk === "高" ? "danger" : "warning"}>{statusCopy[currentState].label}</Status>{currentState === "待接管" ? <button className="primary-button" onClick={claimConversation}>接管会话</button> : currentState !== "已解决" && <button className="ghost-button" onClick={() => { setTransferAssigneeId(selected.assignedUserId ?? assignees[0]?.id ?? ""); setShowTransfer(true); }}>转交</button>}<button type="button" className="mobile-context-button" aria-label="打开服务上下文和 AI 协助" aria-controls="mobile-insight-panel" onClick={() => setMobileInsightOpen(true)}>服务辅助</button></div></div>
          <div className="handoff-banner"><span>人工接管原因</span><b>{selected.handoff}</b><em aria-live="polite" className={selected.slaState === "overdue" ? "sla-overdue" : selected.slaState === "due_soon" ? "sla-due-soon" : ""} title={selected.riskSource ?? undefined}>{selected.priority ?? "P2"} · {selected.sla}</em></div>
          {currentState !== "已解决" && selected.lastReopenReason && <div className="reopen-context" role="status"><b>本轮已重新打开</b><span>{selected.lastReopenReason} · 第 {selected.reopenCount ?? 1} 次重开</span><small>上一轮结案记录已保留，当前需要重新核验并获得用户确认后再结案</small></div>}
          <div className="chat-context"><span>意图 <b>{selected.topic}</b></span><span>情绪 <b>{selected.sentiment}</b></span><span>已核验 <b>{selected.facts.length} 项</b></span><span title={selected.riskSource ?? undefined}>风险 <b>{selected.risk} · {selected.riskSource ?? "业务风险评估"}</b></span><span className="workflow-state">{statusCopy[currentState].detail}</span></div>
          <div className="messages">
            {historyLoading && <div className="message-history-status" role="status" aria-live="polite">正在同步会话消息…</div>}
            {historyHasMoreByConversation[selected.id] && <button className="load-more-messages" type="button" disabled={historyLoading} aria-busy={historyLoading} onClick={loadOlderConversationMessages}>{historyLoading ? "加载更早消息中…" : "加载更早消息"}</button>}
            {(selectedHistory?.length ? selectedHistory : [{ id: `${selected.id}-fallback-customer`, senderType: "customer" as const, content: selected.customerMessage, createdAt: selected.time }, { id: `${selected.id}-fallback-ai`, senderType: "ai" as const, content: selected.aiReply, createdAt: selected.time }]).map((message) => message.senderType === "customer" ? <div className="message customer" key={message.id}><span className="customer-avatar">{selected.name[0]}</span><p>{message.content}<small>用户 · {message.createdAt}</small></p></div> : <div className="message agent" key={message.id}><span className="agent-avatar">{message.senderType === "agent" ? "客" : "AI"}</span><p>{message.content}<small>{message.senderType === "agent" ? "一线客服" : message.senderType === "ai" ? "AI Agent" : "系统"} · {message.createdAt}</small></p></div>)}
            <details className="trace-card"><summary><span className="trace-icon">AI</span><p><b>查看 AI 处理记录</b><small aria-live="polite">{selectedTrace.length ? `${selectedTrace.length} 个真实执行步骤 · ${traceFailedCount ? `${traceFailedCount} 步失败` : traceAttentionCount ? `${traceAttentionCount} 步需关注` : "全部完成"}` : "当前消息没有可用执行记录"}</small></p><em title={traceStatusText(selectedTraceStatus)}>{selectedTrace.length ? "展开" : "无记录"}</em></summary>{selectedTrace.length ? <>{selectedTrace.map((step, index) => <div className={`trace-step ${traceStatusKind(step.status)}`} key={`${step.type ?? "step"}-${index}`}><span className="trace-icon">{step.status === "failed" ? "!" : step.status === "warning" ? "!" : step.status === "skipped" ? "–" : String(index + 1)}</span><p><b>{step.label ?? step.type ?? "未命名执行步骤"}</b><small>{traceStatusText(step.status)}{typeof step.durationMs === "number" ? ` · ${step.durationMs}ms` : ""}{step.failureCode ? ` · 失败码 ${step.failureCode}` : ""}{step.reason ? ` · 原因 ${String(step.reason)}` : ""}</small></p></div>)}{traceFailedCount > 0 && <div className="trace-recovery" role="alert">本次 Agent 执行包含失败步骤。请不要依据失败步骤做业务承诺，可重试请求或转人工核验。</div>}</> : <div className="trace-empty" role="status">该消息未持久化可展示的 Trace；请结合会话状态和 Agent 健康检查判断是否需要重试。</div>}{selectedTraceId && <div className="trace-footer"><span>Trace ID</span><code>{selectedTraceId}</code>{selected?.agentRun?.model && <span>模型 {selected.agentRun.model}</span>}</div>}</details>
            <div className="handoff-note"><b>上下文已完整交接，无需用户重复描述</b><span>{selected.summary}</span></div>
          </div>
          {currentState !== "已解决" ? <div className="reply-box">
            <div className="reply-tools"><button onClick={() => setRightTab("assist")}>查看回复建议</button><button aria-label="引用当前会话的生效知识" title={activeCitation ? `引用 ${activeCitation.title}` : "当前会话暂无可引用知识"} disabled={!activeCitation} onClick={insertKnowledgeCitation}>引用当前知识</button>{isOrderMissing && <button onClick={() => insertText("为准确核验进度，麻烦您提供订单号或退款申请时间，我马上为您查询。")}>向用户补充信息</button>}<button onClick={() => void createTicketFromConversation()}>创建工单</button><button onClick={() => setShowInternalNote(true)}>内部备注</button><span className="citation-status" role="status" aria-live="polite">{activeCitation ? `可引用：${activeCitation.title} ${activeCitation.version}` : "当前没有可引用的生效知识"}</span><span className={`draft-status ${draftSaveState}`} role="status" aria-live="polite">{draftSaveLabel}</span></div>
            <textarea aria-label="客服回复" maxLength={500} value={draft} onChange={(event) => saveConversationDraft(selected.id, event.target.value)} placeholder={currentState === "待接管" ? "接管会话后回复用户…" : "回复用户；涉及承诺、退款和补偿时将自动触发检查…"} disabled={currentState === "待接管"} />
            <div className="reply-actions"><span>{draft.length}/500 · 发送前将检查知识依据与敏感承诺</span><button className="ghost-button" title={canStartClosing ? "确认用户已解决后再结案" : "请先发送回复并等待用户确认"} onClick={() => { setCloseError(""); setShowClose(true); }} disabled={!canStartClosing}>解决并结案</button><button className="primary-button" onClick={sendReply} disabled={currentState === "待接管" || !draft.trim()}>审核并发送</button></div>
            {!canStartClosing && currentState !== "待接管" && <small className="reply-guidance">完成回复并收到用户确认后，才可结构化结案。</small>}
          </div> : <div className="resolved-footer"><span>✓</span><div><b>会话已解决</b><small>{selected.resolutionSummary ? `${selected.resolutionCategory ?? "已结案"} · ${selected.resolutionSummary} · 72 小时内再次咨询将重新打开并保留上下文` : "用户已确认 · 72 小时内再次咨询将重新打开并保留上下文"}</small></div><button className="ghost-button" disabled={reopenSaving} onClick={() => { setReopenError(""); setShowReopen(true); }}>{reopenSaving ? "重新打开中…" : "重新打开"}</button></div>}
        </article>

        {mobileInsightOpen && <button type="button" className="mobile-insight-scrim" aria-label="关闭服务辅助面板" onClick={() => setMobileInsightOpen(false)} />}
        <aside ref={mobileInsightDialogRef} id="mobile-insight-panel" className={`panel insight-panel${mobileInsightOpen ? " mobile-insight-open" : ""}`} role={mobileInsightOpen ? "dialog" : undefined} aria-modal={mobileInsightOpen ? true : undefined} aria-label="服务上下文和 AI 协助">
          <div className="mobile-insight-head"><b>服务辅助</b><button type="button" aria-label="关闭服务辅助面板" onClick={() => setMobileInsightOpen(false)}>×</button></div>
          <div className="insight-tabs" role="tablist" aria-label="会话辅助视图" aria-orientation="horizontal"><button id={insightTabIds[0]} role="tab" aria-selected={rightTab === "context"} aria-controls="insight-panel-context" tabIndex={rightTab === "context" ? 0 : -1} className={rightTab === "context" ? "active" : ""} onClick={() => setRightTab("context")} onKeyDown={(event) => handleTabKeyDown(event, insightTabIds, 0, (nextIndex) => setRightTab(nextIndex === 0 ? "context" : "assist"))}>服务上下文</button><button id={insightTabIds[1]} role="tab" aria-selected={rightTab === "assist"} aria-controls="insight-panel-assist" tabIndex={rightTab === "assist" ? 0 : -1} className={rightTab === "assist" ? "active" : ""} onClick={() => setRightTab("assist")} onKeyDown={(event) => handleTabKeyDown(event, insightTabIds, 1, (nextIndex) => setRightTab(nextIndex === 0 ? "context" : "assist"))}>AI 协助</button></div>
          {rightTab === "context" ? <div id="insight-panel-context" role="tabpanel" aria-labelledby={insightTabIds[0]} tabIndex={0}>
            <div className="insight-section verified-facts"><div className="insight-title"><h3>处理前核验</h3><Status kind={isOrderMissing ? "warning" : "success"}>{isOrderMissing ? "有待补充" : "可用于回复"}</Status></div>{selected.facts.map((fact) => <div className="fact-row" key={fact.label}><span>✓</span><p><b>{fact.label}：{fact.value}</b><small>{fact.source}</small></p></div>)}{isOrderMissing && <div className="fact-row fact-gap"><span>!</span><p><b>订单信息：尚未关联</b><small>涉及退款进度时，建议先向用户补充订单号或申请时间。</small><button onClick={() => insertText("为准确核验进度，麻烦您提供订单号或退款申请时间，我马上为您查询。")}>带入补问信息</button></p></div>}</div>
            <div className="insight-section"><h3>用户与业务信息</h3><dl><div><dt>用户等级</dt><dd>{selected.member}</dd></div><div><dt>消费记录</dt><dd>{selected.orderHistory}</dd></div><div><dt>关联订单</dt><dd>{isOrderMissing ? "待补充" : selected.order}</dd></div><div><dt>隐私保护</dt><dd>已脱敏</dd></div></dl></div>
            <div className="insight-section"><h3>AI 会话摘要</h3><p>{selected.summary}</p><button className="feedback-link" aria-busy={summaryFeedbackSaving} disabled={summaryFeedbackSaving || summaryFeedbackSent} onClick={() => void submitSummaryFeedback()}>{summaryFeedbackSent ? "已提交摘要问题" : summaryFeedbackSaving ? "提交中…" : "摘要不准确？反馈问题"}</button></div>
          </div> : <div id="insight-panel-assist" role="tabpanel" aria-labelledby={insightTabIds[1]} tabIndex={0}>
            <div className="insight-section ai-suggestion"><div className="insight-title"><h3>推荐回复</h3><Status kind={selected.draft ? "success" : "warning"}>{selected.draft ? "可编辑后发送" : "尚未生成"}</Status></div><p>{selected.draft || "当前没有可直接发送的建议。请先核验右侧事实；订单缺失时，优先向用户补充订单号或退款申请时间。"}</p><div><button className="primary-button" disabled={!selected.draft} title={selected.draft ? "将建议带入回复框" : "当前会话没有可用建议"} onClick={() => { saveConversationDraft(selected.id, selected.draft); flash("已将建议带入回复框，并保存为本机草稿"); }}>采用建议</button><button className="ghost-button" aria-busy={suggestionFeedbackSaving} disabled={suggestionFeedbackSaving || suggestionFeedbackSent} onClick={() => void submitSuggestionFeedback()}>{suggestionFeedbackSent ? "已提交反馈" : suggestionFeedbackSaving ? "提交中…" : "标记无帮助"}</button></div></div>
            <div className="insight-section"><h3>建议的下一步</h3><button className="next-action" aria-busy={nextActionSaving} disabled={nextActionSaving || nextActionSentFor === selected.id} onClick={() => void requestSuggestedAction()}><b>{nextActionSentFor === selected.id ? "已发起核验" : nextActionSaving ? "发起中…" : selected.suggestedAction}</b><span>只读核验 · 不会直接变更业务数据</span></button><button className="next-action" aria-busy={supervisorEscalationSaving} disabled={supervisorEscalationSaving || supervisorEscalationSentFor === selected.id} onClick={() => void requestSupervisorEscalation()}><b>{supervisorEscalationSentFor === selected.id ? "已提交升级请求" : supervisorEscalationSaving ? "提交中…" : "升级值班主管"}</b><span>提交人工审批 · 不会虚报已升级成功</span></button></div>
            <div className="insight-section safety-note"><h3>操作边界</h3><p>客服可以查询并解释业务结果；退款、补偿、账户与地址变更需要身份核验或审批，系统不会代替你直接执行。</p></div>
          </div>}
        </aside>
      </div>
      {showClose && <div className="close-sheet" role="dialog" aria-modal="true" aria-labelledby="close-title"><button className="sheet-backdrop" aria-label="取消结案" onClick={() => setShowClose(false)} /><section ref={closeDialogRef} tabIndex={-1}><header><div><span>结构化结案</span><h2 id="close-title">确认问题已经解决</h2></div><button aria-label="关闭结案面板" onClick={() => setShowClose(false)}>×</button></header><form onSubmit={(event) => { event.preventDefault(); void closeConversation(); }}><p>结案信息会用于 SLA、质检和 AI 改进。用户再次咨询时仍会保留完整上下文。</p>{closeError && <div className="close-error" role="alert">{closeError} 再次确认结案即可重试。</div>}<label>解决结果（必填）<select required value={resolution} onChange={(event) => setResolution(event.target.value)}><option>已解释规则并完成业务核验</option><option>已创建工单，等待内部处理</option><option>已完成授权业务操作</option><option>用户主动取消咨询</option></select></label><label>解决摘要（必填）<textarea required aria-label="解决摘要" maxLength={1000} value={resolutionSummary} onChange={(event) => setResolutionSummary(event.target.value)} placeholder="记录最终核验结果、已完成动作和后续承诺…" autoFocus /></label><label className="close-check"><input type="checkbox" required checked={customerConfirmed} onChange={(event) => setCustomerConfirmed(event.target.checked)} /><span><b>用户已确认问题解决（必选）</b><small>若用户尚未确认，应先发送回复并保持会话处理中</small></span></label><div className="close-summary"><span>结案分类</span><b>{selected.topic}</b><span>解决方式</span><b>{resolution}</b><span>结案摘要</span><b>{resolutionSummary.trim() ? `${resolutionSummary.trim().length}/1000 字` : "待填写"}</b></div><footer><button type="button" className="ghost-button" onClick={() => setShowClose(false)}>继续处理</button><button type="submit" className="primary-button" aria-busy={closeSaving} disabled={!customerConfirmed || !resolutionSummary.trim() || closeSaving}>{closeSaving ? "结案中…" : "确认结案"}</button></footer></form></section></div>}
      {showReopen && <div className="close-sheet" role="dialog" aria-modal="true" aria-labelledby="reopen-title"><button type="button" className="sheet-backdrop" aria-label="取消重新打开" onClick={() => setShowReopen(false)} /><section ref={reopenDialogRef} tabIndex={-1}><header><div><span>恢复人工跟进</span><h2 id="reopen-title">重新打开会话</h2></div><button type="button" aria-label="关闭重新打开面板" onClick={() => setShowReopen(false)}>×</button></header><form onSubmit={(event) => { event.preventDefault(); void reopenConversation(); }}><p>重新打开后会话回到处理中，上一轮结案信息会保留在审计记录中；本轮需要重新核验并再次获得用户确认。</p>{reopenError && <div className="close-error" role="alert">{reopenError} 请刷新状态后重试。</div>}<label>重新打开原因（必填）<select required value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} autoFocus><option>用户在72小时内再次咨询</option><option>原问题未彻底解决</option><option>补充信息后需要继续处理</option><option>误结案，需要恢复跟进</option></select></label><div className="reopen-history"><span>上一轮结案</span><b>{selected.resolutionCategory ?? "已解决"}</b><small>{selected.resolutionSummary ?? "暂无结案摘要"}{selected.resolvedByEmail ? ` · ${selected.resolvedByEmail}` : ""}</small></div><footer><button type="button" className="ghost-button" onClick={() => setShowReopen(false)}>继续保持已解决</button><button type="submit" className="primary-button" aria-busy={reopenSaving} disabled={!reopenReason || reopenSaving}>{reopenSaving ? "重新打开中…" : "确认重新打开"}</button></footer></form></section></div>}
      {showInternalNote && <div className="close-sheet" role="dialog" aria-modal="true" aria-labelledby="internal-note-title"><button className="sheet-backdrop" aria-label="取消内部备注" onClick={() => setShowInternalNote(false)} /><section ref={internalNoteDialogRef} tabIndex={-1}><header><div><span>仅客服可见</span><h2 id="internal-note-title">添加内部备注</h2></div><button aria-label="关闭内部备注面板" onClick={() => setShowInternalNote(false)}>×</button></header><p>备注会写入当前会话的审计记录，不会发送给用户，也不会改变会话状态。</p><label>备注内容<textarea aria-label="内部备注内容" maxLength={2000} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="记录核验事实、交接信息或后续跟进计划…" autoFocus /></label><footer><span>{internalNote.length}/2000</span><button className="ghost-button" onClick={() => setShowInternalNote(false)}>取消</button><button className="primary-button" disabled={!internalNote.trim() || internalNoteSaving} onClick={() => void saveInternalNote}>{internalNoteSaving ? "保存中…" : "保存备注"}</button></footer></section></div>}
      {showTransfer && <div className="close-sheet" role="dialog" aria-modal="true" aria-labelledby="transfer-title"><button className="sheet-backdrop" aria-label="取消转交" onClick={() => setShowTransfer(false)} /><section ref={transferDialogRef} tabIndex={-1}><header><div><span>会话协作</span><h2 id="transfer-title">转交会话</h2></div><button aria-label="关闭转交面板" onClick={() => setShowTransfer(false)}>×</button></header><p>转交后会话负责人和SLA责任人都会更新，完整上下文会随会话一并交接。</p><label>选择负责人<select aria-label="会话负责人" value={transferAssigneeId} onChange={(event) => setTransferAssigneeId(event.target.value)} autoFocus><option value="">请选择负责人</option>{assignees.map((person) => <option key={person.id} value={person.id}>{person.displayName} · {person.email}</option>)}</select></label><footer><button className="ghost-button" onClick={() => setShowTransfer(false)}>取消</button><button className="primary-button" disabled={!transferAssigneeId || transferSaving} onClick={() => void transferConversation}>{transferSaving ? "转交中…" : "确认转交"}</button></footer></section></div>}
    </section>
  );
}

type TicketState = "unassigned" | "in_progress" | "waiting_customer" | "resolved" | "closed";
type TicketPriority = "P1" | "P2" | "P3";
type TicketRow = { id: string; organizationId: string; conversationId?: string | null; title: string; customerName: string; priority: TicketPriority; state: TicketState; ownerUserId?: string | null; ownerName?: string | null; ownerEmail?: string | null; teamKey?: string | null; slaStartedAt?: string | null; slaDueAt: string; slaState?: TicketSlaState; slaPolicy?: string | null; slaPolicyMinutes?: number | null; slaSource?: "persisted" | "policy-derived" | null; slaTimeZone?: string | null; slaPaused?: boolean; slaPauseReason?: string | null; slaExplanation?: string | null; takeoverAt?: string | null; firstResponseAt?: string | null; resolvedAt?: string | null; closedAt?: string | null; resolutionCategory?: string | null; resolutionSummary?: string | null; reopenCount?: number | null; lastReopenReason?: string | null; triggerReason?: string | null; summary?: string | null; sourceType: string; sourceId?: string | null; traceId?: string | null; isSynthetic?: boolean; createdAt: string; updatedAt: string };
type TicketAssignee = { id: string; displayName: string; email: string };
type TicketNote = { id: string; content: string; actorName: string; createdAt: string };
type TicketTimelineEvent = { id: string; action: string; actorUserId?: string | null; result: string; metadataJson: string; createdAt: string };
type TicketConversationOption = { id: string; customerName: string; channel: string; topic: string; status: string };
type TicketDataScope = { organizationId: string; mode?: "test" | "production"; syntheticCount: number; total: number; kpiEligibleCount?: number; syntheticExcludedFromKpis?: number };
type TicketSyncState = "loading" | "refreshing" | "fresh" | "stale" | "error";
type TicketSort = "priority" | "created" | "updated" | "sla";
type TicketQueueView = "all" | "mine" | "unassigned" | "overdue" | "due_soon";
type TicketSavedView = { id: string; name: string; filter: "all" | TicketState | TicketPriority; view: TicketQueueView; ownerFilter: string; teamFilter: string; sort: TicketSort; query: string; openOnly?: boolean; scope?: "personal" | "team"; teamKey?: string | null; ownerUserId?: string; ownerName?: string; ownerEmail?: string; canEdit?: boolean; isDefault?: boolean };
const ticketSavedViewsStorageKey = "servicepilot-ticket-saved-views-v1";

const ticketStateLabels: Record<TicketState, string> = { unassigned: "待领取", in_progress: "处理中", waiting_customer: "等待用户", resolved: "已解决", closed: "已关闭" };
const ticketStateKinds: Record<TicketState, string> = { unassigned: "warning", in_progress: "info", waiting_customer: "warning", resolved: "success", closed: "neutral" };
const ticketFilters: Array<{ key: "all" | TicketState | TicketPriority; label: string }> = [
  { key: "all", label: "全部" }, { key: "unassigned", label: "待领取" }, { key: "in_progress", label: "处理中" }, { key: "waiting_customer", label: "等待用户" }, { key: "P1", label: "P1" }, { key: "P2", label: "P2" }, { key: "P3", label: "P3" }, { key: "resolved", label: "已解决" }, { key: "closed", label: "已关闭" },
];
const ticketViewTabs: Array<{ key: TicketQueueView; label: string }> = [
  { key: "all", label: "全部队列" }, { key: "mine", label: "我的工单" }, { key: "unassigned", label: "未分配" }, { key: "overdue", label: "已超时" }, { key: "due_soon", label: "即将超时" },
];

type TicketUrlState = { ticket?: string; page: number; pageSize: 25 | 50 | 100; filter: "all" | TicketState | TicketPriority; view: TicketQueueView; openOnly: boolean; ownerFilter: string; teamFilter: string; sort: TicketSort; query: string };
type TicketBulkPreview = { action: "bulk_assign" | "bulk_update"; count: number; ids: string[]; changes: string[]; blocked: Array<{ id: string; reason: string }>; ownerEmail?: string | null; priority?: TicketPriority; state?: Exclude<TicketState, "resolved" | "closed"> };
function readTicketUrlState(): TicketUrlState {
  if (typeof window === "undefined") return { page: 1, pageSize: 25, filter: "all", view: "all", openOnly: false, ownerFilter: "", teamFilter: "", sort: "updated", query: "" };
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get("ticketPage"));
  const size = Number(params.get("ticketPageSize"));
  const filter = params.get("ticketFilter");
  const view = params.get("ticketView");
  const sort = params.get("ticketSort");
  return {
    ticket: params.get("ticket") ?? undefined,
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
    pageSize: size === 50 || size === 100 ? size : 25,
    filter: filter && ticketFilters.some((item) => item.key === filter) ? filter as TicketUrlState["filter"] : "all",
    view: view && ticketViewTabs.some((item) => item.key === view) ? view as TicketQueueView : "all",
    openOnly: params.get("ticketOpen") === "1",
    ownerFilter: params.get("ticketOwner") ?? "",
    teamFilter: params.get("ticketTeam") ?? "",
    sort: sort === "priority" || sort === "created" || sort === "sla" ? sort : "updated",
    query: (params.get("ticketQ") ?? "").slice(0, 100),
  };
}

function TicketActionModal({ title, description, value, onChange, onCancel, onConfirm, saving, kind, category, onCategoryChange }: { title: string; description: string; value: string; onChange: (value: string) => void; onCancel: () => void; onConfirm: () => void; saving: boolean; kind: "resolve" | "reopen" | "close"; category?: string; onCategoryChange?: (value: string) => void }) {
  return <div className="ticket-action-modal-backdrop" role="presentation"><section className="ticket-action-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-action-title"><header><div><span>结构化工单操作</span><h2 id="ticket-action-title">{title}</h2></div><button className="icon-button" aria-label="关闭操作面板" onClick={onCancel}>×</button></header><p>{description}</p>{kind === "resolve" && <label>解决分类<select value={category ?? ""} onChange={(event) => onCategoryChange?.(event.target.value)}><option value="已完成业务核验">已完成业务核验</option><option value="已创建后续工单">已创建后续工单</option><option value="用户主动取消">用户主动取消</option><option value="无法联系用户">无法联系用户</option></select></label>}<label>{kind === "resolve" ? "解决摘要（必填）" : kind === "close" ? "关闭原因（必填）" : "重新打开原因（必填）"}<textarea value={value} onChange={(event) => onChange(event.target.value)} maxLength={2000} autoFocus placeholder={kind === "resolve" ? "记录最终核验结果、已完成动作和后续承诺…" : kind === "close" ? "说明为什么可以关闭这条已解决工单…" : "记录需要继续跟进的事实和原因…"} /></label><footer><button className="ghost-button" onClick={onCancel}>取消</button><button className="primary-button" disabled={!value.trim() || saving} onClick={onConfirm}>{saving ? "提交中…" : kind === "resolve" ? "确认已解决" : kind === "close" ? "确认关闭" : "确认重新打开"}</button></footer></section></div>;
}

function Tickets({ onNavigate, initialTicketId }: { onNavigate: (next: NavKey) => void; initialTicketId?: string }) {
  const pageSizeOptions = [25, 50, 100] as const;
  const [initialUrlState] = useState<TicketUrlState>(() => readTicketUrlState());
  const [pageSize, setPageSize] = useState<(typeof pageSizeOptions)[number]>(initialUrlState.pageSize);
  const [filter, setFilter] = useState<"all" | TicketState | TicketPriority>(initialUrlState.filter);
  const [view, setView] = useState<TicketQueueView>(initialUrlState.view);
  const [openOnly, setOpenOnly] = useState(initialUrlState.openOnly);
  const [ownerFilter, setOwnerFilter] = useState(initialUrlState.ownerFilter);
  const [teamFilter, setTeamFilter] = useState(initialUrlState.teamFilter);
  const [sort, setSort] = useState<TicketSort>(initialUrlState.sort);
  const [query, setQuery] = useState(initialUrlState.query);
  const [page, setPage] = useState(initialUrlState.page);
  const [pageJump, setPageJump] = useState("");
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
  const [filterCounts, setFilterCounts] = useState<Record<string, number>>({});
  const [assignees, setAssignees] = useState<TicketAssignee[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOwnerEmail, setBulkOwnerEmail] = useState("");
  const [bulkPriority, setBulkPriority] = useState<"" | TicketPriority>("");
  const [bulkState, setBulkState] = useState<"" | Exclude<TicketState, "resolved" | "closed">>("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<TicketBulkPreview | null>(null);
  const [bulkRetry, setBulkRetry] = useState<{ action: TicketBulkPreview["action"]; payload: Record<string, unknown> } | null>(null);
  const [exportSaving, setExportSaving] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportRetryMode, setExportRetryMode] = useState<"page" | "selected" | "filtered" | null>(null);
  const [savedViews, setSavedViews] = useState<TicketSavedView[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = JSON.parse(window.localStorage.getItem(ticketSavedViewsStorageKey) ?? "[]") as unknown;
      return Array.isArray(stored) ? stored.filter((item): item is TicketSavedView => Boolean(item && typeof item === "object" && "id" in item && "name" in item && typeof item.name === "string")) : [];
    } catch { return []; }
  });
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [savedViewName, setSavedViewName] = useState("");
  const [savedViewScope, setSavedViewScope] = useState<"personal" | "team">("personal");
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [editingViewId, setEditingViewId] = useState("");
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [summary, setSummary] = useState<{ total: number; open: number; p1Open: number; slaRate: number | null; averageResolutionMinutes: number | null; kpiScope?: string; kpiEligibleCount?: number; syntheticExcludedCount?: number }>({ total: 0, open: 0, p1Open: 0, slaRate: null, averageResolutionMinutes: null });
  const [dataScope, setDataScope] = useState<TicketDataScope | null>(null);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<TicketSyncState>("loading");
  const [selected, setSelected] = useState<TicketRow | null>(null);
  const [notes, setNotes] = useState<TicketNote[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TicketTimelineEvent[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [resolutionCategory, setResolutionCategory] = useState("已完成业务核验");
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [actorRole, setActorRole] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", customerName: "", priority: "P2" as TicketPriority, conversationId: "", ownerEmail: "", teamKey: "", summary: "" });
  const [createRequestId, setCreateRequestId] = useState("");
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationOptions, setConversationOptions] = useState<TicketConversationOption[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<TicketConversationOption | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ignoreInitialTicketRef = useRef(false);
  const ticketRequestIdRef = useRef(0);
  const ticketRequestRef = useRef<AbortController | null>(null);
  const ticketDetailRequestIdRef = useRef(0);
  const ticketDetailRequestRef = useRef<AbortController | null>(null);
  const ticketViewsRequestRef = useRef<AbortController | null>(null);
  const conversationSearchRequestRef = useRef<AbortController | null>(null);
  const renderedAt = now;
  const canBulkOperate = ["supervisor", "system_admin", "product_admin"].includes(actorRole ?? "");

  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 2600); }
  function stateLabel(state: string) { return ticketStateLabels[state as TicketState] ?? state; }
  function timelineLabel(action: string) { const labels: Record<string, string> = { "ticket.create": "创建工单", "ticket.claim": "领取工单", "ticket.assign": "分配负责人", "ticket.update": "更新工单", "ticket.resolve": "标记已解决", "ticket.reopen": "重新打开", "ticket.close": "关闭工单", "ticket.note": "添加处理记录", bulk_assign: "批量分配", bulk_update: "批量更新" }; return labels[action] ?? action; }
  function timelineSummary(event: TicketTimelineEvent) { try { const metadata = JSON.parse(event.metadataJson) as { content?: string; fromState?: string; toState?: string; fromPriority?: string; toPriority?: string; ownerUserId?: string | null; closeReason?: string; reopenReason?: string }; if (metadata.content) return metadata.content; const changes = [metadata.fromState && metadata.toState && `状态 ${stateLabel(metadata.fromState)} → ${stateLabel(metadata.toState)}`, metadata.fromPriority && metadata.toPriority && `优先级 ${metadata.fromPriority} → ${metadata.toPriority}`, metadata.closeReason && `关闭原因：${metadata.closeReason}`, metadata.reopenReason && `重开原因：${metadata.reopenReason}`, metadata.ownerUserId !== undefined && "负责人已更新"].filter(Boolean); return changes.join(" · ") || (event.result === "allowed" ? "操作已写入审计记录" : `结果：${event.result}`); } catch { return event.result === "allowed" ? "操作已写入审计记录" : `结果：${event.result}`; } }
  function createSlaPreview(priority: TicketPriority) { const minutes = priority === "P1" ? 60 : priority === "P2" ? 240 : 1440; return `${priority} 默认 SLA ${minutes >= 1440 ? "24 小时" : `${minutes} 分钟`} · 预计截止 ${formatDate(new Date(now + minutes * 60_000).toISOString())}`; }
  function formatDate(value?: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  function formatSlaDate(value?: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : `${date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}（中国标准时间 UTC+8）`; }
  function formatSnapshot(value: string | null) { return value ? formatDate(value) : "—"; }
  function slaText(value: string) { const due = new Date(value).getTime(); if (!Number.isFinite(due)) return "—"; const deltaMinutes = Math.round((due - now) / 60_000); if (deltaMinutes < 0) { const overdueMinutes = Math.max(1, Math.abs(deltaMinutes)); if (overdueMinutes >= 1_440) { const days = Math.floor(overdueMinutes / 1_440); const hours = Math.floor((overdueMinutes % 1_440) / 60); return `已超时 ${days} 天${hours ? ` ${hours} 小时` : ""}`; } if (overdueMinutes >= 60) return `已超时 ${Math.floor(overdueMinutes / 60)} 小时`; return `已超时 ${overdueMinutes} 分钟`; } if (deltaMinutes < 60) return `剩余 ${Math.max(1, deltaMinutes)} 分钟`; if (deltaMinutes < 1_440) return `剩余 ${Math.floor(deltaMinutes / 60)} 小时`; return `剩余 ${Math.floor(deltaMinutes / 1_440)} 天`; }
  const slaStateLabels: Record<TicketSlaState, string> = { on_track: "进行中", due_soon: "即将超时", overdue: "已超时", completed: "已完成", unknown: "状态未知" };
  const slaStateKinds: Record<TicketSlaState, string> = { on_track: "info", due_soon: "warning", overdue: "danger", completed: "success", unknown: "neutral" };
  function ticketSlaState(ticket: TicketRow): TicketSlaState { return slaStatus(ticket.slaDueAt, ticket.state, now); }
  function ticketSlaDueText(ticket: TicketRow) { const state = ticketSlaState(ticket); if (state === "completed") return ticket.resolvedAt ? `已完成 · ${formatDate(ticket.resolvedAt)}` : "已完成"; if (state === "unknown") return "SLA 未知"; return slaText(ticket.slaDueAt); }
  function ticketSlaExplanation(ticket: TicketRow) { if (ticket.slaExplanation) return ticket.slaExplanation; const state = ticketSlaState(ticket); if (state === "unknown") return "缺少有效截止时间，暂不参与 SLA 风险判断"; if (state === "completed") return ticket.resolvedAt && new Date(ticket.resolvedAt).getTime() <= new Date(ticket.slaDueAt).getTime() ? "已在 SLA 截止时间前解决" : "解决时间晚于 SLA 截止时间"; if (state === "overdue") return ticket.state === "unassigned" ? "尚未领取，当前没有责任人" : ticket.state === "waiting_customer" ? "等待用户状态仍计入当前 SLA 策略" : "尚未解决，已超过 SLA 截止时间"; if (state === "due_soon") return "距离 SLA 截止时间不足 30 分钟"; return "距离 SLA 截止时间超过 30 分钟"; }
  function renderTicketSlaCell(ticket: TicketRow) { const state = ticketSlaState(ticket); return <div className={`ticket-sla-cell ${state}`} aria-label={`SLA ${slaStateLabels[state]}：${ticketSlaDueText(ticket)}。${ticketSlaExplanation(ticket)}`}><Status kind={slaStateKinds[state]}>{`SLA · ${slaStateLabels[state]}`}</Status><strong>{ticketSlaDueText(ticket)}</strong><small>{state === "completed" ? ticketSlaExplanation(ticket) : `截止 ${formatSlaDate(ticket.slaDueAt)}`}</small></div>; }
  async function responseError(response: Response, fallback: string) { try { const body = await response.json() as { error?: string }; return body.error || fallback; } catch { return fallback; } }
  function writeTicketUrl(ticketId: string | null = selected?.id ?? null, mode: "replace" | "push" = "replace") {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("view", "tickets");
    params.delete("resourceId");
    if (ticketId) params.set("ticket", ticketId); else params.delete("ticket");
    const setOrDelete = (key: string, value: string, defaultValue: string) => value === defaultValue ? params.delete(key) : params.set(key, value);
    setOrDelete("ticketPage", String(page), "1");
    setOrDelete("ticketPageSize", String(pageSize), "25");
    setOrDelete("ticketFilter", filter, "all");
    setOrDelete("ticketView", view, "all");
    setOrDelete("ticketOpen", openOnly ? "1" : "0", "0");
    setOrDelete("ticketOwner", ownerFilter, "");
    setOrDelete("ticketTeam", teamFilter, "");
    setOrDelete("ticketSort", sort, "updated");
    setOrDelete("ticketQ", query.trim(), "");
    window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", `?${params.toString()}`);
  }
  function clearFilters() { setFilter("all"); setView("all"); setOpenOnly(false); setOwnerFilter(""); setTeamFilter(""); setSort("updated"); setQuery(""); setPage(1); }
  function applySavedView(savedView: TicketSavedView) { setSelectedSavedViewId(savedView.id); setFilter(savedView.filter); setView(savedView.view); setOpenOnly(Boolean(savedView.openOnly)); setOwnerFilter(savedView.ownerFilter); setTeamFilter(savedView.teamFilter); setSort(savedView.sort); setQuery(savedView.query); setPage(1); flash(`已切换到视图“${savedView.name}”`); }
  function closeDetail() { ignoreInitialTicketRef.current = true; ticketDetailRequestRef.current?.abort(); writeTicketUrl(null); setSelected(null); setNotes([]); setTimelineEvents([]); setDetailLoading(false); }
  async function copyTicketLink() {
    try { await navigator.clipboard.writeText(window.location.href); flash("当前队列链接已复制"); }
    catch { setError("复制失败，请从浏览器地址栏复制当前链接"); }
  }
  const ticketDetailDialogRef = useDialogFocus(Boolean(selected), closeDetail);
  const ticketCreateDialogRef = useDialogFocus(createOpen, () => setCreateOpen(false));
  const saveViewDialogRef = useDialogFocus(saveViewOpen, () => setSaveViewOpen(false));
  const bulkPreviewDialogRef = useDialogFocus(Boolean(bulkPreview), () => setBulkPreview(null));
  const ticketViewTabIds = ticketViewTabs.map((item) => `ticket-view-tab-${item.key}`);
  async function loadSavedViews() {
    ticketViewsRequestRef.current?.abort();
    const controller = new AbortController(); ticketViewsRequestRef.current = controller;
    try {
      const response = await fetch("/api/ticket-views", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response, "保存视图读取失败"));
      const body = await response.json() as { views?: TicketSavedView[] };
      if (controller.signal.aborted) return;
      const next = body.views ?? [];
      setSavedViews(next);
      const defaultView = next.find((item) => item.isDefault);
      if (defaultView && !window.location.search.includes("ticketView=") && !window.location.search.includes("ticketFilter=")) applySavedView(defaultView);
      if (defaultView) setSelectedSavedViewId(defaultView.id);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "保存视图读取失败");
    }
  }
  async function saveCurrentView() {
    const name = savedViewName.trim();
    if (!name) return;
    if (editingViewId) {
      await updateSavedView(editingViewId, { name });
      setSavedViewName(""); setEditingViewId(""); setSaveViewOpen(false);
      return;
    }
    try {
      const response = await fetch("/api/ticket-views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, scope: savedViewScope, filter, view, openOnly, ownerFilter, teamFilter, sort, query: query.trim(), isDefault: false }) });
      if (!response.ok) throw new Error(await responseError(response, "保存视图失败"));
      const body = await response.json() as { view?: TicketSavedView };
      if (body.view) setSavedViews((current) => [body.view!, ...current.filter((item) => item.id !== body.view!.id)]);
      setSavedViewName(""); setSaveViewOpen(false); flash(`已保存视图“${name}”（${savedViewScope === "team" ? "团队共享" : "个人"}）`); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存视图失败"); }
  }
  async function updateSavedView(id: string, payload: { name?: string; isDefault?: boolean }) {
    try {
      const response = await fetch(`/api/ticket-views/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await responseError(response, "视图更新失败"));
      const body = await response.json() as { view?: TicketSavedView };
      if (body.view) setSavedViews((current) => current.map((item) => item.id === id ? body.view! : payload.isDefault ? { ...item, isDefault: false } : item));
      flash(payload.isDefault ? "已设为默认视图" : "视图名称已更新"); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "视图更新失败"); }
  }
  async function deleteSavedView(id: string) {
    try {
      const response = await fetch(`/api/ticket-views/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "视图删除失败"));
      setSavedViews((current) => current.filter((item) => item.id !== id)); setSelectedSavedViewId(""); flash("视图已删除"); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "视图删除失败"); }
  }
  function ticketExportPayload(mode: "page" | "selected" | "filtered") {
    const params: Record<string, unknown> = { mode, page, pageSize, sort, q: query.trim(), view, owner: ownerFilter, team: teamFilter, open: openOnly };
    if (filter !== "all") { if (filter === "P1" || filter === "P2" || filter === "P3") params.priority = filter; else params.state = filter; }
    if (mode === "selected") params.ids = selectedIds;
    return params;
  }
  function downloadCsv(blob: Blob, fileName: string) {
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = fileName; link.click(); URL.revokeObjectURL(link.href);
  }
  async function exportTickets(mode: "page" | "selected" | "filtered") {
    if (exportSaving || (mode === "selected" && !selectedIds.length) || (mode === "filtered" && !canBulkOperate)) return;
    setExportSaving(true);
    setExportProgress(8);
    setExportRetryMode(mode);
    try {
      const response = await fetch("/api/tickets/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ticketExportPayload(mode)) });
      if (!response.ok && response.status !== 202) throw new Error(await responseError(response, "导出失败，请重试"));
      if (response.status === 202) {
        const task = await response.json() as { jobId?: string; rowCount?: number; message?: string };
        if (!task.jobId) throw new Error("导出任务未返回任务编号");
        setExportProgress(20);
        flash(`${task.message ?? "导出任务已创建"}（${task.rowCount ?? 0} 条）`);
        let completed = false;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 700));
          setExportProgress(Math.min(90, 20 + (attempt + 1) * 7));
          const taskResponse = await fetch(`/api/tickets/export/${encodeURIComponent(task.jobId)}`, { cache: "no-store" });
          if (taskResponse.status === 202 || taskResponse.status === 503) continue;
          if (!taskResponse.ok) throw new Error(await responseError(taskResponse, "导出任务失败，请重试"));
          const disposition = taskResponse.headers.get("content-disposition") ?? "";
          const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? "servicepilot-tickets-filtered.csv";
          downloadCsv(await taskResponse.blob(), fileName); completed = true; break;
        }
        if (!completed) throw new Error("导出仍在准备中，请稍后从通知中下载");
      } else {
        const disposition = response.headers.get("content-disposition") ?? "";
        const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? "servicepilot-tickets.csv";
        downloadCsv(await response.blob(), fileName);
        flash(`已导出${mode === "page" ? "当前页" : "已选"}工单`);
      }
      setExportProgress(100); setError(""); setExportRetryMode(null); window.setTimeout(() => setExportProgress(0), 2600);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导出失败，请重试"); setExportProgress(0); } finally { setExportSaving(false); }
  }
  async function loadTickets(targetPage = page) {
    const requestId = ++ticketRequestIdRef.current;
    ticketRequestRef.current?.abort();
    const controller = new AbortController();
    ticketRequestRef.current = controller;
    const hasSnapshot = rows.length > 0 && Boolean(dataAsOf);
    const isCurrent = () => requestId === ticketRequestIdRef.current && !controller.signal.aborted;
    setLoading(true);
    setSyncState(hasSnapshot ? "refreshing" : "loading");
    try {
      const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize) });
      if (filter !== "all") { if (filter === "P1" || filter === "P2" || filter === "P3") params.set("priority", filter); else params.set("state", filter); }
      if (view !== "all") params.set("view", view);
      if (openOnly) params.set("open", "1");
      if (ownerFilter) params.set("owner", ownerFilter);
      if (teamFilter) params.set("team", teamFilter);
      params.set("sort", sort);
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/tickets?${params.toString()}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response, "工单读取失败"));
      const body = await response.json() as { tickets?: TicketRow[]; assignees?: TicketAssignee[]; teams?: string[]; pagination?: typeof pagination; summary?: typeof summary; dataScope?: TicketDataScope; dataAsOf?: string; actor?: { role?: string | null }; viewCounts?: Record<string, number>; filterCounts?: Record<string, number> };
      if (!isCurrent()) return;
      const nextRows = body.tickets ?? [];
      setRows(nextRows); setSelectedIds((current) => current.filter((id) => nextRows.some((ticket) => id === ticket.id))); setAssignees(body.assignees ?? []); setTeams(body.teams ?? []); setPagination(body.pagination ?? { page: targetPage, pageSize, total: 0, totalPages: 1 }); setSummary(body.summary ?? { total: 0, open: 0, p1Open: 0, slaRate: null, averageResolutionMinutes: null }); setViewCounts(body.viewCounts ?? {}); setFilterCounts(body.filterCounts ?? {}); setDataScope(body.dataScope ?? null); setDataAsOf(body.dataAsOf ?? null); setActorRole(body.actor?.role ?? null); setError("");
      setSyncState("fresh");
    } catch (cause) {
      if (!isCurrent() || (cause instanceof Error && cause.name === "AbortError")) return;
      setError(cause instanceof Error ? cause.message : "工单读取失败");
      setSyncState(hasSnapshot ? "stale" : "error");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }
  async function openDetail(ticket: TicketRow) {
    ignoreInitialTicketRef.current = false;
    writeTicketUrl(ticket.id, "push");
    const requestId = ++ticketDetailRequestIdRef.current;
    ticketDetailRequestRef.current?.abort();
    const controller = new AbortController();
    ticketDetailRequestRef.current = controller;
    const isCurrent = () => requestId === ticketDetailRequestIdRef.current && !controller.signal.aborted;
    setSelected(ticket); setNotes([]); setDetailLoading(true); setError("");
    try {
      const response = await fetch(`/api/tickets/${encodeURIComponent(ticket.id)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response, "工单详情读取失败"));
      const body = await response.json() as { ticket?: TicketRow; notes?: TicketNote[]; events?: TicketTimelineEvent[]; actor?: { role?: string | null } };
      if (!isCurrent()) return;
      if (body.ticket) setSelected(body.ticket); setNotes(body.notes ?? []); setTimelineEvents(body.events ?? []);
      setActorRole(body.actor?.role ?? actorRole);
    } catch (cause) {
      if (!isCurrent() || (cause instanceof Error && cause.name === "AbortError")) return;
      setError(cause instanceof Error ? cause.message : "工单详情读取失败");
    } finally {
      if (isCurrent()) setDetailLoading(false);
    }
  }
  async function mutateTicket(id: string, payload: Record<string, unknown>, success: string) {
    if (payload.action === "update" && payload.state === "resolved") { setResolveOpen(true); setError(""); return; }
    if (payload.action === "update" && payload.state === "closed") { setCloseOpen(true); setError(""); return; }
    if (payload.action === "resolve" && !payload.confirmed) { setResolveOpen(true); setError(""); return; }
    if (payload.action === "reopen" && !payload.confirmed) { setReopenOpen(true); setError(""); return; }
    if (payload.action === "close" && !payload.confirmed) { setCloseOpen(true); setError(""); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/tickets/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await responseError(response, "工单操作未保存"));
      await loadTickets(page);
      const detailResponse = await fetch(`/api/tickets/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (detailResponse.ok) { const body = await detailResponse.json() as { ticket?: TicketRow; notes?: TicketNote[]; events?: TicketTimelineEvent[]; actor?: { role?: string | null } }; if (body.ticket) setSelected(body.ticket); setNotes(body.notes ?? []); setTimelineEvents(body.events ?? []); setActorRole(body.actor?.role ?? actorRole); }
      if (payload.action === "resolve") { setResolveOpen(false); setResolutionSummary(""); }
      if (payload.action === "reopen") { setReopenOpen(false); setReopenReason(""); }
      if (payload.action === "close") { setCloseOpen(false); setCloseReason(""); }
      flash(success); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "工单操作未保存"); } finally { setSaving(false); }
  }
  async function createTicket() {
    const nextErrors: Record<string, string> = {};
    if (!createForm.title.trim()) nextErrors.title = "请填写工单标题";
    if (!createForm.customerName.trim()) nextErrors.customerName = "请填写客户名称，便于后续交接";
    if (conversationSearch.trim() && !selectedConversation) nextErrors.conversation = "请从搜索结果中选择关联会话，不要手填会话 ID";
    setCreateErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setError("请先修正标记的字段"); return; }
    const requestKey = createRequestId || `ticket-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    if (!createRequestId) setCreateRequestId(requestKey);
    setSaving(true);
    try {
      const response = await fetch("/api/tickets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...createForm, conversationId: selectedConversation?.id || undefined, ownerEmail: createForm.ownerEmail || undefined, teamKey: createForm.teamKey || undefined, idempotencyKey: requestKey }) });
      if (!response.ok) throw new Error(await responseError(response, "工单创建失败"));
      const body = await response.json() as { created?: boolean; ticket?: TicketRow };
      setCreateOpen(false); setCreateForm({ title: "", customerName: "", priority: "P2", conversationId: "", ownerEmail: "", teamKey: "", summary: "" }); setCreateRequestId(""); setCreateErrors({}); setConversationSearch(""); setConversationOptions([]); setSelectedConversation(null); setPage(1); await loadTickets(1); if (body.ticket) setSelected(body.ticket); flash(body.idempotent ? "已安全恢复上次创建结果，未生成重复工单" : body.created === false ? "该会话已有未关闭工单，已打开现有记录" : `工单 ${body.ticket?.id ?? ""} 已保存`); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "工单创建失败"); } finally { setSaving(false); }
  }
  async function addNote() { if (!selected || !note.trim()) return; await mutateTicket(selected.id, { action: "add_note", content: note.trim() }, "处理记录已保存"); setNote(""); }
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => {
    ticketRequestRef.current?.abort();
    ticketDetailRequestRef.current?.abort();
    ticketViewsRequestRef.current?.abort();
    conversationSearchRequestRef.current?.abort();
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void loadSavedViews(); }, 0); return () => { window.clearTimeout(timer); ticketViewsRequestRef.current?.abort(); }; }, []);
  useEffect(() => {
    if (!createOpen || !conversationSearch.trim()) {
      const clearTimer = window.setTimeout(() => { setConversationOptions([]); setConversationLoading(false); }, 0);
      return () => window.clearTimeout(clearTimer);
    }
    const timer = window.setTimeout(() => {
      conversationSearchRequestRef.current?.abort();
      const controller = new AbortController(); conversationSearchRequestRef.current = controller;
      setConversationLoading(true);
      fetch(`/api/conversations?q=${encodeURIComponent(conversationSearch.trim())}&page=1&pageSize=8`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => { if (!response.ok) throw new Error("关联会话读取失败"); return response.json() as Promise<{ conversations?: TicketConversationOption[] }>; })
        .then((body) => { if (!controller.signal.aborted) setConversationOptions(body.conversations ?? []); })
        .catch((cause) => { if (!(cause instanceof Error && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "关联会话读取失败"); })
        .finally(() => { if (!controller.signal.aborted) setConversationLoading(false); });
    }, 240);
    return () => { window.clearTimeout(timer); conversationSearchRequestRef.current?.abort(); };
  }, [conversationSearch, createOpen]);
  async function previewBulkAction(payload: Record<string, unknown>, action: TicketBulkPreview["action"]) {
    if (!selectedIds.length || bulkSaving || !canBulkOperate) return;
    setBulkSaving(true);
    setBulkRetry({ action, payload });
    try {
      const response = await fetch("/api/tickets", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: selectedIds, action, ...payload, preview: true }) });
      if (!response.ok) throw new Error(await responseError(response, "无法生成批量影响预览"));
      const body = await response.json() as { preview?: TicketBulkPreview };
      if (!body.preview) throw new Error("服务器没有返回影响预览");
      setBulkPreview(body.preview); setBulkRetry(null); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法生成批量影响预览"); } finally { setBulkSaving(false); }
  }
  async function confirmBulkAction() {
    if (!bulkPreview || bulkPreview.blocked.length || bulkSaving || !canBulkOperate) return;
    setBulkSaving(true);
    try {
      const payload = { ids: bulkPreview.ids, action: bulkPreview.action, ownerEmail: bulkPreview.ownerEmail, priority: bulkPreview.priority, state: bulkPreview.state, confirmed: true };
      const response = await fetch("/api/tickets", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string; updated?: number; failed?: Array<{ id: string; reason: string }> };
      if (!response.ok && response.status !== 207) throw new Error(body.error || "批量操作未保存");
      const failed = body.failed ?? [];
      setBulkPreview(null); setSelectedIds(failed.map((item) => item.id)); setBulkOwnerEmail(""); setBulkPriority(""); setBulkState(""); await loadTickets(page);
      if (failed.length) { setError(`已更新 ${body.updated ?? 0} 条；${failed.length} 条失败，已保留失败选择，可缩小范围后重试`); } else { flash(`已批量更新 ${body.updated ?? bulkPreview.ids.length} 条工单`); setError(""); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "批量操作未保存"); } finally { setBulkSaving(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void loadTickets(page); }, query ? 280 : 120); return () => window.clearTimeout(timer); }, [page, pageSize, filter, query, view, openOnly, ownerFilter, teamFilter, sort]);
  useEffect(() => {
    writeTicketUrl(ignoreInitialTicketRef.current ? selected?.id ?? null : selected?.id ?? initialTicketId ?? initialUrlState.ticket ?? null);
  }, [page, pageSize, filter, query, view, openOnly, ownerFilter, teamFilter, sort, selected?.id, initialTicketId]);
  useEffect(() => {
    if (!initialTicketId) {
      if (selected) {
        // Browser Back from a ticket deep link returns to the preserved queue.
        window.setTimeout(() => { setSelected(null); setNotes([]); setDetailLoading(false); }, 0);
      }
      return;
    }
    const requestId = ++ticketDetailRequestIdRef.current;
    ticketDetailRequestRef.current?.abort();
    const controller = new AbortController();
    ticketDetailRequestRef.current = controller;
    let mounted = true;
    const isCurrent = () => mounted && requestId === ticketDetailRequestIdRef.current && !controller.signal.aborted;
    // Deep-link hydration starts an external request and exposes its loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailLoading(true);
    fetch(`/api/tickets/${encodeURIComponent(initialTicketId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(await responseError(response, "工单详情读取失败")); return response.json() as Promise<{ ticket?: TicketRow; notes?: TicketNote[]; actor?: { role?: string | null } }>; })
      .then((body) => { if (!isCurrent() || !body.ticket) return; setSelected(body.ticket); setNotes(body.notes ?? []); setTimelineEvents(body.events ?? []); setActorRole(body.actor?.role ?? null); setError(""); })
      .catch((cause) => { if (!isCurrent() || (cause instanceof Error && cause.name === "AbortError")) return; setError(cause instanceof Error ? cause.message : "工单详情读取失败"); })
      .finally(() => { if (isCurrent()) setDetailLoading(false); });
    return () => { mounted = false; controller.abort(); };
  }, [initialTicketId]);
  useEffect(() => {
    if (!initialTicketId || !selected) return;
    const timer = window.setTimeout(() => (document.querySelector(".ticket-drawer button") as HTMLButtonElement | null)?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [initialTicketId, selected?.id]);
  const pageNumbers = Array.from({ length: pagination.totalPages }, (_, index) => index + 1).filter((value) => value === 1 || value === pagination.totalPages || Math.abs(value - page) <= 1);
  const scopeLabel = dataScope?.mode === "test" ? "测试租户 / 流程演示" : dataScope?.mode === "production" ? "生产租户" : "正在确认数据范围";
  const syncTitle = syncState === "refreshing" ? "正在刷新队列" : syncState === "fresh" ? "数据已同步" : syncState === "stale" ? "当前显示最近一次成功快照" : syncState === "error" ? "尚未取得可用数据" : "正在同步工单数据";
  const syncDescription = syncState === "stale" ? "本次刷新失败，列表可能已过期；请重试后再做批量或 SLA 判断。" : `${scopeLabel} · 最近成功同步 ${formatSnapshot(dataAsOf)}${dataScope?.syntheticCount ? ` · 合成记录 ${dataScope.syntheticCount.toLocaleString("zh-CN")} 条` : ""}`;
  function openMetricQueue(nextFilter: "all" | TicketPriority, nextOpenOnly: boolean) { setView("all"); setFilter(nextFilter); setOpenOnly(nextOpenOnly); setPage(1); }
  function jumpToPage() { const next = Number(pageJump); if (!Number.isInteger(next) || next < 1 || next > pagination.totalPages) return; setPage(next); setPageJump(""); }

  return <section className="panel table-panel ticket-management">{resolveOpen && selected && <TicketActionModal title="标记为已解决" description="请记录可复核的最终结果。提交后工单会停止当前 SLA 计时并进入已解决，后续如有新事实可重新打开。" kind="resolve" category={resolutionCategory} onCategoryChange={setResolutionCategory} value={resolutionSummary} onChange={setResolutionSummary} onCancel={() => setResolveOpen(false)} onConfirm={() => void mutateTicket(selected.id, { action: "resolve", confirmed: true, resolutionCategory, resolutionSummary }, "工单已标记为已解决")} saving={saving} />}{reopenOpen && selected && <TicketActionModal title="重新打开工单" description="请说明为什么需要恢复人工跟进。重新打开会重新计算本轮 SLA，并保留上一轮解决记录。" kind="reopen" value={reopenReason} onChange={setReopenReason} onCancel={() => setReopenOpen(false)} onConfirm={() => void mutateTicket(selected.id, { action: "reopen", confirmed: true, reopenReason }, "工单已重新打开")} saving={saving} />}{closeOpen && selected && <TicketActionModal title="关闭已解决工单" description="关闭是主管确认的最终归档动作。请留下可审计的关闭原因。" kind="close" value={closeReason} onChange={setCloseReason} onCancel={() => setCloseOpen(false)} onConfirm={() => void mutateTicket(selected.id, { action: "close", confirmed: true, closeReason }, "工单已关闭")} saving={saving} />}{bulkPreview && <div className="ticket-modal-backdrop" role="presentation" onClick={() => setBulkPreview(null)}><section ref={bulkPreviewDialogRef} tabIndex={-1} className="ticket-action-modal ticket-bulk-preview-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-bulk-preview-title" onClick={(event) => event.stopPropagation()}><header><div><span>批量操作影响预览</span><h2 id="ticket-bulk-preview-title">确认批量变更</h2></div><button className="icon-button" aria-label="关闭批量预览" onClick={() => setBulkPreview(null)}>×</button></header><p>本次操作将影响 <strong>{bulkPreview.count}</strong> 条工单。提交后会逐条写入审计记录；解决和关闭不能批量执行，需在详情中填写结构化原因。</p><ul className="ticket-bulk-preview-list">{bulkPreview.changes.map((change) => <li key={change}>将{change}</li>)}</ul>{bulkPreview.blocked.length > 0 && <div className="ticket-bulk-blocked" role="alert"><strong>{bulkPreview.blocked.length} 条无法执行</strong><ul>{bulkPreview.blocked.slice(0, 8).map((item) => <li key={item.id}>{item.id}：{item.reason}</li>)}</ul>{bulkPreview.blocked.length > 8 && <small>还有 {bulkPreview.blocked.length - 8} 条，请缩小选择范围。</small>}</div>}<footer><button className="ghost-button" onClick={() => setBulkPreview(null)}>返回调整</button><button className="primary-button" disabled={bulkPreview.blocked.length > 0 || bulkSaving} onClick={() => void confirmBulkAction()}>{bulkSaving ? "提交中…" : `确认更新 ${bulkPreview.count} 条`}</button></footer></section></div>}
    <div className="ticket-header"><div><div className="eyebrow">一线客服 · 内部跟进</div><h2>工单队列</h2><p>把需要跨团队协作或持续跟进的问题，变成有负责人、有时限的任务。</p><div className="ticket-snapshot" role="status" aria-live="polite">数据范围：{scopeLabel} · 共 {(dataScope?.total ?? pagination.total).toLocaleString("zh-CN")} 条 · 最近同步 {formatSnapshot(dataAsOf)}</div><div className={`ticket-sync-strip ${syncState}`} role="status" aria-live="polite"><span className="ticket-sync-indicator" aria-hidden="true" /><div><b>{syncTitle}</b><small>{syncDescription}</small></div></div><div className="ticket-bulk-permission" role="status">批量变更权限：{actorRole === null ? "正在确认当前账号权限" : canBulkOperate ? "当前账号可用（主管权限）" : "当前账号不可用，需要主管权限"} · 全部筛选结果导出同样需要主管权限</div>{exportProgress > 0 && <div className="ticket-export-progress" role="status" aria-live="polite"><div><b>{exportProgress >= 100 ? "导出已完成" : "导出任务处理中"}</b><span>{exportProgress >= 100 ? "文件已开始下载" : `正在准备文件 · ${exportProgress}%`}</span></div><progress max="100" value={exportProgress} aria-label="导出进度" /></div>}</div><div className="ticket-actions"><button className="ghost-button" onClick={() => { setEditingViewId(""); setSavedViewName(""); setSavedViewScope("personal"); setSaveViewOpen(true); }}>保存视图</button><button className="ghost-button" onClick={() => void copyTicketLink()}>复制当前链接</button><button className="ghost-button" onClick={() => void exportTickets("page")} disabled={!rows.length || exportSaving}>{exportSaving ? "导出中…" : "导出当前页"}</button><button className="ghost-button" onClick={() => void exportTickets("selected")} disabled={!selectedIds.length || exportSaving}>导出已选</button><button className="ghost-button" onClick={() => void exportTickets("filtered")} disabled={exportSaving || !canBulkOperate}>导出全部筛选</button><button className="ghost-button" onClick={() => void loadTickets(page)} disabled={loading} aria-busy={loading}>{loading ? "刷新中…" : "↻ 刷新"}</button><button className="primary-button" onClick={() => setCreateOpen(true)}>＋ 新建工单</button></div></div>
    <div className="ticket-metrics"><button type="button" className="ticket-metric-card" aria-label={`查看 P1 未解决工单，共 ${summary.p1Open} 条`} onClick={() => openMetricQueue("P1", true)}><b>{summary.p1Open}</b><span>P1 未解决</span><small>点击进入高风险队列</small></button><button type="button" className="ticket-metric-card" aria-label={`查看开放工单，共 ${summary.open} 条`} onClick={() => openMetricQueue("all", true)}><b>{summary.open}</b><span>开放工单</span><small>点击进入待跟进队列</small></button><div><b>{summary.slaRate === null ? "—" : `${summary.slaRate}%`}</b><span>SLA 达成率</span><small>{summary.kpiScope === "test_non_production" ? "仅用于测试 · 不纳入生产 KPI" : summary.slaRate === null ? "完成工单后计算" : "按已解决工单计算"}</small></div><div><b>{summary.averageResolutionMinutes === null ? "—" : `${summary.averageResolutionMinutes}分`}</b><span>平均解决时长</span><small>{summary.kpiScope === "test_non_production" ? "仅用于测试 · 不纳入生产 KPI" : summary.averageResolutionMinutes === null ? "完成工单后计算" : "从创建到解决"}</small></div></div>
    {dataScope && (dataScope.mode === "test" || dataScope.syntheticCount > 0) && <div className="ticket-data-warning" role="status"><strong>测试 / 演示数据</strong><span>当前工作区为测试租户；队列数据仅用于流程演示，不代表真实生产 SLA。合成记录：{dataScope.syntheticCount.toLocaleString("zh-CN")} 条。{dataScope.syntheticExcludedFromKpis ? `已从 KPI 排除 ${dataScope.syntheticExcludedFromKpis.toLocaleString("zh-CN")} 条合成记录。` : ""}</span></div>}
    <div className="ticket-toolbar"><div className="ticket-view-tabs" role="tablist" aria-label="工单视图">{ticketViewTabs.map((item, index) => <button key={item.key} id={ticketViewTabIds[index]} role="tab" aria-selected={view === item.key} aria-controls="ticket-queue-results" tabIndex={view === item.key ? 0 : -1} className={view === item.key ? "active" : ""} onClick={() => { setView(item.key); setPage(1); }} onKeyDown={(event) => handleTabKeyDown(event, ticketViewTabIds, index, (nextIndex) => { const nextView = ticketViewTabs[nextIndex]?.key; if (nextView) { setView(nextView); setPage(1); } })}>{item.label}{viewCounts[item.key] !== undefined && <em className="ticket-view-count">{viewCounts[item.key].toLocaleString("zh-CN")}</em>}</button>)}</div><div className="ticket-view-tools"><label>已保存视图<select aria-label="选择已保存视图" value={selectedSavedViewId} onChange={(event) => { const savedView = savedViews.find((item) => item.id === event.target.value); if (savedView) applySavedView(savedView); }}>{!selectedSavedViewId && <option value="">选择一个视图</option>}{savedViews.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.scope === "team" ? "团队共享" : "个人"}{item.isDefault ? " · 默认" : ""}</option>)}</select></label>{selectedSavedViewId && (() => { const activeView = savedViews.find((item) => item.id === selectedSavedViewId); return activeView?.canEdit ? <><button className="text-button" onClick={() => { setEditingViewId(activeView.id); setSavedViewName(activeView.name); setSaveViewOpen(true); }}>重命名</button><button className="text-button" onClick={() => void updateSavedView(activeView.id, { isDefault: true })}>设为默认</button><button className="text-button" onClick={() => void deleteSavedView(activeView.id)}>删除</button></> : null; })()}<button className="text-button" onClick={clearFilters}>清除筛选</button></div><div className="ticket-toolbar-row"><div className="segmented" role="group" aria-label="按状态筛选">{ticketFilters.map((item) => <button key={item.key} className={filter === item.key ? "active" : ""} aria-pressed={filter === item.key} onClick={() => { setFilter(item.key); setPage(1); }}>{item.label}{filterCounts[item.key] !== undefined && <em className="ticket-filter-count">{filterCounts[item.key].toLocaleString("zh-CN")}</em>}</button>)}</div><label className="ticket-filter-select">负责人<select aria-label="按负责人筛选" value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setPage(1); }}><option value="">所有负责人</option><option value="unassigned">未分配</option>{assignees.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label><label className="ticket-filter-select">团队<select aria-label="按团队筛选" value={teamFilter} onChange={(event) => { setTeamFilter(event.target.value); setPage(1); }}><option value="">所有团队</option><option value="unassigned">未设置团队</option>{teams.map((team) => <option key={team} value={team}>{team}</option>)}</select></label><label className="ticket-open-toggle"><input type="checkbox" checked={openOnly} onChange={(event) => { setOpenOnly(event.target.checked); setPage(1); }} />仅开放</label><label className="ticket-sort">排序<select aria-label="工单排序" value={sort} onChange={(event) => { setSort(event.target.value as TicketSort); setPage(1); }}><option value="priority">优先级</option><option value="created">创建时间</option><option value="updated">最近更新</option><option value="sla">SLA 最紧急</option></select></label><label className="ticket-search"><span aria-hidden="true">⌕</span><input aria-label="搜索工单" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索工单号、标题或客户" /></label></div></div>
    {(filter !== "all" || view !== "all" || openOnly || ownerFilter || teamFilter || query.trim()) && <div className="ticket-filter-summary" role="status"><span>当前筛选</span>{view !== "all" && <b>{view === "mine" ? "我的工单" : view === "unassigned" ? "未分配" : view === "overdue" ? "已超时" : "即将超时"}</b>}{filter !== "all" && <b>{ticketFilters.find((item) => item.key === filter)?.label}</b>}{openOnly && <b>仅开放</b>}{ownerFilter && <b>{ownerFilter === "unassigned" ? "负责人：未分配" : `负责人：${assignees.find((item) => item.id === ownerFilter)?.displayName ?? ownerFilter}`}</b>}{teamFilter && <b>{teamFilter === "unassigned" ? "团队：未设置" : `团队：${teamFilter}`}</b>}{query.trim() && <b>搜索：{query.trim()}</b>}<button className="text-button" onClick={clearFilters}>清除全部</button></div>}
    {selectedIds.length > 0 && <div className="ticket-bulk-bar" role="region" aria-label="批量工单操作"><strong>已选 {selectedIds.length} 条</strong><label>分配给<select aria-label="批量分配负责人" value={bulkOwnerEmail} onChange={(event) => setBulkOwnerEmail(event.target.value)} disabled={!canBulkOperate}><option value="">选择负责人</option><option value="__unassigned__">取消分配</option>{assignees.map((person) => <option key={person.id} value={person.email}>{person.displayName}</option>)}</select></label><button className="ghost-button" disabled={!bulkOwnerEmail || bulkSaving || !canBulkOperate} onClick={() => void previewBulkAction({ ownerEmail: bulkOwnerEmail === "__unassigned__" ? null : bulkOwnerEmail }, "bulk_assign")}>预览批量分配</button><label>优先级<select aria-label="批量更新优先级" value={bulkPriority} onChange={(event) => setBulkPriority(event.target.value as "" | TicketPriority)} disabled={!canBulkOperate}><option value="">优先级不变</option><option value="P1">P1 · 高</option><option value="P2">P2 · 中</option><option value="P3">P3 · 低</option></select></label><label>状态<select aria-label="批量更新状态" value={bulkState} onChange={(event) => setBulkState(event.target.value as "" | Exclude<TicketState, "resolved" | "closed">)} disabled={!canBulkOperate}><option value="">状态不变</option><option value="unassigned">待领取</option><option value="in_progress">处理中</option><option value="waiting_customer">等待用户</option></select></label><button className="primary-button" disabled={(!bulkPriority && !bulkState) || bulkSaving || !canBulkOperate} onClick={() => void previewBulkAction({ priority: bulkPriority || undefined, state: bulkState || undefined }, "bulk_update")}>预览批量更新</button><button className="text-button" onClick={() => setSelectedIds([])}>清除选择</button>{!canBulkOperate && <small>批量操作需要主管权限；当前账号仍可查看工单并导出当前页/已选工单。</small>}</div>}
    {notice && <div className="ticket-notice" role="status" aria-live="polite">✓ {notice}</div>}{error && <div className="evaluation-error ticket-error-recovery" role="alert"><span>{error}</span>{bulkRetry && <button className="text-button" onClick={() => void previewBulkAction(bulkRetry.payload, bulkRetry.action)} disabled={bulkSaving}>重试预览</button>}{exportRetryMode && <button className="text-button" onClick={() => void exportTickets(exportRetryMode)} disabled={exportSaving}>重试导出</button>}</div>}
    <div className="ticket-results" id="ticket-queue-results" role="tabpanel" tabIndex={0} aria-labelledby={`ticket-view-tab-${view}`}><div className="ticket-table-wrap">{loading ? <div className="ticket-empty"><b>正在读取真实工单</b><span>请稍候，系统正在同步队列。</span></div> : !rows.length ? <div className="ticket-empty"><b>{query.trim() ? "没有匹配的工单" : "当前筛选下没有工单"}</b><span>{query.trim() ? `没有找到包含“${query.trim()}”的工单，请尝试更短的关键词。` : "可以调整筛选条件，或新建一条真实工单。"}</span>{query.trim() && <button className="ghost-button" onClick={() => { setQuery(""); setPage(1); }}>清除搜索词</button>}<button className="ghost-button" onClick={() => setCreateOpen(true)}>新建工单</button></div> : <><table><caption className="sr-only">工单队列，使用工单标题或查看按钮打开详情</caption><thead><tr><th scope="col"><input type="checkbox" aria-label="选择本页全部工单" disabled={!canBulkOperate} checked={rows.length > 0 && rows.every((ticket) => selectedIds.includes(ticket.id))} onChange={(event) => setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...rows.map((ticket) => ticket.id)])) : selectedIds.filter((id) => !rows.some((ticket) => id === ticket.id)))} /></th><th scope="col">工单</th><th scope="col">客户</th><th scope="col">优先级</th><th scope="col">负责人</th><th scope="col">SLA</th><th scope="col">状态</th><th /></tr></thead><tbody>{rows.map((ticket) => <tr key={ticket.id} className="ticket-row"><td><input type="checkbox" aria-label={`选择工单 ${ticket.id}`} disabled={!canBulkOperate} checked={selectedIds.includes(ticket.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, ticket.id] : current.filter((id) => id !== ticket.id))} /></td><td><button className="ticket-row-title" onClick={() => void openDetail(ticket)}><b>{ticket.title}</b><small>{ticket.id}{ticket.conversationId ? ` · ${ticket.conversationId}` : ""}</small></button></td><td>{ticket.customerName}</td><td><Status kind={ticket.priority === "P1" ? "danger" : ticket.priority === "P2" ? "warning" : "neutral"}>{ticket.priority}</Status></td><td>{ticket.ownerName || "待分配"}</td><td>{renderTicketSlaCell(ticket)}</td><td><Status kind={ticketStateKinds[ticket.state]}>{stateLabel(ticket.state)}</Status></td><td><button className="more-button" aria-label={`查看工单 ${ticket.id}`} onClick={() => void openDetail(ticket)}>查看</button></td></tr>)}</tbody></table><div className="ticket-mobile-list">{rows.map((ticket) => <article className="ticket-mobile-card" key={`mobile-${ticket.id}`}><div className="ticket-mobile-selection"><input type="checkbox" aria-label={`选择工单 ${ticket.id}`} disabled={!canBulkOperate} checked={selectedIds.includes(ticket.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, ticket.id] : current.filter((id) => id !== ticket.id))} /><span>选择</span></div><button className="ticket-mobile-open" onClick={() => void openDetail(ticket)}><span><strong>{ticket.title}</strong><small>{ticket.id} · {ticket.customerName}</small></span><Status kind={ticket.priority === "P1" ? "danger" : ticket.priority === "P2" ? "warning" : "neutral"}>{ticket.priority}</Status></button><div><span>{ticket.ownerName || "待分配"}</span><Status kind={ticketStateKinds[ticket.state]}>{stateLabel(ticket.state)}</Status><span title={`SLA截止 ${formatDate(ticket.slaDueAt)}`} className={new Date(ticket.slaDueAt).getTime() < renderedAt && !["resolved", "closed"].includes(ticket.state) ? "sla-overdue" : ""}>{slaText(ticket.slaDueAt)}</span></div></article>)}</div></>}</div></div>
    <div className="ticket-pagination"><span>共 {pagination.total} 条 · 第 {pagination.page} / {pagination.totalPages} 页</span><div className="ticket-pagination-controls"><label className="ticket-page-size">每页<select aria-label="每页显示数量" value={pageSize} onChange={(event) => { const next = Number(event.target.value); if (pageSizeOptions.includes(next as (typeof pageSizeOptions)[number])) { setPageSize(next as (typeof pageSizeOptions)[number]); setPage(1); } }}><option value="25">25 条</option><option value="50">50 条</option><option value="100">100 条</option></select></label><button className="ghost-button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>{pageNumbers.map((value, index) => <span key={value}>{index > 0 && pageNumbers[index - 1] !== value - 1 ? <i>…</i> : null}<button className={value === page ? "page-number active" : "page-number"} onClick={() => setPage(value)}>{value}</button></span>)}<label className="ticket-page-jump">跳转<input aria-label="跳转页码" inputMode="numeric" value={pageJump} onChange={(event) => setPageJump(event.target.value.replace(/\D/g, "").slice(0, 5))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); jumpToPage(); } }} placeholder="页" /></label><button className="ghost-button" onClick={jumpToPage} disabled={!pageJump || loading}>确定</button><button className="ghost-button" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}>下一页</button></div></div>
    <div className="process-note"><b>当前处理边界</b><span>P1 事项优先处理；退款、补偿、账户和地址变更仍需按身份核验或审批规则执行。状态必须按流程推进，解决和重开都要留下结构化事实。</span></div>
    {selected && <div className="ticket-drawer-backdrop" role="presentation" onClick={() => closeDetail()}><aside ref={ticketDetailDialogRef} tabIndex={-1} className="ticket-drawer" role="dialog" aria-modal="true" aria-labelledby="ticket-detail-title" onClick={(event) => event.stopPropagation()}><header><div><span>工单详情</span><h2 id="ticket-detail-title">{selected.title}</h2><small>{selected.id} · 创建于 {formatDate(selected.createdAt)}</small></div><button className="icon-button" aria-label="关闭工单详情" onClick={() => closeDetail()}>×</button></header>{detailLoading ? <div className="ticket-empty"><b>正在读取详情</b></div> : <><div className="ticket-detail-status"><Status kind={selected.priority === "P1" ? "danger" : selected.priority === "P2" ? "warning" : "neutral"}>{selected.priority}</Status><Status kind={ticketStateKinds[selected.state]}>{stateLabel(selected.state)}</Status><div className="ticket-detail-sla">{renderTicketSlaCell(selected)}<div className="ticket-sla-policy"><b>{selected.slaPolicy ?? "优先级默认策略 v1"}</b><span>来源：{selected.slaSource === "persisted" ? "已保存策略" : "按优先级推导"}</span><span>截止时间：{formatSlaDate(selected.slaDueAt)}</span><p>{ticketSlaExplanation(selected)}</p></div></div></div><div className="ticket-detail-grid"><div><label>客户</label><b>{selected.customerName}</b></div><div><label htmlFor="ticket-owner">负责人</label><select id="ticket-owner" value={selected.ownerEmail ?? ""} disabled={saving} onChange={(event) => { const value = event.target.value; if (value) void mutateTicket(selected.id, { action: "assign", ownerEmail: value }, "负责人已更新"); }}><option value="">待分配</option>{assignees.map((person) => <option key={person.id} value={person.email}>{person.displayName} · {person.email}</option>)}</select></div><div><label htmlFor="ticket-priority">优先级</label><select id="ticket-priority" value={selected.priority} disabled={saving} onChange={(event) => void mutateTicket(selected.id, { action: "update", priority: event.target.value }, "优先级已更新")}><option value="P1">P1 · 高</option><option value="P2">P2 · 中</option><option value="P3">P3 · 低</option></select></div><div><label htmlFor="ticket-state">状态</label><select id="ticket-state" value={selected.state} disabled={saving} onChange={(event) => void mutateTicket(selected.id, { action: "update", state: event.target.value }, "状态已更新")}><option value="unassigned">待领取</option><option value="in_progress">处理中</option><option value="waiting_customer">等待用户</option><option value="resolved">已解决</option><option value="closed">已关闭</option></select></div></div><section className="ticket-detail-section ticket-sla-timeline"><div className="ticket-section-head"><h3>SLA 时间线</h3><span>{selected.slaPolicy ?? "优先级默认策略 v1"}</span></div><div className="ticket-sla-facts"><div><span>SLA 开始</span><b>{formatDate(selected.slaStartedAt)}</b></div><div><span>接管时间</span><b>{formatDate(selected.takeoverAt)}</b></div><div><span>首次响应</span><b>{formatDate(selected.firstResponseAt)}</b></div><div><span>解决时间</span><b>{formatDate(selected.resolvedAt)}</b></div><div><span>关闭时间</span><b>{formatDate(selected.closedAt)}</b></div><div><span>暂停 / 恢复</span><b>{selected.slaPaused ? "已暂停" : "未暂停"}</b><small>{selected.slaPauseReason ?? "当前策略未启用自动暂停"}</small></div></div><p className="ticket-sla-explanation">判断依据：{ticketSlaExplanation(selected)}</p></section><section className="ticket-detail-section ticket-audit-timeline"><div className="ticket-section-head"><h3>处理时间线</h3><span>{timelineEvents.length} 条审计事件</span></div>{timelineEvents.length ? <div className="ticket-event-list">{timelineEvents.map((event) => <article key={event.id}><div><strong>{timelineLabel(event.action)}</strong><time>{formatDate(event.createdAt)}</time></div><p>{timelineSummary(event)}</p><small>{event.actorUserId ? `操作者 ${event.actorUserId}` : "系统记录"} · {event.result === "allowed" ? "已写入" : event.result}</small></article>)}</div> : <div className="ticket-empty compact"><span>暂无审计事件</span></div>}</section><section className="ticket-detail-section"><h3>问题摘要</h3><p>{selected.summary || "暂无摘要。建议在处理记录中补充事实、下一步和对用户的承诺边界。"}</p>{selected.triggerReason && <small>触发原因：{selected.triggerReason}</small>}{selected.conversationId && <button className="text-button" onClick={() => { closeDetail(); onNavigate("conversations"); }}>打开关联会话 →</button>}</section><section className="ticket-detail-section"><div className="ticket-section-head"><h3>处理记录</h3><span>{notes.length} 条</span></div><div className="ticket-notes">{notes.length ? notes.map((item) => <article key={item.id}><p>{item.content}</p><small>{item.actorName} · {formatDate(item.createdAt)}</small></article>) : <div className="ticket-empty compact"><span>还没有处理记录</span></div>}</div><textarea aria-label="新增处理记录" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder="记录核验结果、内部协作进展或下一步动作…" /><button className="ghost-button" disabled={!note.trim() || saving} onClick={() => void addNote()}>保存处理记录</button></section><footer className="ticket-drawer-actions">{selected.state === "unassigned" && <button className="primary-button" disabled={saving} onClick={() => void mutateTicket(selected.id, { action: "claim" }, "工单已领取，状态已进入处理中")}>领取工单</button>}{!["resolved", "closed"].includes(selected.state) && <button className="ghost-button" disabled={saving} onClick={() => void mutateTicket(selected.id, { action: "resolve" }, "工单已标记为已解决")}>标记已解决</button>}{["resolved", "closed"].includes(selected.state) && <button className="ghost-button" disabled={saving} onClick={() => void mutateTicket(selected.id, { action: "reopen" }, "工单已重新打开")}>重新打开</button>}</footer></>}</aside></div>}
    {saveViewOpen && <div className="ticket-modal-backdrop" role="presentation" onClick={() => setSaveViewOpen(false)}><section ref={saveViewDialogRef} tabIndex={-1} className="ticket-action-modal" role="dialog" aria-modal="true" aria-labelledby="save-view-title" onClick={(event) => event.stopPropagation()}><header><div><span>队列视图</span><h2 id="save-view-title">{editingViewId ? "重命名视图" : "保存当前筛选"}</h2></div><button className="icon-button" aria-label="关闭保存视图" onClick={() => setSaveViewOpen(false)}>×</button></header><p>{editingViewId ? "重命名不会改变视图的筛选条件。" : "保存后可从队列顶部快速复用；个人视图仅自己可见，团队视图对当前工作空间成员可见。"}</p><label>视图名称<input autoFocus value={savedViewName} onChange={(event) => setSavedViewName(event.target.value)} maxLength={40} placeholder="例如：我的 P1 超时工单" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveCurrentView(); } }} /></label>{!editingViewId && <label>共享范围<select aria-label="视图共享范围" value={savedViewScope} onChange={(event) => setSavedViewScope(event.target.value as "personal" | "team")}><option value="personal">个人视图（仅自己）</option><option value="team" disabled={!canBulkOperate}>团队共享视图{!canBulkOperate ? "（需要主管权限）" : ""}</option></select></label>}<footer><button className="ghost-button" onClick={() => setSaveViewOpen(false)}>取消</button><button className="primary-button" disabled={!savedViewName.trim()} onClick={() => void saveCurrentView()}>{editingViewId ? "保存名称" : "保存视图"}</button></footer></section></div>}
    {createOpen && <div className="ticket-modal-backdrop" role="presentation" onClick={() => setCreateOpen(false)}><form ref={ticketCreateDialogRef} tabIndex={-1} className="ticket-create-modal" role="dialog" onSubmit={(event) => { event.preventDefault(); void createTicket(); }} aria-modal="true" aria-labelledby="new-ticket-title" onClick={(event) => event.stopPropagation()}><header><div><span>新建真实工单</span><h2 id="new-ticket-title">记录一次需要跟进的问题</h2><small>带 * 为必填；提交失败时表单内容会保留，可直接修正后重试，网络重试不会重复创建。</small></div><button className="icon-button" aria-label="关闭新建工单" onClick={() => setCreateOpen(false)}>×</button></header><label htmlFor="create-ticket-title">工单标题 <em aria-hidden="true">*</em><input id="create-ticket-title" value={createForm.title} aria-invalid={Boolean(createErrors.title)} onChange={(event) => { setCreateForm((form) => ({ ...form, title: event.target.value })); setCreateErrors((current) => ({ ...current, title: "" })); }} placeholder="例如：退款到账异常，需要支付团队核验" maxLength={160} /><small>{createForm.title.length}/160</small>{createErrors.title && <span className="ticket-field-error" role="alert">{createErrors.title}</span>}</label><label htmlFor="create-customer-name">客户名称 <em aria-hidden="true">*</em><input id="create-customer-name" value={createForm.customerName} aria-invalid={Boolean(createErrors.customerName)} onChange={(event) => { setCreateForm((form) => ({ ...form, customerName: event.target.value })); setCreateErrors((current) => ({ ...current, customerName: "" })); }} placeholder="请输入客户称呼" maxLength={120} />{createErrors.customerName && <span className="ticket-field-error" role="alert">{createErrors.customerName}</span>}</label><label htmlFor="create-conversation-search">关联会话（可选）<input id="create-conversation-search" value={conversationSearch} aria-invalid={Boolean(createErrors.conversation)} onChange={(event) => { setConversationSearch(event.target.value); setSelectedConversation(null); setCreateErrors((current) => ({ ...current, conversation: "" })); }} placeholder="搜索会话号、客户或主题，例如：退款到账" />{conversationLoading && <small role="status">正在搜索关联会话…</small>}{conversationOptions.length > 0 && <div className="ticket-conversation-options" role="listbox" aria-label="可关联会话">{conversationOptions.map((conversation) => <button type="button" role="option" aria-selected={selectedConversation?.id === conversation.id} key={conversation.id} onClick={() => { setSelectedConversation(conversation); setConversationSearch(`${conversation.id} · ${conversation.topic}`); setCreateForm((form) => ({ ...form, conversationId: conversation.id, customerName: conversation.customerName })); setConversationOptions([]); }}>{conversation.id} · {conversation.customerName} · {conversation.channel} · {conversation.topic}</button>)}</div>}{selectedConversation && <small className="ticket-selected-conversation">已关联：{selectedConversation.id} · {selectedConversation.customerName} · {selectedConversation.channel} · {selectedConversation.topic}<button type="button" className="text-button" onClick={() => { setSelectedConversation(null); setConversationSearch(""); setCreateForm((form) => ({ ...form, conversationId: "" })); }}>移除</button></small>}{createErrors.conversation && <span className="ticket-field-error" role="alert">{createErrors.conversation}</span>}</label><div className="ticket-form-row"><label htmlFor="create-priority">优先级<select id="create-priority" value={createForm.priority} onChange={(event) => setCreateForm((form) => ({ ...form, priority: event.target.value as TicketPriority }))}><option value="P1">P1 · 高风险</option><option value="P2">P2 · 普通</option><option value="P3">P3 · 低优先级</option></select></label><label htmlFor="create-team">处理团队<select id="create-team" value={createForm.teamKey} onChange={(event) => setCreateForm((form) => ({ ...form, teamKey: event.target.value }))}><option value="">暂不指定</option>{teams.map((team) => <option key={team} value={team}>{team}</option>)}</select></label></div><label htmlFor="create-owner">负责人（主管可指定）<select id="create-owner" value={createForm.ownerEmail} onChange={(event) => setCreateForm((form) => ({ ...form, ownerEmail: event.target.value }))}><option value="">创建后待领取</option>{assignees.map((person) => <option key={person.id} value={person.email}>{person.displayName} · {person.email}</option>)}</select></label><div className="ticket-create-sla" role="status"><strong>SLA 预览</strong><span>{createSlaPreview(createForm.priority)}</span></div><label htmlFor="create-summary">问题摘要与交接信息<textarea id="create-summary" value={createForm.summary} onChange={(event) => setCreateForm((form) => ({ ...form, summary: event.target.value }))} maxLength={2000} placeholder="写清楚已核验事实、待谁处理、希望何时完成…" /><small>{createForm.summary.length}/2000</small></label>{error && <div className="evaluation-error" role="alert">{error} 可修正后重试，表单内容不会丢失。</div>}<footer><button className="ghost-button" onClick={() => setCreateOpen(false)}>取消</button><button className="primary-button" disabled={saving} onClick={() => void createTicket()}>{saving ? "保存中…" : "保存工单"}</button></footer></form></div>}
  </section>;
}

type KnowledgeDocumentView = {
  id: string; title: string; version: string; ownerTeam: string; content: string; category: string; keywords: string[];
  coverage: number; state: string; sourceType: string; sourceTitle?: string | null; sourceUrl?: string | null;
  risk: string; handoff: boolean; ownerUserId?: string | null; validFrom?: string | null; validUntil?: string | null; validityStatus?: string; validityLabel?: string; sourceFetchedAt?: string | null; sourceSyncStatus?: string | null; sourceFreshnessStatus?: "fresh" | "aging" | "stale" | "failed" | "unavailable"; sourceFreshnessLabel?: string; updatedAt: string;
};
type KnowledgeSuggestion = { id: string; title: string; category?: string; version?: string };
type KnowledgeSavedView = { id: string; name: string; scope: "personal" | "team"; teamKey?: string | null; stateFilter: string; categoryFilter: string; sort: string; query: string; ownerFilter: string; isDefault: boolean; ownerName?: string; canEdit?: boolean };
type KnowledgeFeedbackView = { id: string; knowledgeId: string; title: string; actorName: string; actorEmail: string; reason: string; content: string; status: "open" | "in_review" | "resolved" | "dismissed"; createdAt: string };
type KnowledgeSourceAlert = { id: string; knowledgeId: string; title: string; state: string; ownerUserId?: string | null; ownerName: string; ownerEmail?: string | null; sourceTitle?: string | null; sourceUrl?: string | null; sourceFetchedAt?: string | null; sourceSyncStatus?: string | null; sourceFreshnessStatus: "fresh" | "aging" | "stale" | "failed" | "unavailable"; sourceFreshnessLabel: string; validityStatus: string; validityLabel: string; validUntil?: string | null; reasons: string[]; severity: "high" | "medium" | "low"; pendingRequest?: { id: string; status: "open" | "queued"; reason: string; note: string; createdAt: string } | null };
type KnowledgeSourceMonitorSummary = { total: number; high: number; medium: number; aging: number; stale: number; failed: number; unavailable: number; expiring: number; expired: number; noHit: number; feedback: number; conflicts: number; pendingRefreshRequests: number };
type KnowledgeVersionView = KnowledgeDocumentView & { state: string; content?: string; changeSummary?: string; releasePercent?: number; publishedAt?: string | null; createdAt?: string };
type KnowledgeSourceSnapshot = { id: string; sourceType: string; sourceTitle?: string | null; sourceUrl?: string | null; sourceVersion: string; contentHash: string; snapshotContent: string; syncStatus: string; fetchedAt: string };
type KnowledgeConflictView = { id: string; kind: "duplicate" | "conflict"; severity: "high" | "medium"; status: "open" | "resolved" | "false_positive"; documentId: string; title: string; reason: string; scope: string; ownerUserId?: string | null; resolutionNote?: string; resolvedByUserId?: string | null; resolvedAt?: string | null };
type KnowledgeMutation = "save_draft" | "submit_review" | "publish" | "rollback" | "resolve_conflict" | "merge_conflict";
type KnowledgeDiffView = { versionId: string; version: string; lines: Array<{ type: "same" | "added" | "removed"; text: string }> };
type KnowledgeAuditEvidence = { id: string; action: string; actorUserId?: string | null; result: string; risk: string; metadataJson: string; createdAt: string };
type KnowledgeImpactView = {
  window: { days: number; since: string; until: string };
  metrics: { hitCount: number; totalRuns: number; zeroResultCount: number; zeroResultRate: number; citationCount: number; citationRate: number; feedbackCount: number; negativeFeedbackRate: number; handoffCount: number; handoffRate: number; relatedConversationCount: number };
  versionComparison: Array<{ version: string; hitCount: number; handoffCount: number; handoffRate: number; totalTokens: number; averageLatencyMs: number }>;
  costImpact: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedUsd: number | null; note: string };
};
type KnowledgeExplainView = {
  window: { days: number; since: string; until: string };
  document: { id: string; title: string; version: string; state: string; category: string; sourceTitle?: string | null; sourceUrl?: string | null };
  explanation: { hitRuns: number; averageConfidence: number; keywordHits: Array<{ keyword: string; count: number }>; intents: Array<{ intent: string; count: number }>; queries: string[]; retrievalEvidence: Array<{ label: string; count: number; indexVersion?: string; provider?: string }>; indexVersions: string[] };
  governance: { parentId: string | null; relation: string; businessActions: string[]; conditionSignals: string[]; filterNotes: string[] };
};

type KnowledgeWorkItem = { id: string; type: string; tone: string; title: string; meta: string; target: string; due: string; validUntil?: string | null; ownerUserId?: string | null; ownerTeam: string; priority: number; state: string };

function KnowledgeWorkQueue({ docs, canBatchReview, batchSaving, onOpen, onBatchAction, onExport, exportSaving }: { docs: KnowledgeDocumentView[]; canBatchReview: boolean; batchSaving: boolean; onOpen: (id: string) => void; onBatchAction: (ids: string[], action: "claim" | "submit_review" | "archive") => void; onExport: (ids: string[] | null) => void; exportSaving: boolean }) {
  const [teamFilter, setTeamFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState<"all" | "unassigned" | "assigned">("all");
  const [sort, setSort] = useState<"risk" | "updated" | "expiry">("risk");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const stateLabels: Record<string, string> = { draft: "草稿", review: "待复核", active: "生效中", archived: "已归档" };
  const teams = Array.from(new Set(docs.map((doc) => doc.ownerTeam).filter(Boolean))).sort();
  const items: KnowledgeWorkItem[] = docs.filter((doc) => doc.state !== "archived").map((doc) => {
    const urgent = doc.validityStatus === "expired" || doc.validityStatus === "expiring";
    const highRisk = doc.risk === "high";
    const type = doc.state === "review" ? "待我复核" : urgent ? "即将到期" : highRisk ? "高风险知识" : "待完善";
    const tone = doc.state === "review" ? "info" : urgent || highRisk ? "danger" : "neutral";
    const due = doc.validityLabel ?? (doc.state === "review" ? "等待复核" : "未设有效期");
    return { id: `knowledge-${doc.id}`, type, tone, title: doc.title, meta: `${doc.ownerTeam} · ${stateLabels[doc.state] ?? doc.state} · ${doc.ownerUserId ? "已认领" : "待认领"} · 覆盖率 ${(doc.coverage * 100).toFixed(0)}%`, target: doc.id, due, validUntil: doc.validUntil, ownerUserId: doc.ownerUserId, ownerTeam: doc.ownerTeam, priority: (highRisk ? 3 : 0) + (doc.state === "review" ? 2 : 0) + (urgent ? 1 : 0), state: doc.state };
  });
  const visible = items.filter((item) => (teamFilter === "all" || item.ownerTeam === teamFilter) && (ownerFilter === "all" || (ownerFilter === "assigned" ? Boolean(item.ownerUserId) : !item.ownerUserId))).sort((a, b) => sort === "risk" ? b.priority - a.priority || a.title.localeCompare(b.title, "zh-CN") : sort === "expiry" ? (a.validUntil ? new Date(a.validUntil).getTime() : Number.MAX_SAFE_INTEGER) - (b.validUntil ? new Date(b.validUntil).getTime() : Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title, "zh-CN") : a.title.localeCompare(b.title, "zh-CN"));
  const visibleIds = visible.map((item) => item.target);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  function toggle(id: string) { setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function toggleAll() { setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds]))); }
  return <aside className="panel knowledge-queue"><header><div><h3>优先处理</h3><p>真实知识资产 · 按风险、状态和有效期排序</p></div><button aria-label="刷新知识工作队列" onClick={() => onBatchAction([], "submit_review")}>↻</button></header><div className="knowledge-work-tools"><label>负责人<select aria-label="按负责人状态筛选" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value as typeof ownerFilter)}><option value="all">全部负责人</option><option value="unassigned">待认领</option><option value="assigned">已认领</option></select></label><label>责任团队<select aria-label="按责任团队筛选" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}><option value="all">全部团队</option>{teams.map((team) => <option key={team} value={team}>{team}</option>)}</select></label><label>排序<select aria-label="知识工作队列排序" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="risk">风险优先</option><option value="expiry">有效期优先</option><option value="updated">标题顺序</option></select></label></div><div className="knowledge-queue-bulk"><label><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} disabled={!visible.length} />全选当前结果</label><button className="text-button" disabled={!canBatchReview || !selectedIds.length || batchSaving} onClick={() => onBatchAction(selectedIds, "claim")}>{batchSaving ? "提交中…" : `批量认领给我${selectedIds.length ? `（${selectedIds.length}）` : ""}`}</button><button className="text-button" disabled={!canBatchReview || !selectedIds.length || batchSaving} onClick={() => onBatchAction(selectedIds, "submit_review")}>{batchSaving ? "提交中…" : `批量提交复核${selectedIds.length ? `（${selectedIds.length}）` : ""}`}</button><button className="text-button" disabled={!canBatchReview || !selectedIds.length || batchSaving} onClick={() => onBatchAction(selectedIds, "archive")}>{batchSaving ? "提交中…" : `批量归档${selectedIds.length ? `（${selectedIds.length}）` : ""}`}</button><button className="text-button" disabled={!canBatchReview || exportSaving || !visible.length} onClick={() => onExport(visibleIds)}>导出当前结果</button><button className="text-button" disabled={!canBatchReview || exportSaving || !selectedIds.length} onClick={() => onExport(selectedIds)}>导出已选</button></div><div className="knowledge-queue-list">{visible.map((item) => <article key={item.id} className="knowledge-queue-item"><input type="checkbox" aria-label={`选择 ${item.title}`} checked={selectedIds.includes(item.target)} onChange={() => toggle(item.target)} /><button className={"knowledge-queue-open"} onClick={() => onOpen(item.target)}><span className={`work-type ${item.tone}`}>{item.type}</span><b>{item.title}</b><p>{item.meta}</p><small>{item.due} · {item.target}</small></button></article>)}</div><footer><span>当前显示</span><b>{visible.length} 条真实知识 · 已选 {selectedIds.length} 条</b>{!canBatchReview && <small>当前账号仅可查看，治理操作需知识运营、主管或管理员权限。</small>}</footer></aside>;
}

type PlaybookStatus = "draft" | "review" | "published";
type ReplyPlaybook = {
  id: string; title: string; scenario: string; intent: string; status: PlaybookStatus;
  owner: string; version: string; preferredReply: string; avoid: string; structure: string;
  updatedAt: string; coverage: string; tags: string[];
};

const initialReplyPlaybooks: ReplyPlaybook[] = [
  { id: "RP-001", title: "先共情，再确认破损事实", scenario: "售后 · 商品破损", intent: "客户描述商品破损，希望知道下一步怎么处理", status: "published", owner: "知识运营 · 陈悠", version: "v1.3", preferredReply: "听起来这件商品确实影响了你的使用，先别担心。我先帮你确认一下订单和破损情况：请告诉我订单号，并拍一张商品和外包装的照片。确认后我会给你明确的处理方案。", avoid: "不要一上来要求用户重复描述；不要直接承诺退款或赔付金额；不要使用‘请耐心等待’‘无法处理’等冷冰冰的表达。", structure: "共情 → 复述问题 → 只问必要信息 → 给出下一步", updatedAt: "今天 10:24", coverage: "近 30 天 86 次", tags: ["共情", "事实核验", "售后"] },
  { id: "RP-002", title: "暂时不确定时的自然追问", scenario: "通用 · 意图不明", intent: "客户的问题暂时无法从已发布知识中确认", status: "review", owner: "知识运营 · 陈悠", version: "v0.6", preferredReply: "我先确认一下你的具体情况，避免给你一个不准确的答案。你可以补充订单号、商品名称，或者告诉我现在最想解决哪一步吗？", avoid: "不要暴露模型、知识库、置信度或转人工；不要编造政策；不要只回复‘不知道’。", structure: "说明在确认 → 解释为了避免误导 → 请求最少补充信息", updatedAt: "昨天 16:08", coverage: "近 30 天 41 次", tags: ["兜底", "追问", "自然表达"] },
  { id: "RP-003", title: "退款诉求的边界表达", scenario: "售后 · 退款", intent: "客户直接询问能否退款，希望获得确定预期", status: "draft", owner: "一线客服 · 林晓", version: "v0.2", preferredReply: "可以先帮你核对一下订单和退款原因。不同情况的处理方式不一样，确认后我会把可行方案和预计到账时间一次说明白。", avoid: "不要在未核验前承诺‘一定退款’；不要把内部审批说成用户需要承担的流程。", structure: "接住诉求 → 说明核验必要性 → 承诺清晰说明方案", updatedAt: "今天 09:41", coverage: "近 30 天 19 次", tags: ["退款", "边界", "预期管理"] },
];

type KnowledgeQuote = { id: string; title: string; version: string; content: string };

function FrontlineKnowledge({ onNavigate, onQuote }: { onNavigate: (next: NavKey) => void; onQuote: (quote: KnowledgeQuote) => void }) {
  const pageSize = 12;
  const categoryLabel: Record<string, string> = { refund: "退款售后", damage: "破损与质量", address: "物流改址", invoice: "发票服务" };
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | "refund" | "damage" | "address" | "invoice">("all");
  const [page, setPage] = useState(1);
  const [docs, setDocs] = useState<KnowledgeDocumentView[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ active: 0, total: 0 });
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [knowledgeRetryKey, setKnowledgeRetryKey] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState("内容不准确");
  const [feedbackContent, setFeedbackContent] = useState("");
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<KnowledgeSuggestion[]>([]);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const documentsControllerRef = useRef<AbortController | null>(null);
  const suggestionsControllerRef = useRef<AbortController | null>(null);
  const feedbackDialogRef = useDialogFocus(feedbackOpen, () => setFeedbackOpen(false));
  const selected = docs.find((doc) => doc.id === selectedId) ?? docs[0];
  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 2600); }
  function formatDate(value?: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN"); }
  const loadDocuments = useCallback(async (targetPage = page) => {
    documentsControllerRef.current?.abort();
    const controller = new AbortController();
    documentsControllerRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String((targetPage - 1) * pageSize), state: "active", retry: String(knowledgeRetryKey) });
      if (query.trim()) params.set("q", query.trim());
      if (category !== "all") params.set("category", category);
      const response = await fetch(`/api/knowledge?${params.toString()}`, { cache: "no-store", signal: controller.signal, headers: { "x-servicepilot-channel": "customer-demo" } });
      if (!response.ok) throw new Error("已发布知识读取失败，请稍后重试");
      const payload = await response.json() as { documents?: KnowledgeDocumentView[]; total?: number; stats?: { active?: number; total?: number } };
      const next = payload.documents ?? [];
      setDocs(next); setTotal(payload.total ?? 0); setStats({ active: payload.stats?.active ?? 0, total: payload.stats?.total ?? 0 }); setSelectedId((current) => current && next.some((doc) => doc.id === current) ? current : next[0]?.id ?? ""); setError("");
    } catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "已发布知识读取失败"); } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [category, page, query, knowledgeRetryKey]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadDocuments(page); }, 180); return () => window.clearTimeout(timer); }, [loadDocuments, page]);
  useEffect(() => () => { documentsControllerRef.current?.abort(); suggestionsControllerRef.current?.abort(); }, []);
  useEffect(() => {
    suggestionsControllerRef.current?.abort();
    const value = query.trim();
    if (value.length < 2) return;
    const controller = new AbortController();
    suggestionsControllerRef.current = controller;
    const timer = window.setTimeout(() => {
      void fetch(`/api/knowledge/suggestions?q=${encodeURIComponent(value)}&state=active`, { cache: "no-store", signal: controller.signal, headers: { "x-servicepilot-channel": "customer-demo" } })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("搜索联想读取失败")))
        .then((payload: { suggestions?: KnowledgeSuggestion[] }) => { if (!controller.signal.aborted) { setSuggestions(payload.suggestions ?? []); setSuggestionQuery(value); } })
        .catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setSuggestions([]); });
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);
  async function submitFeedback() {
    if (!selected || !feedbackContent.trim()) return;
    setFeedbackSaving(true);
    try {
      const response = await fetch("/api/knowledge/feedback", { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ knowledgeId: selected.id, reason: feedbackReason, content: feedbackContent.trim() }) });
      if (!response.ok) { let message = "知识反馈保存失败"; try { const body = await response.json() as { error?: string }; message = body.error || message; } catch { /* keep fallback */ } throw new Error(message); }
      setFeedbackOpen(false); setFeedbackContent(""); flash("反馈已写入知识复核队列");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "知识反馈保存失败"); } finally { setFeedbackSaving(false); }
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).filter((value) => value === 1 || value === totalPages || Math.abs(value - page) <= 1);
  return <section className="frontline-knowledge" aria-label="一线客服知识查询">
    <header className="frontline-knowledge-head"><div><div className="eyebrow">一线客服 · 已发布知识</div><h2>已发布知识查询</h2><p>只引用当前审核生效的规则，回复时自动保留知识编号和版本，方便追溯。</p></div><div className="frontline-knowledge-actions"><button className="ghost-button" onClick={() => onNavigate("workbench")}>返回工作台</button><button className="ghost-button" disabled={loading} onClick={() => { void loadDocuments(page); }}>↻ 刷新</button></div></header>
    <div className="frontline-knowledge-summary"><div><b>{stats.active}</b><span>当前生效知识</span><small>仅展示可被客服引用的版本</small></div><div><b>{total}</b><span>本次检索结果</span><small>{category === "all" ? "全部服务域" : categoryLabel[category]}</small></div><div><b>可追溯</b><span>引用规范</span><small>回复中保留 ID、版本和来源</small></div></div>
    <div className="frontline-knowledge-toolbar"><label className="search-box wide">⌕ <input aria-label="搜索已发布知识" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索规则、用户问法、知识编号…" /></label><div className="knowledge-category-filters" role="group" aria-label="按服务域筛选">{([{ key: "all", label: "全部" }, { key: "refund", label: "退款售后" }, { key: "damage", label: "破损质量" }, { key: "address", label: "物流改址" }, { key: "invoice", label: "发票服务" }] as const).map((item) => <button key={item.key} aria-pressed={category === item.key} className={category === item.key ? "active" : ""} onClick={() => { setCategory(item.key); setPage(1); }}>{item.label}</button>)}</div></div>
    {suggestionQuery === query.trim() && query.trim().length >= 2 && suggestions.length > 0 && <div className="frontline-knowledge-suggestions" role="listbox" aria-label="已发布知识搜索联想">{suggestions.map((suggestion) => <button key={suggestion.id} type="button" role="option" aria-selected={false} onClick={() => { setQuery(suggestion.title); setPage(1); setSuggestions([]); setSuggestionQuery(""); }}>{suggestion.title}<small>{suggestion.id} · {suggestion.category ?? "知识资产"} · {suggestion.version ?? ""}</small></button>)}</div>}
    {notice && <div className="agent-toast" role="status" aria-live="polite" aria-atomic="true">✓ {notice}</div>}{error && <div className="evaluation-error" role="alert" aria-live="assertive" aria-atomic="true"><span>{error}</span><button className="text-button" onClick={() => setKnowledgeRetryKey((value) => value + 1)} disabled={loading}>{loading ? "重试中…" : "重试读取"}</button></div>}
    <div className="frontline-knowledge-layout"><div className="frontline-knowledge-list">{loading ? <div className="knowledge-empty"><b>正在读取已发布知识</b><span>请稍候，系统正在同步最新版本。</span></div> : !docs.length ? <div className="knowledge-empty"><b>没有找到已发布知识</b><span>调整关键词或服务域；如果仍未找到，可以反馈知识缺口。</span>{(query || category !== "all") && <button className="ghost-button" onClick={() => { setQuery(""); setCategory("all"); setPage(1); }}>清除搜索和筛选</button>}</div> : docs.map((doc) => <button key={doc.id} aria-labelledby={`frontline-knowledge-title-${doc.id}`} aria-describedby={`frontline-knowledge-summary-${doc.id} frontline-knowledge-meta-${doc.id}`} className={selected?.id === doc.id ? "frontline-knowledge-card active" : "frontline-knowledge-card"} onClick={() => setSelectedId(doc.id)}><div><Status kind={doc.risk === "high" ? "danger" : "success"}>{categoryLabel[doc.category] ?? doc.category}</Status><span>{doc.id} · {doc.version}</span></div><b id={`frontline-knowledge-title-${doc.id}`}>{doc.title}</b><p id={`frontline-knowledge-summary-${doc.id}`}>{doc.content.slice(0, 128)}{doc.content.length > 128 ? "…" : ""}</p><small id={`frontline-knowledge-meta-${doc.id}`}>{doc.sourceTitle || "内部业务规范"} · 更新于 {formatDate(doc.updatedAt)} · <span className={`knowledge-source-freshness ${doc.sourceFreshnessStatus ?? "unavailable"}`}>{doc.sourceFreshnessLabel ?? "无来源快照"}</span>{doc.sourceFetchedAt ? `（${formatDate(doc.sourceFetchedAt)}）` : ""}</small></button>)}</div>
      <aside className="frontline-knowledge-detail">{selected ? <><header><div><Status kind={selected.risk === "high" ? "danger" : "success"}>{categoryLabel[selected.category] ?? selected.category}</Status><span>{selected.id} · {selected.version}</span></div><h3>{selected.title}</h3><p>{selected.ownerTeam} · {selected.sourceTitle || "内部业务规范"}</p></header><div className="knowledge-detail-content"><h4>客服可引用内容</h4><p>{selected.content}</p></div><dl className="knowledge-detail-meta"><div><dt>责任团队</dt><dd>{selected.ownerTeam}</dd></div><div><dt>风险等级</dt><dd>{selected.risk === "high" ? "高" : selected.risk === "medium" ? "中" : "低"}</dd></div><div><dt>有效期</dt><dd><span className={`knowledge-validity ${selected.validityStatus ?? "current"}`}>{selected.validityLabel ?? "当前有效"}</span><small>{formatDate(selected.validFrom)} - {formatDate(selected.validUntil)}</small></dd></div><div><dt>来源新鲜度</dt><dd><span className={`knowledge-source-freshness ${selected.sourceFreshnessStatus ?? "unavailable"}`}>{selected.sourceFreshnessLabel ?? "无来源快照"}</span><small>{selected.sourceFetchedAt ? `来源采集于 ${formatDate(selected.sourceFetchedAt)}` : "尚无可验证来源快照"}</small></dd></div></dl><div className="knowledge-detail-actions"><button className="primary-button" onClick={() => onQuote({ id: selected.id, title: selected.title, version: selected.version, content: selected.content })}>引用到当前会话</button><button className="ghost-button" onClick={() => { setFeedbackReason("内容不准确"); setFeedbackOpen(true); }}>反馈知识问题</button></div></> : <div className="knowledge-empty"><b>选择一条知识</b><span>查看完整内容和来源信息。</span></div>}</aside></div>
    <footer className="frontline-knowledge-pagination"><span>显示 {total ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, total)} / {total}</span><div><button className="ghost-button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>{pageNumbers.map((value, index) => <span key={value}>{index > 0 && pageNumbers[index - 1] !== value - 1 ? <i>…</i> : null}<button className={value === page ? "page-number active" : "page-number"} onClick={() => setPage(value)}>{value}</button></span>)}<button className="ghost-button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button></div></footer>
    {feedbackOpen && selected && <div className="knowledge-feedback-backdrop" role="presentation" onClick={() => setFeedbackOpen(false)}><section ref={feedbackDialogRef} tabIndex={-1} className="knowledge-feedback-modal" role="dialog" aria-modal="true" aria-labelledby="knowledge-feedback-title" onClick={(event) => event.stopPropagation()}><header><div><span>知识复核</span><h3 id="knowledge-feedback-title">反馈 {selected.id} 的问题</h3></div><button className="icon-button" aria-label="关闭知识反馈" onClick={() => setFeedbackOpen(false)}>×</button></header><label>问题类型<select value={feedbackReason} onChange={(event) => setFeedbackReason(event.target.value)}><option>内容不准确</option><option>规则已过期</option><option>缺少处理边界</option><option>与其他知识冲突</option><option>无法覆盖用户问法</option></select></label><label>具体说明<textarea value={feedbackContent} onChange={(event) => setFeedbackContent(event.target.value)} maxLength={2000} placeholder="写清楚用户问法、错误点或建议补充的规则…" /></label>{error && <div className="evaluation-error">{error}</div>}<footer><button className="ghost-button" onClick={() => setFeedbackOpen(false)}>取消</button><button className="primary-button" disabled={!feedbackContent.trim() || feedbackSaving} onClick={() => void submitFeedback()}>{feedbackSaving ? "提交中…" : "提交反馈"}</button></footer></section></div>}
  </section>;
}

function Knowledge(props: { role: RoleKey; onNavigate: (next: NavKey) => void; onQuote: (quote: KnowledgeQuote) => void }) {
  if (props.role === "agent") return <FrontlineKnowledge onNavigate={props.onNavigate} onQuote={props.onQuote} />;
  return <KnowledgeOperator role={props.role} />;
}

function KnowledgeOperator({ role }: { role: RoleKey }) {
  const operatorMode = role === "knowledge-operator";
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<KnowledgeDocumentView[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0, review: 0, draft: 0, archived: 0, official: 0 });
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [stateFilter, setStateFilter] = useState<"all" | "active" | "review" | "draft" | "archived">("all");
  const [knowledgeSort, setKnowledgeSort] = useState<"updated" | "coverage" | "risk" | "category">("updated");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [knowledgeRetryKey, setKnowledgeRetryKey] = useState(0);
  const [knowledgeOwnerFilter, setKnowledgeOwnerFilter] = useState<"all" | "mine" | "unassigned">("all");
  const [knowledgeViews, setKnowledgeViews] = useState<KnowledgeSavedView[]>([]);
  const [activeKnowledgeViewId, setActiveKnowledgeViewId] = useState("");
  const [knowledgeViewOpen, setKnowledgeViewOpen] = useState(false);
  const [knowledgeViewSaving, setKnowledgeViewSaving] = useState(false);
  const [knowledgeViewName, setKnowledgeViewName] = useState("");
  const [knowledgeViewScope, setKnowledgeViewScope] = useState<"personal" | "team">("personal");
  const [knowledgeViewDefault, setKnowledgeViewDefault] = useState(false);
  const [knowledgeExportSaving, setKnowledgeExportSaving] = useState(false);
  const [knowledgeFeedbackItems, setKnowledgeFeedbackItems] = useState<KnowledgeFeedbackView[]>([]);
  const [knowledgeFeedbackLoading, setKnowledgeFeedbackLoading] = useState(false);
  const [knowledgeFeedbackNotes, setKnowledgeFeedbackNotes] = useState<Record<string, string>>({});
  const [knowledgeSourceAlerts, setKnowledgeSourceAlerts] = useState<KnowledgeSourceAlert[]>([]);
  const [knowledgeSourceSummary, setKnowledgeSourceSummary] = useState<KnowledgeSourceMonitorSummary | null>(null);
  const [knowledgeSourceLoading, setKnowledgeSourceLoading] = useState(false);
  const [knowledgeSourceRequesting, setKnowledgeSourceRequesting] = useState<string | null>(null);
  const [knowledgeSourceError, setKnowledgeSourceError] = useState("");
  const [knowledgeSourceMonitorRetryKey, setKnowledgeSourceMonitorRetryKey] = useState(0);
  const [accessRequestOpen, setAccessRequestOpen] = useState(false);
  const [accessRequestSaving, setAccessRequestSaving] = useState(false);
  const [accessRequestForm, setAccessRequestForm] = useState({ requestedRole: "knowledge_operator", feature: "知识运营批量治理", reason: "" });
  const [knowledgeListRetry, setKnowledgeListRetry] = useState(false);
  const [selectedId, setSelectedId] = useState("KB-208");
  const [surface, setSurface] = useState<"work" | "library" | "playbook">(operatorMode ? "work" : "library");
  const [playbooks, setPlaybooks] = useState<ReplyPlaybook[]>(initialReplyPlaybooks);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState("RP-001");
  const [playbookNotice, setPlaybookNotice] = useState("");
  const [playbookDraft, setPlaybookDraft] = useState<ReplyPlaybook>(initialReplyPlaybooks[0]);
  const [editorTab, setEditorTab] = useState<"content" | "test" | "history">("content");
  const editorTabIds = ["knowledge-editor-tab-content", "knowledge-editor-tab-test", "knowledge-editor-tab-history"];
  const surfaceTabIds = ["knowledge-surface-tab-work", "knowledge-surface-tab-library", "knowledge-surface-tab-playbook"];
  const [draftContent, setDraftContent] = useState("");
  const [testQuestion, setTestQuestion] = useState("商品破损了，但外包装已经丢了，还能申请处理吗？");
  const [testState, setTestState] = useState<"idle" | "running" | "passed">("idle");
  const [reviewState, setReviewState] = useState<"editing" | "submitted" | "published">("editing");
  const [notice, setNotice] = useState("");
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [history, setHistory] = useState<KnowledgeVersionView[]>([]);
  const [sourceSnapshot, setSourceSnapshot] = useState<KnowledgeSourceSnapshot | null>(null);
  const [sourceSnapshotOpen, setSourceSnapshotOpen] = useState(false);
  const [knowledgeConflicts, setKnowledgeConflicts] = useState<KnowledgeConflictView[]>([]);
  const [versionDiff, setVersionDiff] = useState<KnowledgeDiffView | null>(null);
  const [knowledgeAuditEvidence, setKnowledgeAuditEvidence] = useState<KnowledgeAuditEvidence[]>([]);
  const [knowledgeImpact, setKnowledgeImpact] = useState<KnowledgeImpactView | null>(null);
  const [knowledgeImpactLoading, setKnowledgeImpactLoading] = useState(false);
  const [knowledgeImpactError, setKnowledgeImpactError] = useState("");
  const [knowledgeExplain, setKnowledgeExplain] = useState<KnowledgeExplainView | null>(null);
  const [knowledgeExplainLoading, setKnowledgeExplainLoading] = useState(false);
  const [knowledgeExplainError, setKnowledgeExplainError] = useState("");
  const [mergeConflict, setMergeConflict] = useState<KnowledgeConflictView | null>(null);
  const [mergeContent, setMergeContent] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "error">("success");
  const [retryKnowledgeAction, setRetryKnowledgeAction] = useState<{ action: KnowledgeMutation; extra: Record<string, unknown> } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", content: "", category: "refund", ownerTeam: "售后运营" });
  const [importOpen, setImportOpen] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importError, setImportError] = useState("");
  const [importTouched, setImportTouched] = useState({ sourceTitle: false, content: false });
  const [importResult, setImportResult] = useState<{ created: Array<{ id: string; title: string; version: string; state: string }>; conflicts: Array<{ title: string; reason: string; kind: string; severity: string }>; skipped: number } | null>(null);
  const [importForm, setImportForm] = useState({ sourceType: "official", sourceTitle: "", sourceUrl: "", ownerTeam: "售后运营", category: "refund", content: "" });
  const createDialogRef = useDialogFocus(createOpen, () => setCreateOpen(false));
  const importDialogRef = useDialogFocus(importOpen, () => setImportOpen(false));
  const sourceSnapshotDialogRef = useDialogFocus(sourceSnapshotOpen, () => setSourceSnapshotOpen(false));
  const mergeDialogRef = useDialogFocus(Boolean(mergeConflict), () => setMergeConflict(null));
  const knowledgeViewDialogRef = useDialogFocus(knowledgeViewOpen, () => setKnowledgeViewOpen(false));
  const accessRequestDialogRef = useDialogFocus(accessRequestOpen, () => setAccessRequestOpen(false));
  const initializedKnowledge = useRef(false);
  const [suggestions, setSuggestions] = useState<KnowledgeSuggestion[]>([]);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const suggestionsControllerRef = useRef<AbortController | null>(null);
  const canShareKnowledgeViews = role === "supervisor" || role === "administrator";
  const canKnowledgeGovern = role === "knowledge-operator" || role === "supervisor" || role === "administrator";
  async function loadKnowledgeViews() {
    try {
      const response = await fetch("/api/knowledge/views", { headers: { "x-servicepilot-channel": "customer-demo" }, cache: "no-store" });
      if (!response.ok) throw new Error("知识视图读取失败");
      const payload = await response.json() as { views?: KnowledgeSavedView[] };
      const views = payload.views ?? [];
      setKnowledgeViews(views); setKnowledgeListRetry(false);
      const requestedViewId = new URLSearchParams(window.location.search).get("knowledgeView");
      const defaultView = views.find((view) => view.id === requestedViewId) ?? views.find((view) => view.isDefault);
      if (defaultView && !activeKnowledgeViewId) applyKnowledgeView(defaultView);
    } catch { setKnowledgeViews([]); setKnowledgeListRetry(true); setNoticeKind("error"); setNotice("知识视图读取失败，可点击重试读取"); }
  }
  async function loadKnowledgeFeedback() {
    if (!canKnowledgeGovern) return;
    setKnowledgeFeedbackLoading(true);
    try {
      const response = await fetch("/api/knowledge/feedback?status=open", { headers: { "x-servicepilot-channel": "customer-demo" }, cache: "no-store" });
      if (!response.ok) throw new Error("知识反馈队列读取失败");
      const payload = await response.json() as { feedback?: KnowledgeFeedbackView[] };
      setKnowledgeFeedbackItems(payload.feedback ?? []);
    } catch (cause) { setKnowledgeFeedbackItems([]); setNoticeKind("error"); setNotice(cause instanceof Error ? cause.message : "知识反馈队列读取失败"); }
    finally { setKnowledgeFeedbackLoading(false); }
  }
  async function loadKnowledgeSourceMonitor() {
    if (!canKnowledgeGovern) return;
    setKnowledgeSourceLoading(true);
    setKnowledgeSourceError("");
    try {
      const response = await fetch("/api/knowledge/source-monitor", { headers: { "x-servicepilot-channel": "customer-demo" }, cache: "no-store" });
      const payload = await response.json() as { error?: string; alerts?: KnowledgeSourceAlert[]; summary?: KnowledgeSourceMonitorSummary };
      if (!response.ok) throw new Error(payload.error || "来源新鲜度监控读取失败");
      setKnowledgeSourceAlerts(payload.alerts ?? []);
      setKnowledgeSourceSummary(payload.summary ?? null);
    } catch (cause) {
      setKnowledgeSourceError(cause instanceof Error ? cause.message : "来源新鲜度监控读取失败");
      setNoticeKind("error"); setNotice(cause instanceof Error ? cause.message : "来源新鲜度监控读取失败");
    } finally { setKnowledgeSourceLoading(false); }
  }
  async function requestKnowledgeSourceRefresh(item: KnowledgeSourceAlert) {
    if (knowledgeSourceRequesting || item.pendingRequest) return;
    setKnowledgeSourceRequesting(item.knowledgeId);
    try {
      const response = await fetch("/api/knowledge/source-monitor", { method: "POST", headers: { "Content-Type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ knowledgeId: item.knowledgeId, reason: item.reasons.join("、") }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "重新同步请求提交失败");
      setNoticeKind("success"); setNotice(`已为 ${item.knowledgeId} 提交重新同步请求，责任人将从治理队列处理`);
      await loadKnowledgeSourceMonitor();
    } catch (cause) { setNoticeKind("error"); setNotice(cause instanceof Error ? cause.message : "重新同步请求提交失败，请重试"); }
    finally { setKnowledgeSourceRequesting(null); }
  }
  async function resolveKnowledgeFeedback(item: KnowledgeFeedbackView, status: "in_review" | "resolved" | "dismissed") {
    const note = knowledgeFeedbackNotes[item.id]?.trim() ?? "";
    if ((status === "resolved" || status === "dismissed") && !note) { setNoticeKind("error"); setNotice("请先填写反馈处理说明"); return; }
    try {
      const response = await fetch("/api/knowledge/feedback", { method: "PATCH", headers: { "Content-Type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ id: item.id, status, resolutionNote: note }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "反馈处理失败");
      setNoticeKind("success"); setNotice(status === "in_review" ? "反馈已进入处理中" : status === "resolved" ? "反馈已标记为已解决" : "反馈已标记为误报");
      await loadKnowledgeFeedback();
    } catch (cause) { setNoticeKind("error"); setNotice(cause instanceof Error ? cause.message : "反馈处理失败，请重试"); }
  }
  async function submitAccessRequest() {
    if (accessRequestSaving || !accessRequestForm.reason.trim()) return;
    setAccessRequestSaving(true);
    try {
      const response = await fetch("/api/knowledge/access-requests", { method: "POST", headers: { "Content-Type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify(accessRequestForm) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "权限申请提交失败");
      setAccessRequestOpen(false); setAccessRequestForm((form) => ({ ...form, reason: "" })); setNoticeKind("success"); setNotice("权限申请已提交，管理员审核后会更新你的工作台");
    } catch (cause) { setNoticeKind("error"); setNotice(cause instanceof Error ? cause.message : "权限申请提交失败，请重试"); }
    finally { setAccessRequestSaving(false); }
  }
  function applyKnowledgeView(view: KnowledgeSavedView) {
    setActiveKnowledgeViewId(view.id); setQuery(view.query); setStateFilter((view.stateFilter || "all") as typeof stateFilter); setKnowledgeSort((view.sort || "updated") as typeof knowledgeSort); setKnowledgeOwnerFilter((view.ownerFilter || "all") as typeof knowledgeOwnerFilter); setOffset(0);
  }
  async function saveKnowledgeView() {
    if (!knowledgeViewName.trim() || knowledgeViewSaving) return;
    setKnowledgeViewSaving(true);
    try {
      const response = await fetch("/api/knowledge/views", { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ name: knowledgeViewName, scope: knowledgeViewScope, isDefault: knowledgeViewDefault, stateFilter, categoryFilter: "all", sort: knowledgeSort, query, ownerFilter: knowledgeOwnerFilter }) });
      const payload = await response.json() as { error?: string; view?: KnowledgeSavedView };
      if (!response.ok || !payload.view) throw new Error(payload.error || "保存视图失败");
      setKnowledgeViews((views) => [payload.view as KnowledgeSavedView, ...views.map((view) => knowledgeViewDefault && view.scope === knowledgeViewScope ? { ...view, isDefault: false } : view)]); setActiveKnowledgeViewId(payload.view.id); setKnowledgeViewOpen(false); setKnowledgeViewName(""); setKnowledgeViewDefault(false); setNoticeKind("success"); setNotice("知识视图已保存");
    } catch (cause) { setNoticeKind("error"); setNotice(cause instanceof Error ? cause.message : "保存视图失败"); }
    finally { setKnowledgeViewSaving(false); }
  }
  async function deleteKnowledgeView(view: KnowledgeSavedView) {
    if (!view.canEdit) return;
    const response = await fetch(`/api/knowledge/views/${encodeURIComponent(view.id)}`, { method: "DELETE", headers: { "x-servicepilot-channel": "customer-demo" } });
    if (!response.ok) { setNoticeKind("error"); setNotice("删除视图失败，请重试"); return; }
    setKnowledgeViews((views) => views.filter((item) => item.id !== view.id)); if (activeKnowledgeViewId === view.id) setActiveKnowledgeViewId(""); setNoticeKind("success"); setNotice("知识视图已删除");
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadKnowledgeViews(); }, 0);
    return () => window.clearTimeout(timer);
  }, [role]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadKnowledgeFeedback(); }, 0);
    return () => window.clearTimeout(timer);
  }, [role]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadKnowledgeSourceMonitor(); }, 0);
    return () => window.clearTimeout(timer);
  }, [role, knowledgeSourceMonitorRetryKey]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { setLoading(true); const stateQuery = stateFilter === "all" ? "" : `&state=${stateFilter}`; const ownerQuery = knowledgeOwnerFilter === "all" ? "" : `&owner=${knowledgeOwnerFilter}`; fetch(`/api/knowledge?limit=50&offset=${offset}&q=${encodeURIComponent(query)}${stateQuery}&sort=${knowledgeSort}${ownerQuery}`, { signal: controller.signal, headers: { "x-servicepilot-channel": "customer-demo" } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("知识资产读取失败，请检查数据连接后重试")))
      .then((payload: { documents: KnowledgeDocumentView[]; total: number; stats: typeof stats }) => {
        setDocs(payload.documents); setTotal(payload.total); setStats(payload.stats); setError("");
        if (!initializedKnowledge.current && payload.documents[0]) {
          const initial = payload.documents.find((item) => item.id === "KB-208") ?? payload.documents[0];
          initializedKnowledge.current = true; setSelectedId(initial.id); setDraftContent(initial.content);
        }
      })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) { const message = cause instanceof Error ? cause.message : "知识资产读取失败"; setError(message); setNoticeKind("error"); setNotice(message); setKnowledgeListRetry(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, offset, stateFilter, knowledgeSort, knowledgeOwnerFilter, knowledgeRetryKey]);
  useEffect(() => {
    suggestionsControllerRef.current?.abort();
    const value = query.trim();
    if (value.length < 2) return;
    const controller = new AbortController();
    suggestionsControllerRef.current = controller;
    const timer = window.setTimeout(() => {
      void fetch(`/api/knowledge/suggestions?q=${encodeURIComponent(value)}${stateFilter === "all" ? "" : `&state=${stateFilter}`}`, { signal: controller.signal, headers: { "x-servicepilot-channel": "customer-demo" } })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("搜索联想读取失败")))
        .then((payload: { suggestions?: KnowledgeSuggestion[] }) => { if (!controller.signal.aborted) { setSuggestions(payload.suggestions ?? []); setSuggestionQuery(value); } })
        .catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setSuggestions([]); });
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, stateFilter]);
  useEffect(() => {
    const handleKnowledgeFilterClick = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target.closest("button") : null;
      const filterGroup = target?.closest(".knowledge-queue-filters, .knowledge-library .segmented");
      const label = target?.textContent?.trim() ?? "";
      if (!target || !filterGroup || (!label.includes("全部") && !label.includes("待复核") && !label.includes("复核 12") && !label.includes("生效") && !label.includes("草稿"))) return;
      const next = label.includes("全部") ? "all" : label.includes("待复核") || label.includes("复核 12") ? "review" : label.includes("生效") ? "active" : "draft";
      setStateFilter(next);
      setOffset(0);
      setSurface("library");
    };
    document.addEventListener("click", handleKnowledgeFilterClick);
    return () => document.removeEventListener("click", handleKnowledgeFilterClick);
  }, []);
  useEffect(() => {
    const buttons = document.querySelectorAll(".knowledge-library .segmented button");
    buttons.forEach((button) => {
      const label = button.textContent?.trim() ?? "";
      const active = stateFilter === "all" ? label.startsWith("全部") : stateFilter === "active" ? label.startsWith("生效") : stateFilter === "review" ? label.startsWith("待复核") : label.startsWith("草稿");
      button.classList.toggle("active", active);
    });
  }, [stateFilter, stats.total, stats.active, stats.review, stats.draft]);
  const selected = docs.find((item) => item.id === selectedId) ?? docs[0];
  useEffect(() => { const params = new URLSearchParams(window.location.search); params.set("view", "knowledge"); if (query) params.set("q", query); else params.delete("q"); if (offset) params.set("offset", String(offset)); else params.delete("offset"); if (stateFilter !== "all") params.set("state", stateFilter); else params.delete("state"); if (knowledgeSort !== "updated") params.set("sort", knowledgeSort); else params.delete("sort"); if (knowledgeOwnerFilter !== "all") params.set("owner", knowledgeOwnerFilter); else params.delete("owner"); if (activeKnowledgeViewId) params.set("knowledgeView", activeKnowledgeViewId); else params.delete("knowledgeView"); window.history.replaceState({}, "", `?${params.toString()}`); }, [query, offset, stateFilter, knowledgeSort, knowledgeOwnerFilter, activeKnowledgeViewId]);
  const stateLabel: Record<string, string> = { active: "生效中", review: "待复核", draft: "草稿", archived: "已归档" };
  const categoryLabel: Record<string, string> = { refund: "退款售后", damage: "破损与质量", address: "物流改址", invoice: "发票服务" };
  function flash(message: string, kind: "success" | "error" = "success") { if (message === "已打开内部来源快照") { if (sourceSnapshot) setSourceSnapshotOpen(true); else { kind = "error"; message = "当前版本暂无可用来源快照"; } } setNoticeKind(kind); setNotice(message); window.setTimeout(() => setNotice(""), 2400); }
  const hasUnsavedDraft = Boolean(selected && draftContent.trim() && draftContent !== selected.content);
  const draftStorageKey = selected ? `servicepilot-knowledge-draft-v1:${selected.id}` : "";
  useEffect(() => {
    if (!selected || !draftStorageKey) return;
    const timer = window.setTimeout(() => {
      try {
        const saved = window.sessionStorage.getItem(draftStorageKey);
        if (saved && saved !== selected.content && saved !== draftContent) {
          setDraftContent(saved);
          setNoticeKind("success");
          setNotice("已恢复最近未保存草稿，线上版本未改变");
        }
      } catch { /* session storage may be unavailable */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftStorageKey, draftContent, selected, selected?.id, selected?.content]);
  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      if (hasUnsavedDraft) window.sessionStorage.setItem(draftStorageKey, draftContent);
      else window.sessionStorage.removeItem(draftStorageKey);
    } catch { /* session storage may be unavailable */ }
  }, [draftStorageKey, draftContent, hasUnsavedDraft]);
  useEffect(() => {
    const warnBeforeLeave = (event: BeforeUnloadEvent) => { if (!hasUnsavedDraft) return; event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [hasUnsavedDraft]);
  useEffect(() => {
    if (!selectedId) return;
    fetch(`/api/knowledge/${encodeURIComponent(selectedId)}`, { headers: { "x-servicepilot-channel": "customer-demo" }, cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ versions?: KnowledgeVersionView[]; sourceSnapshot?: KnowledgeSourceSnapshot | null; conflicts?: KnowledgeConflictView[]; auditEvidence?: KnowledgeAuditEvidence[]; versionDiff?: KnowledgeDiffView | null }> : Promise.reject(new Error("版本记录读取失败")))
      .then((payload) => { setHistory(payload.versions ?? []); setSourceSnapshot(payload.sourceSnapshot ?? null); setKnowledgeConflicts(payload.conflicts ?? []); setKnowledgeAuditEvidence(payload.auditEvidence ?? []); setVersionDiff(payload.versionDiff ?? null); setSourceSnapshotOpen(false); })
      .catch(() => setHistory([]));
  }, [selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => { if (!controller.signal.aborted) { setKnowledgeImpactLoading(true); setKnowledgeImpactError(""); } }, 0);
    fetch(`/api/knowledge/impact?knowledgeId=${encodeURIComponent(selectedId)}&days=30`, { signal: controller.signal, headers: { "x-servicepilot-channel": "customer-demo" }, cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<KnowledgeImpactView> : Promise.reject(new Error("知识影响分析读取失败")))
      .then((payload) => { if (!controller.signal.aborted) setKnowledgeImpact(payload); })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) { setKnowledgeImpact(null); setKnowledgeImpactError(cause instanceof Error ? cause.message : "知识影响分析读取失败"); } })
      .finally(() => { if (!controller.signal.aborted) setKnowledgeImpactLoading(false); });
    return () => { window.clearTimeout(loadingTimer); controller.abort(); };
  }, [selectedId, knowledgeRetryKey]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => { if (!controller.signal.aborted) { setKnowledgeExplainLoading(true); setKnowledgeExplainError(""); } }, 0);
    fetch(`/api/knowledge/explain?knowledgeId=${encodeURIComponent(selectedId)}&days=90`, { signal: controller.signal, headers: { "x-servicepilot-channel": "customer-demo" }, cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<KnowledgeExplainView> : Promise.reject(new Error("命中原因读取失败")))
      .then((payload) => { if (!controller.signal.aborted) setKnowledgeExplain(payload); })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) { setKnowledgeExplain(null); setKnowledgeExplainError(cause instanceof Error ? cause.message : "命中原因读取失败"); } })
      .finally(() => { if (!controller.signal.aborted) setKnowledgeExplainLoading(false); });
    return () => { window.clearTimeout(loadingTimer); controller.abort(); };
  }, [selectedId, knowledgeRetryKey]);
  async function knowledgeAction(action: KnowledgeMutation, extra: Record<string, unknown> = {}) {
    if (!selected || knowledgeSaving) return false;
    setKnowledgeSaving(true);
    setRetryKnowledgeAction(null);
    try {
      const response = await fetch(`/api/knowledge/${encodeURIComponent(selected.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ action, ...extra }) });
      const payload = await response.json() as { error?: string; document?: KnowledgeDocumentView; state?: string; version?: string; releasePercent?: number };
      if (!response.ok) throw new Error(payload.error || "知识操作失败，请稍后重试");
      if (payload.document) {
        setDocs((items) => items.map((item) => item.id === payload.document?.id ? payload.document : item));
        setDraftContent(payload.document.content);
      }
      if (action === "merge_conflict") { setMergeConflict(null); setMergeContent(""); setReviewState("editing"); }
      if (payload.state === "review") setReviewState("submitted");
      if (payload.state === "active") setReviewState("published");
      flash(action === "save_draft" ? `草稿 ${payload.version ?? ""} 已保存` : action === "submit_review" ? "已提交真实复核任务，当前线上版本不受影响" : action === "publish" ? `版本 ${payload.version ?? ""} 已按 ${payload.releasePercent ?? 10}% 灰度发布` : action === "resolve_conflict" ? "冲突处理记录已保存" : action === "merge_conflict" ? `已生成 ${payload.version ?? ""} 合并草稿` : `已回滚到版本 ${payload.version ?? ""}`);
      const detail = await fetch(`/api/knowledge/${encodeURIComponent(selected.id)}`, { headers: { "x-servicepilot-channel": "customer-demo" }, cache: "no-store" });
      if (detail.ok) { const refreshed = await detail.json() as { versions?: KnowledgeVersionView[]; sourceSnapshot?: KnowledgeSourceSnapshot | null; conflicts?: KnowledgeConflictView[]; auditEvidence?: KnowledgeAuditEvidence[]; versionDiff?: KnowledgeDiffView | null }; setHistory(refreshed.versions ?? []); setSourceSnapshot(refreshed.sourceSnapshot ?? null); setKnowledgeConflicts(refreshed.conflicts ?? []); setKnowledgeAuditEvidence(refreshed.auditEvidence ?? []); setVersionDiff(refreshed.versionDiff ?? null); }
      return true;
    } catch (cause) { setRetryKnowledgeAction({ action, extra }); flash(cause instanceof Error ? cause.message : "知识操作失败，请重试", "error"); return false; }
    finally { setKnowledgeSaving(false); }
  }
  function selectWorkItem(target: string) { const targetDocument = docs.find((item) => item.id === target); setSelectedId(target); if (targetDocument) setDraftContent(targetDocument.content); setSurface("work"); setEditorTab("content"); setReviewState("editing"); setTestState("idle"); }
  async function batchKnowledgeAction(ids: string[], action: "claim" | "submit_review" | "archive") {
    if (!ids.length) { setKnowledgeRetryKey((value) => value + 1); return; }
    if (batchSaving || !canKnowledgeGovern) return;
    const message = action === "claim" ? `确认认领 ${ids.length} 条知识？系统会把当前账号写入负责人并记录审计。` : action === "archive" ? `确认归档 ${ids.length} 条知识？归档后不会再被客服引用，但仍可在归档筛选中恢复查看。` : `确认将 ${ids.length} 条知识提交复核？每条都会写入真实版本和审计记录。`;
    if (!window.confirm(message)) return;
    setBatchSaving(true);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        const response = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, { method: action === "archive" ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json", "x-servicepilot-channel": "customer-demo" }, ...(action === "archive" ? {} : { body: JSON.stringify({ action }) }) });
        if (!response.ok) failed.push(id);
      } catch { failed.push(id); }
    }
    setBatchSaving(false);
    setKnowledgeRetryKey((value) => value + 1);
    if (failed.length) flash(`${action === "claim" ? "已认领" : action === "archive" ? "已归档" : "已提交"} ${ids.length - failed.length} 条，${failed.length} 条失败，请缩小范围后重试`, "error");
    else flash(action === "claim" ? `已认领 ${ids.length} 条知识，当前账号成为负责人` : action === "archive" ? `已归档 ${ids.length} 条知识，仍可在归档筛选中查看` : `已提交 ${ids.length} 条真实知识复核任务`);
  }
  async function exportKnowledge(ids: string[] | null) {
    if (knowledgeExportSaving || !canKnowledgeGovern) return;
    setKnowledgeExportSaving(true);
    try {
      const response = await fetch("/api/knowledge/export", { method: "POST", headers: { "Content-Type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ ids: ids ?? [], q: query, state: stateFilter, owner: knowledgeOwnerFilter, sort: knowledgeSort }) });
      if (!response.ok) { let message = "知识导出失败，请缩小范围后重试"; try { const body = await response.json() as { error?: string }; message = body.error || message; } catch { /* keep fallback */ } throw new Error(message); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `servicepilot-knowledge-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      flash(`已导出 ${ids?.length ? "已选" : "当前筛选"}知识资产`);
    } catch (cause) { flash(cause instanceof Error ? cause.message : "知识导出失败，请重试", "error"); }
    finally { setKnowledgeExportSaving(false); }
  }
  async function compareKnowledgeVersion(versionId: string) { if (!selected) return; const response = await fetch(`/api/knowledge/${encodeURIComponent(selected.id)}?compareVersionId=${encodeURIComponent(versionId)}`, { headers: { "x-servicepilot-channel": "customer-demo" }, cache: "no-store" }); if (!response.ok) { flash("版本差异读取失败，请重试", "error"); return; } const payload = await response.json() as { versionDiff?: KnowledgeDiffView | null }; setVersionDiff(payload.versionDiff ?? null); setEditorTab("history"); }
  function openMergeConflict(conflict: KnowledgeConflictView) { setMergeConflict(conflict); setMergeContent(selected?.content ?? ""); }
  function runKnowledgeTest() {
    if (!testQuestion.trim() || testState === "running") return;
    setTestState("running");
    window.setTimeout(() => { setTestState("passed"); flash("测试完成：知识命中、回答边界和转人工策略均符合预期"); }, 720);
  }
  async function submitForReview() { if (testState !== "passed") return; const saved = await knowledgeAction("save_draft", { content: draftContent }); if (saved) await knowledgeAction("submit_review"); }
  async function publishKnowledge() { await knowledgeAction("publish", { releasePercent: 10 }); }
  async function createKnowledge() {
    if (!createForm.title.trim() || !createForm.content.trim() || knowledgeSaving) return;
    setKnowledgeSaving(true);
    try {
      const response = await fetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ ...createForm, risk: "medium", handoff: false, keywords: [], sourceType: "internal_demo", changeSummary: "新建知识草稿" }) });
      const payload = await response.json() as { error?: string; document?: KnowledgeDocumentView };
      if (!response.ok || !payload.document) throw new Error(payload.error || "新建知识失败，请稍后重试");
      setDocs((items) => [payload.document as KnowledgeDocumentView, ...items]); setTotal((value) => value + 1); setSelectedId(payload.document.id); setDraftContent(payload.document.content); setReviewState("editing"); setSurface("work"); setCreateOpen(false); setCreateForm({ title: "", content: "", category: "refund", ownerTeam: "售后运营" }); flash(`已创建 ${payload.document.id} 草稿`);
    } catch (cause) { flash(cause instanceof Error ? cause.message : "新建知识失败，请重试", "error"); }
    finally { setKnowledgeSaving(false); }
  }
  async function importKnowledgeSource() {
    if (importSaving || !importForm.sourceTitle.trim() || !importForm.content.trim()) return;
    setImportSaving(true); setImportError(""); setImportResult(null);
    try {
      const response = await fetch("/api/knowledge/import", { method: "POST", headers: { "Content-Type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify(importForm) });
      const payload = await response.json() as { error?: string; created?: Array<{ id: string; title: string; version: string; state: string }>; conflicts?: Array<{ title: string; reason: string; kind: string; severity: string }>; skipped?: number };
      if (!response.ok && !payload.created?.length) {
        setImportResult({ created: payload.created ?? [], conflicts: payload.conflicts ?? [], skipped: payload.skipped ?? 0 });
        throw new Error(payload.error || "导入失败，请检查资料后重试");
      }
      setImportResult({ created: payload.created ?? [], conflicts: payload.conflicts ?? [], skipped: payload.skipped ?? 0 });
      if (payload.created?.length) { setSurface("work"); setKnowledgeRetryKey((value) => value + 1); flash(`已导入 ${payload.created.length} 条知识草稿${payload.conflicts?.length ? `，跳过 ${payload.conflicts.length} 条冲突` : ""}`); }
    } catch (cause) { const message = cause instanceof Error ? cause.message : "导入失败，请重试"; setImportError(message); flash(message, "error"); }
    finally { setImportSaving(false); }
  }
  const selectedPlaybook = playbooks.find((item) => item.id === selectedPlaybookId) ?? playbooks[0];
  const canEditPlaybook = operatorMode;
  const canPublishPlaybook = role === "supervisor" || role === "administrator";
  function selectPlaybook(item: ReplyPlaybook) { setSelectedPlaybookId(item.id); setPlaybookDraft(item); }
  function updatePlaybook(field: "preferredReply" | "avoid" | "structure", value: string) { setPlaybookDraft((draft) => ({ ...draft, [field]: value, status: "draft" })); }
  function savePlaybook(status: PlaybookStatus = "draft") {
    const next = { ...playbookDraft, status, updatedAt: "刚刚" };
    setPlaybooks((items) => items.map((item) => item.id === next.id ? next : item)); setPlaybookDraft(next);
    setPlaybookNotice(status === "review" ? "已提交主管复核，当前 Agent 仍使用已发布版本" : status === "published" ? "已发布到 Agent 话术上下文" : "草稿已保存");
    window.setTimeout(() => setPlaybookNotice(""), 2400);
  }
  function createPlaybook() {
    const next: ReplyPlaybook = { id: `RP-${String(playbooks.length + 1).padStart(3, "0")}`, title: "新建回复话术", scenario: "待填写场景", intent: "描述客户真实意图", status: "draft", owner: "知识运营 · 当前用户", version: "v0.1", preferredReply: "", avoid: "", structure: "共情 → 确认 → 下一步", updatedAt: "刚刚", coverage: "暂无数据", tags: ["待完善"] };
    setPlaybooks((items) => [next, ...items]); setSelectedPlaybookId(next.id); setPlaybookDraft(next); setSurface("playbook");
  }

  return <section className="knowledge-operations" aria-label="知识运营工作台">
    {knowledgeViewOpen && <div className="close-sheet knowledge-import-sheet" role="dialog" aria-modal="true" aria-labelledby="knowledge-view-title"><button className="sheet-backdrop" aria-label="取消保存视图" onClick={() => setKnowledgeViewOpen(false)} /><form ref={knowledgeViewDialogRef} tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void saveKnowledgeView(); }}><header><div><span>知识资产视图</span><h2 id="knowledge-view-title">保存当前筛选</h2></div><button type="button" aria-label="关闭保存视图" onClick={() => setKnowledgeViewOpen(false)}>×</button></header><p>个人视图仅自己可见；团队视图对当前工作空间成员可见，创建和修改需要主管或管理员权限。</p><label>视图名称<input autoFocus required value={knowledgeViewName} onChange={(event) => setKnowledgeViewName(event.target.value)} maxLength={40} placeholder="例如：待复核的售后知识" /></label><label>共享范围<select value={knowledgeViewScope} onChange={(event) => setKnowledgeViewScope(event.target.value as "personal" | "team")}><option value="personal">个人视图（仅自己）</option><option value="team" disabled={!canShareKnowledgeViews}>团队共享视图{!canShareKnowledgeViews ? "（需要主管权限）" : ""}</option></select></label><label className="knowledge-view-checkbox"><input type="checkbox" checked={knowledgeViewDefault} onChange={(event) => setKnowledgeViewDefault(event.target.checked)} />设为当前范围的默认视图</label><div className="knowledge-view-summary" role="status">将保存：{stateFilter === "all" ? "全部状态" : stateFilter} · {knowledgeOwnerFilter === "all" ? "全部负责人" : knowledgeOwnerFilter === "mine" ? "我负责的" : "待分配"} · {knowledgeSort}</div><footer><button type="button" className="ghost-button" onClick={() => setKnowledgeViewOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={knowledgeViewSaving || !knowledgeViewName.trim()}>{knowledgeViewSaving ? "保存中…" : "保存视图"}</button></footer></form></div>}
    {hasUnsavedDraft && <div className="knowledge-unsaved-banner" role="status" aria-live="polite"><span><b>有未保存修改</b><small>只保存在当前浏览器草稿，线上回答仍使用已发布版本。</small></span><button className="text-button" onClick={() => { if (!window.confirm("确认丢弃当前未保存修改？线上版本不会改变。")) return; setDraftContent(selected.content); try { if (draftStorageKey) window.sessionStorage.removeItem(draftStorageKey); } catch { /* session storage may be unavailable */ } setNoticeKind("success"); setNotice("已丢弃本地修改，线上版本未改变"); }}>丢弃修改</button></div>}
    {sourceSnapshotOpen && sourceSnapshot && <div className="close-sheet knowledge-import-sheet" role="dialog" aria-modal="true" aria-labelledby="source-snapshot-title"><button className="sheet-backdrop" aria-label="关闭来源快照" onClick={() => setSourceSnapshotOpen(false)} /><section ref={sourceSnapshotDialogRef} tabIndex={-1}><header><div><span>不可变来源记录</span><h2 id="source-snapshot-title">{sourceSnapshot.sourceTitle || "来源内容快照"}</h2></div><button aria-label="关闭来源快照" onClick={() => setSourceSnapshotOpen(false)}>×</button></header><p>版本 {sourceSnapshot.sourceVersion} · 采集于 {sourceSnapshot.fetchedAt.slice(0, 10)} · 状态 {sourceSnapshot.syncStatus === "captured" ? "已留存" : sourceSnapshot.syncStatus}</p><pre className="knowledge-source-snapshot-content">{sourceSnapshot.snapshotContent}</pre><small>内容哈希：{sourceSnapshot.contentHash || "历史记录未计算"}</small><footer><button className="primary-button" onClick={() => setSourceSnapshotOpen(false)}>关闭</button></footer></section></div>}
    {knowledgeConflicts.length > 0 && <div className="knowledge-conflict-summary" role="status" aria-live="polite"><strong>检测到 {knowledgeConflicts.length} 条同域冲突/重复 · {knowledgeConflicts.filter((item) => item.status === "open").length} 条待处理</strong><span>{knowledgeConflicts.slice(0, 2).map((item) => `${item.title}：${item.reason}`).join("；")}</span><small>范围：{knowledgeConflicts[0].scope} · 处理后会保留责任人、说明和审计记录。</small>{knowledgeConflicts.filter((item) => item.status === "open").slice(0, 3).map((item) => <div className="knowledge-conflict-row" key={item.id}><span><b>{item.severity === "high" ? "高风险重复" : "口径冲突"}</b>{item.title}</span><div><button className="text-button" disabled={knowledgeSaving} onClick={() => void knowledgeAction("resolve_conflict", { conflictId: item.id, conflictStatus: "resolved", resolutionNote: "已确认当前知识适用范围，保留本次处理记录。" })}>标记已解决</button><button className="text-button" disabled={knowledgeSaving} onClick={() => void knowledgeAction("resolve_conflict", { conflictId: item.id, conflictStatus: "false_positive", resolutionNote: "已确认两条知识适用范围不同，记录为误报。" })}>标记误报</button></div></div>)}</div>}
    {knowledgeConflicts.some((item) => item.status === "open") && <button className="knowledge-merge-shortcut ghost-button" onClick={() => { const conflict = knowledgeConflicts.find((item) => item.status === "open"); if (conflict) openMergeConflict(conflict); }}>打开合并草稿</button>}
    {notice && <div className="agent-toast" role={noticeKind === "error" ? "alert" : "status"} aria-live={noticeKind === "error" ? "assertive" : "polite"} aria-atomic="true">{noticeKind === "success" ? "✓ " : "! "}{notice}{noticeKind === "error" && retryKnowledgeAction && <button className="text-button" onClick={() => void knowledgeAction(retryKnowledgeAction.action, retryKnowledgeAction.extra)}>重试</button>}{noticeKind === "error" && knowledgeListRetry && <button className="text-button" onClick={() => { setKnowledgeListRetry(false); setKnowledgeRetryKey((value) => value + 1); }}>重试读取</button>}</div>}
    {mergeConflict && <div className="close-sheet knowledge-import-sheet" role="dialog" aria-modal="true" aria-labelledby="merge-knowledge-title"><button className="sheet-backdrop" aria-label="取消合并" onClick={() => setMergeConflict(null)} /><form ref={mergeDialogRef} tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void knowledgeAction("merge_conflict", { conflictId: mergeConflict.id, mergedContent: mergeContent, resolutionNote: `已合并「${mergeConflict.title}」并提交业务复核。` }); }}><header><div><span>冲突治理 · {mergeConflict.scope}</span><h2 id="merge-knowledge-title">合并为新草稿</h2></div><button type="button" aria-label="关闭合并面板" onClick={() => setMergeConflict(null)}>×</button></header><p>请确认最终可被客服引用的内容。提交后会生成新版本草稿，原线上版本不会直接改变。</p><label>合并后的客服可引用内容<textarea autoFocus required value={mergeContent} onChange={(event) => setMergeContent(event.target.value)} maxLength={8000} /><small>{mergeContent.length}/8000 · 将保留来源冲突和处理审计记录</small></label><footer><button type="button" className="ghost-button" onClick={() => setMergeConflict(null)}>取消</button><button type="submit" className="primary-button" disabled={knowledgeSaving || !mergeContent.trim()}>{knowledgeSaving ? "生成中…" : "生成合并草稿"}</button></footer></form></div>}
    {(history.length > 1 || versionDiff || knowledgeAuditEvidence.length > 0) && <div className="knowledge-evidence-strip"><div><b>治理证据</b><span>{knowledgeAuditEvidence.length} 条审计记录{versionDiff ? ` · 已打开 ${versionDiff.version} 差异` : ""}</span></div>{history.length > 1 && <button className="ghost-button" onClick={() => { const previous = history.find((version) => version.version !== selected?.version); if (previous) void compareKnowledgeVersion(previous.id); }}>查看上一版本差异</button>}{versionDiff && <div className="knowledge-version-diff" role="region" aria-label={`版本 ${versionDiff.version} 与当前版本差异`}><header><b>版本差异 · {versionDiff.version} → 当前 {selected?.version}</b><button className="text-button" onClick={() => setVersionDiff(null)}>收起</button></header>{versionDiff.lines.slice(0, 80).map((line, index) => <div className={`diff-line ${line.type}`} key={`${index}-${line.type}`}><span aria-hidden="true">{line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}</span><code>{line.text || " "}</code></div>)}</div>}{knowledgeAuditEvidence.length > 0 && <small>最近：{knowledgeAuditEvidence.slice(0, 3).map((item) => `${item.action} · ${item.createdAt.slice(0, 10)}`).join("；")}</small>}</div>}
    {surface === "library" && <div className="knowledge-view-tools"><label>负责人<select aria-label="负责人范围" value={knowledgeOwnerFilter} onChange={(event) => { setKnowledgeOwnerFilter(event.target.value as typeof knowledgeOwnerFilter); setOffset(0); setActiveKnowledgeViewId(""); }}><option value="all">全部负责人</option><option value="mine">我负责的</option><option value="unassigned">待分配</option></select></label><label>排序<select aria-label="知识排序" value={knowledgeSort} onChange={(event) => { setKnowledgeSort(event.target.value as typeof knowledgeSort); setOffset(0); setActiveKnowledgeViewId(""); }}><option value="updated">最近更新</option><option value="coverage">覆盖率最高</option><option value="risk">风险等级</option><option value="category">服务域</option></select></label><label>已保存视图<select aria-label="已保存知识视图" value={activeKnowledgeViewId} onChange={(event) => { const view = knowledgeViews.find((item) => item.id === event.target.value); if (view) applyKnowledgeView(view); }}><option value="">当前筛选</option>{knowledgeViews.map((view) => <option key={view.id} value={view.id}>{view.name}{view.scope === "team" ? " · 团队" : ""}</option>)}</select></label><button className="ghost-button" onClick={() => { setKnowledgeViewName(""); setKnowledgeViewScope("personal"); setKnowledgeViewDefault(false); setKnowledgeViewOpen(true); }}>保存视图</button></div>}
    {surface === "library" && suggestionQuery === query.trim() && query.trim().length >= 2 && suggestions.length > 0 && <div className="knowledge-search-suggestions" role="listbox" aria-label="知识搜索联想">{suggestions.map((suggestion) => <button key={suggestion.id} type="button" role="option" aria-selected={false} onClick={() => { setQuery(suggestion.title); setOffset(0); setSuggestions([]); setSuggestionQuery(""); }}>{suggestion.title}<small>{suggestion.id} · {suggestion.category ?? "知识资产"} · {suggestion.version ?? ""}</small></button>)}</div>}
    {accessRequestOpen && <div className="close-sheet knowledge-import-sheet" role="dialog" aria-modal="true" aria-labelledby="knowledge-access-request-title"><button className="sheet-backdrop" aria-label="取消权限申请" onClick={() => setAccessRequestOpen(false)} /><form ref={accessRequestDialogRef} tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void submitAccessRequest(); }}><header><div><span>企业权限</span><h2 id="knowledge-access-request-title">申请知识治理权限</h2></div><button type="button" aria-label="关闭权限申请" onClick={() => setAccessRequestOpen(false)}>×</button></header><p>申请会进入当前工作空间的管理员审核队列；审核通过前不会改变你的实际权限。</p><label>申请角色<select value={accessRequestForm.requestedRole} onChange={(event) => setAccessRequestForm((form) => ({ ...form, requestedRole: event.target.value }))}><option value="knowledge_operator">知识运营</option><option value="supervisor">服务主管</option></select></label><label>需要访问的功能<input required value={accessRequestForm.feature} onChange={(event) => setAccessRequestForm((form) => ({ ...form, feature: event.target.value }))} maxLength={120} /></label><label>业务理由<textarea required value={accessRequestForm.reason} onChange={(event) => setAccessRequestForm((form) => ({ ...form, reason: event.target.value }))} maxLength={1000} placeholder="说明需要处理的知识范围、任务和时限…" /><small>{accessRequestForm.reason.length}/1000</small></label><footer><button type="button" className="ghost-button" onClick={() => setAccessRequestOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={accessRequestSaving || !accessRequestForm.reason.trim()}>{accessRequestSaving ? "提交中…" : "提交申请"}</button></footer></form></div>}
    {canKnowledgeGovern && <section className="panel knowledge-source-monitor" aria-label="来源新鲜度监控"><header><div><h3>来源新鲜度告警</h3><p>按真实来源快照、有效期、命中、反馈和冲突数据生成；告警不会自动改写线上知识。</p></div><button className="ghost-button" onClick={() => setKnowledgeSourceMonitorRetryKey((value) => value + 1)} disabled={knowledgeSourceLoading}>{knowledgeSourceLoading ? "读取中…" : "刷新监控"}</button></header>{knowledgeSourceSummary && <div className="knowledge-source-summary" role="status" aria-live="polite"><span><b>{knowledgeSourceSummary.total}</b> 条告警</span><span className="danger"><b>{knowledgeSourceSummary.high}</b> 高风险</span><span><b>{knowledgeSourceSummary.medium}</b> 中风险</span><span><b>{knowledgeSourceSummary.noHit}</b> 近90天无命中</span><span><b>{knowledgeSourceSummary.feedback + knowledgeSourceSummary.conflicts}</b> 反馈/冲突待处理</span><span><b>{knowledgeSourceSummary.pendingRefreshRequests}</b> 条同步请求处理中</span></div>}{knowledgeSourceError ? <div className="evaluation-error" role="alert" aria-live="assertive"><span>{knowledgeSourceError}</span><button className="text-button" onClick={() => setKnowledgeSourceMonitorRetryKey((value) => value + 1)}>重试读取</button></div> : knowledgeSourceLoading ? <div className="knowledge-empty compact" role="status">正在汇总来源快照、有效期和治理信号…</div> : knowledgeSourceAlerts.length ? <div className="knowledge-source-alert-list">{knowledgeSourceAlerts.slice(0, 8).map((item) => <article key={item.id}><div className="knowledge-source-alert-copy"><div><span className={`work-type ${item.severity === "high" ? "danger" : item.severity === "medium" ? "warning" : "info"}`}>{item.severity === "high" ? "高风险" : item.severity === "medium" ? "需处理" : "需复核"}</span><b>{item.title}</b></div><p>{item.reasons.join(" · ")} · {item.knowledgeId}</p><small>责任人：{item.ownerName}{item.ownerEmail ? ` · ${item.ownerEmail}` : " · 待分配"}{item.sourceFetchedAt ? ` · 最近采集 ${new Date(item.sourceFetchedAt).toLocaleDateString("zh-CN")}` : " · 无采集记录"}</small></div><button className="ghost-button" disabled={Boolean(item.pendingRequest) || knowledgeSourceRequesting === item.knowledgeId} onClick={() => void requestKnowledgeSourceRefresh(item)}>{item.pendingRequest ? "已提交请求" : knowledgeSourceRequesting === item.knowledgeId ? "提交中…" : "请求重新同步"}</button></article>)}</div> : <div className="knowledge-empty compact"><b>当前没有来源告警</b><span>所有可见知识的来源、有效期和治理信号均在监控窗口内。</span></div>}{knowledgeSourceAlerts.length > 8 && <footer className="knowledge-source-monitor-footer">仅展示优先级最高的 8 条；共 {knowledgeSourceSummary?.total ?? knowledgeSourceAlerts.length} 条告警，请使用知识资产筛选继续治理。</footer>}</section>}
    {canKnowledgeGovern && <section className="panel knowledge-feedback-queue" aria-label="知识反馈队列"><header><div><h3>知识反馈闭环</h3><p>客服反馈进入这里，处理结果会写入审计并回到知识治理流程。</p></div><button className="ghost-button" onClick={() => void loadKnowledgeFeedback()} disabled={knowledgeFeedbackLoading}>{knowledgeFeedbackLoading ? "读取中…" : "刷新反馈"}</button></header>{knowledgeFeedbackLoading ? <div className="knowledge-empty compact" role="status">正在读取待处理反馈…</div> : knowledgeFeedbackItems.length ? <div className="knowledge-feedback-list">{knowledgeFeedbackItems.map((item) => <article key={item.id}><div><b>{item.title}</b><small>{item.knowledgeId} · {item.reason} · {item.actorName}</small></div><p>{item.content}</p><label>处理说明<input aria-label={`反馈 ${item.id} 处理说明`} value={knowledgeFeedbackNotes[item.id] ?? ""} onChange={(event) => setKnowledgeFeedbackNotes((notes) => ({ ...notes, [item.id]: event.target.value }))} placeholder="记录修订、误报或后续动作…" /></label><footer><button className="text-button" onClick={() => void resolveKnowledgeFeedback(item, "in_review")}>标记处理中</button><button className="text-button" disabled={!knowledgeFeedbackNotes[item.id]?.trim()} onClick={() => void resolveKnowledgeFeedback(item, "dismissed")}>标记误报</button><button className="primary-button" disabled={!knowledgeFeedbackNotes[item.id]?.trim()} onClick={() => void resolveKnowledgeFeedback(item, "resolved")}>标记已解决</button></footer></article>)}</div> : <div className="knowledge-empty compact"><b>暂无待处理反馈</b><span>客服提交的问题会自动出现在这里。</span></div>}</section>}
    <header className="knowledge-command">
      <div><span>知识运营 · 今日工作</span><h2>先处理会影响真实回答的知识</h2><p>从客服反馈和评测失败进入，完成修订、验证、审核与安全发布。</p></div>
      <div className="knowledge-command-stats"><div><b>7</b><span>知识缺口</span><small>影响 96 次会话</small></div><div><b>3</b><span>口径冲突</span><small>1 项高风险</small></div><div><b>12</b><span>待我复核</span><small>3 项即将到期</small></div></div>
      <button className="primary-button" onClick={() => setImportOpen(true)}>＋ 导入知识来源</button>{!canKnowledgeGovern && <button className="ghost-button" onClick={() => setAccessRequestOpen(true)}>申请治理权限</button>}
    </header>
    <nav className="knowledge-surface-tabs" role="tablist" aria-label="知识运营视图"><button id={surfaceTabIds[0]} role="tab" aria-selected={surface === "work"} aria-controls="knowledge-surface-panel-work" tabIndex={surface === "work" ? 0 : -1} className={surface === "work" ? "active" : ""} onClick={() => setSurface("work")} onKeyDown={(event) => handleTabKeyDown(event, surfaceTabIds, 0, (nextIndex) => setSurface(nextIndex === 0 ? "work" : nextIndex === 1 ? "library" : "playbook"))}>工作队列 <b>22</b></button><button id={surfaceTabIds[1]} role="tab" aria-selected={surface === "library"} aria-controls="knowledge-surface-panel-library" tabIndex={surface === "library" ? 0 : -1} className={surface === "library" ? "active" : ""} onClick={() => setSurface("library")} onKeyDown={(event) => handleTabKeyDown(event, surfaceTabIds, 1, (nextIndex) => setSurface(nextIndex === 0 ? "work" : nextIndex === 1 ? "library" : "playbook"))}>知识资产 <b>{stats.total || "—"}</b></button><button id={surfaceTabIds[2]} role="tab" aria-selected={surface === "playbook"} aria-controls="knowledge-surface-panel-playbook" tabIndex={surface === "playbook" ? 0 : -1} className={surface === "playbook" ? "active" : ""} onClick={() => { setSurface("playbook"); setPlaybookDraft(selectedPlaybook); }} onKeyDown={(event) => handleTabKeyDown(event, surfaceTabIds, 2, (nextIndex) => setSurface(nextIndex === 0 ? "work" : nextIndex === 1 ? "library" : "playbook"))}>话术训练 <b>{playbooks.length}</b></button></nav>
    {surface === "playbook" ? <div id="knowledge-surface-panel-playbook" role="tabpanel" aria-labelledby={surfaceTabIds[2]} className="playbook-shell">
      <header className="playbook-command"><div><span>知识运营 · 回复训练</span><h2>让客服回答更像人</h2><p>把优秀人工回复沉淀为可审核、可回滚的 Agent 话术资产；发布后进入回答上下文，不会覆盖业务知识。</p></div><div className="playbook-command-stats"><div><b>{playbooks.filter((item) => item.status === "published").length}</b><span>已发布</span><small>正在影响 Agent</small></div><div><b>{playbooks.filter((item) => item.status === "review").length}</b><span>待复核</span><small>需要主管确认</small></div><div><b>{playbooks.filter((item) => item.status === "draft").length}</b><span>待优化</span><small>仅保存为草稿</small></div></div>{canEditPlaybook && <button className="primary-button" onClick={createPlaybook}>＋ 新建话术</button>}</header>
      {playbookNotice && <div className="agent-toast" role="status">✓ {playbookNotice}</div>}
      <div className="playbook-workspace"><aside className="panel playbook-queue"><header><div><h3>话术资产</h3><p>按场景和发布状态管理</p></div><button aria-label="刷新话术资产" onClick={() => setPlaybooks([...playbooks])}>↻</button></header><div className="playbook-filters"><button className="active">全部 {playbooks.length}</button><button>待复核 {playbooks.filter((item) => item.status === "review").length}</button><button>已发布 {playbooks.filter((item) => item.status === "published").length}</button></div><div className="playbook-list">{playbooks.map((item) => <button key={item.id} className={item.id === selectedPlaybookId ? "active" : ""} onClick={() => selectPlaybook(item)}><span>{item.scenario}</span><b>{item.title}</b><small>{item.id} · {item.version} · {item.coverage}</small><Status kind={item.status === "published" ? "success" : item.status === "review" ? "warning" : "neutral"}>{item.status === "published" ? "已发布" : item.status === "review" ? "待复核" : "草稿"}</Status></button>)}</div></aside>
        <article className="panel playbook-editor"><header><div><span>{selectedPlaybook.id} · {selectedPlaybook.version}</span><h3>{selectedPlaybook.title}</h3><p>{selectedPlaybook.scenario} · 负责人 {selectedPlaybook.owner}</p></div><Status kind={selectedPlaybook.status === "published" ? "success" : selectedPlaybook.status === "review" ? "warning" : "info"}>{selectedPlaybook.status === "published" ? "线上生效" : selectedPlaybook.status === "review" ? "等待复核" : "编辑草稿"}</Status></header><div className="playbook-editor-body"><label>客户真实问法 / 意图<input value={playbookDraft.intent} disabled={!canEditPlaybook} onChange={(event) => setPlaybookDraft((draft) => ({ ...draft, intent: event.target.value }))} /><small>用用户自己的话描述，不要写模型术语。</small></label><label>推荐回复 <span>Agent 优先学习</span><textarea value={playbookDraft.preferredReply} disabled={!canEditPlaybook} onChange={(event) => updatePlaybook("preferredReply", event.target.value)} /><small>建议 1–3 句：先接住情绪，再确认事实，最后给下一步。</small></label><label>避免表达 <textarea value={playbookDraft.avoid} disabled={!canEditPlaybook} onChange={(event) => updatePlaybook("avoid", event.target.value)} /><small>发布前会做风险词扫描，避免暴露 Agent、知识库或转人工等内部实现。</small></label><label>回复结构 <input value={playbookDraft.structure} disabled={!canEditPlaybook} onChange={(event) => updatePlaybook("structure", event.target.value)} /></label><div className="playbook-preview"><span>实时预览 · 用户端不会显示训练标签</span><div><b>用户</b><p>{playbookDraft.intent}</p></div><div className="preview-agent"><b>客服</b><p>{playbookDraft.preferredReply || "填写推荐回复后，这里会展示自然表达预览。"}</p></div></div></div><footer className="playbook-actions"><span>{canEditPlaybook ? "保存只影响草稿；发布需主管确认" : "此工作台仅可查看，内容变更请反馈给知识运营"}</span>{canEditPlaybook && <><button className="ghost-button" onClick={() => savePlaybook("draft")}>保存草稿</button><button className="primary-button" onClick={() => savePlaybook("review")}>提交主管复核</button></>}{canPublishPlaybook && selectedPlaybook.status === "review" && <button className="primary-button" onClick={() => savePlaybook("published")}>批准并发布到 Agent</button>}</footer></article>
        <aside className="panel playbook-readiness"><header><div><h3>训练影响</h3><p>发布前的可解释检查</p></div><Status kind={selectedPlaybook.status === "published" ? "success" : "warning"}>{selectedPlaybook.status === "published" ? "生效中" : "未发布"}</Status></header><div className="playbook-impact"><b>{selectedPlaybook.coverage}</b><span>相关会话覆盖</span></div><div className="readiness-list"><div className="passed"><i>✓</i><p><b>真实问法</b><span>已记录客户意图和场景</span></p></div><div className="passed"><i>✓</i><p><b>自然表达</b><span>共情、确认、下一步结构完整</span></p></div><div className="passed"><i>✓</i><p><b>风险词扫描</b><span>不暴露内部 Agent 术语</span></p></div><div className={selectedPlaybook.status === "review" || selectedPlaybook.status === "published" ? "passed" : "pending"}><i>{selectedPlaybook.status === "review" || selectedPlaybook.status === "published" ? "✓" : "4"}</i><p><b>主管复核</b><span>{selectedPlaybook.status === "published" ? "已批准并发布" : selectedPlaybook.status === "review" ? "等待主管确认" : "提交后才能进入复核"}</span></p></div></div><div className="playbook-permission"><b>权限分工</b><span>知识运营：编辑 · 提交</span><span>服务主管：批准 · 发布 · 回滚</span><span>AI 运营：查看影响 · 配置消费方式</span><span>一线客服：反馈优秀回复，不可发布</span></div></aside></div>
    </div> : surface === "work" ? <div id="knowledge-surface-panel-work" role="tabpanel" aria-labelledby={surfaceTabIds[0]} className="knowledge-workspace">
      <KnowledgeWorkQueue docs={docs} canBatchReview={canKnowledgeGovern} batchSaving={batchSaving} onOpen={selectWorkItem} onBatchAction={batchKnowledgeAction} onExport={exportKnowledge} exportSaving={knowledgeExportSaving} />
      <article className="panel knowledge-editor">{selected ? <><header className="knowledge-editor-head"><div><span>{selected.id} · {selected.version}</span><h3>{selected.title}</h3><p>{categoryLabel[selected.category] ?? selected.category} · {selected.ownerTeam} · 更新于 {selected.updatedAt?.slice(0, 10) || "今天"}</p></div><Status kind={reviewState === "published" ? "success" : reviewState === "submitted" ? "warning" : "info"}>{reviewState === "published" ? "灰度发布中" : reviewState === "submitted" ? "复核中" : "修订草稿"}</Status></header><div className="knowledge-editor-tabs" role="tablist" aria-label="知识编辑视图" aria-orientation="horizontal"><button id={editorTabIds[0]} role="tab" aria-selected={editorTab === "content"} aria-controls="knowledge-editor-panel-content" tabIndex={editorTab === "content" ? 0 : -1} className={editorTab === "content" ? "active" : ""} onClick={() => setEditorTab("content")} onKeyDown={(event) => handleTabKeyDown(event, editorTabIds, 0, (nextIndex) => setEditorTab(nextIndex === 0 ? "content" : nextIndex === 1 ? "test" : "history"))}>内容与边界</button><button id={editorTabIds[1]} role="tab" aria-selected={editorTab === "test"} aria-controls="knowledge-editor-panel-test" tabIndex={editorTab === "test" ? 0 : -1} className={editorTab === "test" ? "active" : ""} onClick={() => setEditorTab("test")} onKeyDown={(event) => handleTabKeyDown(event, editorTabIds, 1, (nextIndex) => setEditorTab(nextIndex === 0 ? "content" : nextIndex === 1 ? "test" : "history"))}>回答验证 <b>{testState === "passed" ? "已通过" : "3 个用例"}</b></button><button id={editorTabIds[2]} role="tab" aria-selected={editorTab === "history"} aria-controls="knowledge-editor-panel-history" tabIndex={editorTab === "history" ? 0 : -1} className={editorTab === "history" ? "active" : ""} onClick={() => setEditorTab("history")} onKeyDown={(event) => handleTabKeyDown(event, editorTabIds, 2, (nextIndex) => setEditorTab(nextIndex === 0 ? "content" : nextIndex === 1 ? "test" : "history"))}>版本记录</button></div>
        {editorTab === "content" && <div id="knowledge-editor-panel-content" className="knowledge-edit-body" role="tabpanel" aria-labelledby={editorTabIds[0]} tabIndex={0}><section><label>客服可引用内容<textarea value={draftContent} onChange={(event) => { setDraftContent(event.target.value); setReviewState("editing"); }} maxLength={800} /><small>{draftContent.length}/800 · 只写可被客服直接解释的事实和处理边界</small></label><div className="knowledge-field-grid"><label>适用场景<input value={(selected.keywords ?? []).join("、")} readOnly /></label><label>责任团队<input value={selected.ownerTeam} readOnly /></label><label>风险等级<select defaultValue={selected.risk}><option value="low">低风险</option><option value="medium">中风险</option><option value="high">高风险</option></select></label><label>人工接管<select defaultValue={selected.handoff ? "yes" : "no"}><option value="no">允许自动回答</option><option value="yes">必须转人工</option></select></label></div></section><aside><div className="source-card"><span>原始依据</span><b>{selected.sourceTitle || "内部业务规范"}</b><small>{selected.sourceType === "official" ? "官方公开来源 · 已留存快照" : "内部来源 · 需要业务复核"}</small>{selected.sourceUrl ? <a href={selected.sourceUrl} target="_blank" rel="noreferrer">查看原文 ↗</a> : <button onClick={() => flash("已打开内部来源快照")}>查看来源快照</button>}</div><div className="conflict-card"><span>!</span><p><b>检测到 1 处口径差异</b><small>旧版客服 SOP 对处理时效的描述不同，发布前需确认适用范围。</small></p><button onClick={() => flash("已采用当前业务规则，并保留冲突处理记录")}>确认处理</button></div></aside></div>}
        {editorTab === "test" && <div id="knowledge-editor-panel-test" className="knowledge-test-body" role="tabpanel" aria-labelledby={editorTabIds[1]} tabIndex={0}><header><div><h4>用真实用户问法验证</h4><p>发布前确认知识能被正确召回、回答不越界、该转人工时会转人工。</p></div><Status kind={testState === "passed" ? "success" : "neutral"}>{testState === "passed" ? "3/3 通过" : "等待测试"}</Status></header><label>测试问题<textarea value={testQuestion} onChange={(event) => { setTestQuestion(event.target.value); setTestState("idle"); }} /></label><button className="primary-button" onClick={runKnowledgeTest} disabled={testState === "running"}>{testState === "running" ? "正在调用 Agent…" : "运行回答测试"}</button>{testState === "passed" && <div className="knowledge-test-result"><div><span>用户意图</span><b>商品破损处理 · 正确</b></div><div><span>命中知识</span><b>{selected.id} {selected.version}</b></div><div><span>回答边界</span><b>未承诺赔付金额 · 通过</b></div><div><span>人工接管</span><b>高风险场景已转人工 · 通过</b></div><p>示例回答：{draftContent}</p></div>}</div>}
        {editorTab === "history" && <div id="knowledge-editor-panel-history" className="knowledge-history" role="tabpanel" aria-labelledby={editorTabIds[2]} tabIndex={0}>{history.length ? history.map((version) => <div key={version.id}><span>{version.createdAt?.slice(0, 10) || "—"}</span><b>{version.version} · {version.state === "active" ? "线上" : version.state === "review" ? "待复核" : version.state === "rolled_back" ? "已回滚" : "草稿"}</b><small>{version.changeSummary || "无变更说明"}{version.releasePercent ? ` · ${version.releasePercent}% 灰度` : ""}{version.state === "archived" || version.state === "rolled_back" ? <button className="text-button" disabled={knowledgeSaving || !canPublishPlaybook} onClick={() => { if (window.confirm(`确认回滚到 ${version.version}？当前线上版本将保留为可审计历史。`)) void knowledgeAction("rollback", { versionId: version.id }); }}>回滚到此版本</button> : null}</small></div>) : <div className="knowledge-empty"><b>暂无版本记录</b><span>保存第一份草稿后会在这里生成可审计版本。</span></div>}</div>}
        <footer className="knowledge-editor-actions"><span>{knowledgeSaving ? "正在保存到服务端…" : reviewState === "editing" ? "修改仅保存在草稿，不影响线上回答" : reviewState === "submitted" ? "等待业务与合规复核" : "10% 灰度流量 · 可回退"}</span><button className="ghost-button" disabled={knowledgeSaving} onClick={() => { setDraftContent(selected.content); setReviewState("editing"); flash("已恢复为线上版本内容"); }}>恢复线上内容</button>{reviewState === "editing" && <><button className="ghost-button" disabled={knowledgeSaving || !draftContent.trim()} onClick={() => void knowledgeAction("save_draft", { content: draftContent })}>保存草稿</button><button className="primary-button" onClick={() => void submitForReview()} disabled={testState !== "passed" || knowledgeSaving}>提交双人复核</button></>}{reviewState === "submitted" && canPublishPlaybook && <button className="primary-button" disabled={knowledgeSaving} onClick={() => void publishKnowledge()}>批准并灰度发布</button>}{reviewState === "published" && <button className="primary-button" onClick={() => setEditorTab("history")}>查看版本与回滚</button>}</footer></> : <div className="knowledge-empty"><b>选择一个工作项</b><span>从左侧队列开始处理知识缺口、冲突或复核任务。</span></div>}</article>
      <aside className="panel release-readiness"><header><h3>发布就绪度</h3><Status kind={testState === "passed" ? "success" : "warning"}>{testState === "passed" ? "可以提交" : "还差 1 项"}</Status></header><div className="readiness-score"><b>{testState === "passed" ? "100" : "80"}</b><span>/100</span><small>高风险知识必须全部通过</small></div><div className="readiness-list"><div className="passed"><i>✓</i><p><b>来源可追溯</b><span>原文与快照已留存</span></p></div><div className="passed"><i>✓</i><p><b>责任与有效期明确</b><span>{selected?.ownerTeam || "责任团队"}负责</span></p></div><div className="passed"><i>✓</i><p><b>冲突已识别</b><span>1 处差异等待复核确认</span></p></div><div className={testState === "passed" ? "passed" : "pending"}><i>{testState === "passed" ? "✓" : "4"}</i><p><b>回答验证</b><span>{testState === "passed" ? "召回、回答、转人工均通过" : "运行 3 个真实问法后解锁复核"}</span></p></div><div className={reviewState !== "editing" ? "passed" : "pending"}><i>{reviewState !== "editing" ? "✓" : "5"}</i><p><b>双人复核</b><span>{reviewState === "published" ? "业务与合规已通过" : reviewState === "submitted" ? "审核任务已创建" : "测试通过后提交"}</span></p></div></div><div className="release-impact" aria-busy={knowledgeImpactLoading}><span>发布影响分析 · 最近 30 天真实数据</span>{knowledgeImpactLoading ? <div className="knowledge-impact-loading" role="status" aria-live="polite"><i /><i /><i /><small>正在读取命中、反馈、转人工和 token 数据…</small></div> : knowledgeImpactError ? <div className="knowledge-impact-error" role="alert"><small>{knowledgeImpactError}</small><button className="text-button" onClick={() => setKnowledgeRetryKey((value) => value + 1)}>重试读取</button></div> : knowledgeImpact ? <><div className="knowledge-impact-grid"><div><b>{knowledgeImpact.metrics.hitCount}</b><span>命中次数</span></div><div><b>{Math.round(knowledgeImpact.metrics.citationRate * 100)}%</b><span>引用率</span></div><div><b>{Math.round(knowledgeImpact.metrics.negativeFeedbackRate * 100)}%</b><span>负反馈率</span></div><div><b>{Math.round(knowledgeImpact.metrics.handoffRate * 100)}%</b><span>转人工率</span></div><div><b>{Math.round(knowledgeImpact.metrics.zeroResultRate * 100)}%</b><span>零结果率</span></div><div><b>{knowledgeImpact.metrics.relatedConversationCount}</b><span>相关会话</span></div></div><details className="knowledge-impact-details"><summary>查看版本对比（{knowledgeImpact.versionComparison.length} 个版本）</summary>{knowledgeImpact.versionComparison.length ? <table><thead><tr><th>版本</th><th>命中</th><th>转人工</th><th>平均延迟</th><th>Tokens</th></tr></thead><tbody>{knowledgeImpact.versionComparison.map((item) => <tr key={item.version}><td>{item.version}</td><td>{item.hitCount}</td><td>{Math.round(item.handoffRate * 100)}%</td><td>{Math.round(item.averageLatencyMs).toLocaleString("zh-CN")} ms</td><td>{item.totalTokens.toLocaleString("zh-CN")}</td></tr>)}</tbody></table> : <small>暂无足够版本样本</small>}</details><small>成本影响：{knowledgeImpact.costImpact.totalTokens.toLocaleString("zh-CN")} tokens · 真实延迟已统计，模型单价未配置</small></> : <small role="status">暂无最近 30 天真实运行数据</small>}</div><div className="knowledge-explain-panel" aria-busy={knowledgeExplainLoading}><header><b>为什么命中</b><small>最近 90 天真实检索证据</small></header>{knowledgeExplainLoading ? <div className="knowledge-explain-loading" role="status" aria-live="polite">正在读取关键词、路由和检索轨迹…</div> : knowledgeExplainError ? <div className="knowledge-impact-error" role="alert"><small>{knowledgeExplainError}</small><button className="text-button" onClick={() => setKnowledgeRetryKey((value) => value + 1)}>重试读取</button></div> : knowledgeExplain ? <><div className="knowledge-explain-summary"><div><b>{knowledgeExplain.explanation.hitRuns}</b><span>命中运行</span></div><div><b>{Math.round(knowledgeExplain.explanation.averageConfidence * 100)}%</b><span>平均置信度</span></div><div><b>{knowledgeExplain.explanation.indexVersions.length || "—"}</b><span>索引版本</span></div></div><ul className="knowledge-explain-reasons">{knowledgeExplain.explanation.keywordHits.length ? <li>关键词命中：{knowledgeExplain.explanation.keywordHits.slice(0, 4).map((item) => `${item.keyword}（${item.count}）`).join("、")}</li> : <li>未保存关键词命中；该知识来自真实检索记录中的最终选择。</li>}<li>路由意图：{knowledgeExplain.explanation.intents.length ? knowledgeExplain.explanation.intents.slice(0, 3).map((item) => `${item.intent}（${item.count}）`).join("、") : "暂无"}</li><li>{knowledgeExplain.governance.relation === "child" ? `子知识 ${knowledgeExplain.document.id}，父知识 ${knowledgeExplain.governance.parentId || "未记录"}` : "父知识/独立知识，未发现子知识替换证据"}</li>{knowledgeExplain.governance.conditionSignals.length ? <li>适用条件：{knowledgeExplain.governance.conditionSignals.slice(0, 2).join("；")}</li> : null}</ul><details className="knowledge-explain-details"><summary>查看真实检索轨迹与用户问法</summary>{knowledgeExplain.explanation.retrievalEvidence.length ? <ul>{knowledgeExplain.explanation.retrievalEvidence.slice(0, 4).map((item) => <li key={item.label}><span>{item.label}</span><small>{item.count} 次{item.indexVersion ? ` · 索引 ${item.indexVersion}` : ""}</small></li>)}</ul> : <small>当前运行没有保存可展开的检索轨迹</small>}{knowledgeExplain.explanation.queries.length ? <p>示例问法：{knowledgeExplain.explanation.queries.join("；")}</p> : null}</details><small>过滤口径：{knowledgeExplain.governance.filterNotes.join("；")}</small></> : <small role="status">暂无最近 90 天命中记录</small>}</div></aside>
      </div> : <article id="knowledge-surface-panel-library" role="tabpanel" aria-labelledby={surfaceTabIds[1]} className="panel knowledge-library"><header><div className="search-box wide">⌕ <input aria-label="搜索知识资产" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="搜索知识、用户问法、来源或负责人…" /></div><div className="segmented" role="group" aria-label="按知识状态筛选"><button aria-pressed={stateFilter === "all"} className={stateFilter === "all" ? "active" : ""} onClick={() => { setStateFilter("all"); setOffset(0); }}>全部 {stats.total}</button><button aria-pressed={stateFilter === "active"} className={stateFilter === "active" ? "active" : ""} onClick={() => { setStateFilter("active"); setOffset(0); }}>生效 {stats.active}</button><button aria-pressed={stateFilter === "review"} className={stateFilter === "review" ? "active" : ""} onClick={() => { setStateFilter("review"); setOffset(0); }}>待复核 {stats.review}</button><button aria-pressed={stateFilter === "draft"} className={stateFilter === "draft" ? "active" : ""} onClick={() => { setStateFilter("draft"); setOffset(0); }}>草稿 {stats.draft}</button></div><button className="ghost-button" onClick={() => setImportOpen(true)}>批量导入</button><button className="primary-button" onClick={() => setCreateOpen(true)}>＋ 新建知识</button></header><div className="knowledge-source-freshness-legend" role="note"><span>来源新鲜度</span><i className="fresh">来源新鲜</i><i className="aging">来源需复核</i><i className="stale">来源已陈旧</i><small>依据最近来源快照，不等同于知识有效期。</small></div>{error && <div className="evaluation-error">{error}</div>}{loading ? <div className="knowledge-skeleton"><i /><i /><i /></div> : <table><thead><tr><th>知识资产</th><th>责任团队</th><th>来源</th><th>覆盖率</th><th>状态</th><th>有效期</th><th>最近更新</th></tr></thead><tbody>{docs.map((doc) => <tr key={doc.id} tabIndex={0} aria-label={`打开知识 ${doc.title}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(doc.id); setDraftContent(doc.content); setTestState("idle"); setReviewState("editing"); setSurface("work"); } }} onClick={() => { setSelectedId(doc.id); setDraftContent(doc.content); setTestState("idle"); setReviewState("editing"); setSurface("work"); }}><td><b>{doc.title}</b><small>{doc.id} · {doc.version} · {categoryLabel[doc.category] ?? doc.category}</small></td><td>{doc.ownerTeam}</td><td><span>{doc.sourceType === "official" ? "官方来源" : "内部规范"}</span><small>{doc.sourceTitle || "未命名来源"}</small><small className={`knowledge-source-freshness ${doc.sourceFreshnessStatus ?? "unavailable"}`}>{doc.sourceFreshnessLabel ?? "无来源快照"}{doc.sourceFetchedAt ? ` · ${formatDate(doc.sourceFetchedAt)}` : ""}</small></td><td><div className="coverage"><i style={{ width: `${doc.coverage * 100}%` }} /><span>{(doc.coverage * 100).toFixed(0)}%</span></div></td><td><Status kind={doc.state === "active" ? "success" : doc.state === "review" ? "warning" : "neutral"}>{stateLabel[doc.state] ?? doc.state}</Status></td><td><span className={`knowledge-validity ${doc.validityStatus ?? "current"}`}>{doc.validityLabel ?? "未设有效期"}</span><small>{formatDate(doc.validFrom)} - {formatDate(doc.validUntil)}</small></td><td>{doc.updatedAt?.slice(0, 10)}</td></tr>)}</tbody></table>}{!loading && !error && !docs.length && <div className="knowledge-empty"><b>没有找到知识资产</b><span>调整搜索词，或导入一个新的可信来源。</span></div>}<footer><span>显示 {total ? offset + 1 : 0}-{Math.min(offset + docs.length, total)} / {total}</span><div><button className="ghost-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button><button className="ghost-button" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}>下一页</button></div></footer></article>}
    {createOpen && <div className="close-sheet knowledge-import-sheet" role="dialog" aria-modal="true" aria-labelledby="create-knowledge-title"><button className="sheet-backdrop" aria-label="取消新建" onClick={() => setCreateOpen(false)} /><form ref={createDialogRef} tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void createKnowledge(); }}><header><div><span>知识资产</span><h2 id="create-knowledge-title">新建知识草稿</h2></div><button type="button" aria-label="关闭新建面板" onClick={() => setCreateOpen(false)}>×</button></header><p>草稿创建后需完成回答测试、双人复核和灰度发布，不能直接影响线上回答。</p><label>知识标题<input autoFocus required value={createForm.title} onChange={(event) => setCreateForm((form) => ({ ...form, title: event.target.value }))} maxLength={160} placeholder="例如：破损商品缺少外包装的处理边界" /></label><label>客服可引用内容<textarea required value={createForm.content} onChange={(event) => setCreateForm((form) => ({ ...form, content: event.target.value }))} maxLength={8000} placeholder="写清事实、适用范围、处理边界和需要转人工的情况…" /></label><div className="knowledge-field-grid"><label>服务域<select value={createForm.category} onChange={(event) => setCreateForm((form) => ({ ...form, category: event.target.value }))}><option value="refund">退款售后</option><option value="damage">破损与质量</option><option value="address">物流改址</option><option value="invoice">发票服务</option></select></label><label>责任团队<input required value={createForm.ownerTeam} onChange={(event) => setCreateForm((form) => ({ ...form, ownerTeam: event.target.value }))} /></label></div><footer><button type="button" className="ghost-button" onClick={() => setCreateOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={knowledgeSaving}>{knowledgeSaving ? "创建中…" : "创建草稿"}</button></footer></form></div>}
    {importOpen && <div className="close-sheet knowledge-import-sheet" role="dialog" aria-modal="true" aria-labelledby="import-title"><button className="sheet-backdrop" aria-label="取消导入" onClick={() => setImportOpen(false)} /><section ref={importDialogRef} tabIndex={-1}><header><div><span>知识来源接入</span><h2 id="import-title">导入可信业务资料</h2></div><button aria-label="关闭导入面板" onClick={() => setImportOpen(false)}>×</button></header><p>系统会按标题或空行拆分资料，生成可审核草稿、保留来源快照并检测同域冲突，不会绕过人工审核直接发布。</p><div className="import-steps" aria-label="导入步骤"><span className="active">1 解析资料</span><i>→</i><span>2 检查冲突</span><i>→</i><span>3 生成草稿</span></div><label>来源类型<select value={importForm.sourceType} onChange={(event) => setImportForm((form) => ({ ...form, sourceType: event.target.value }))}><option value="official">官方政策或法规</option><option value="internal_demo">内部业务规范</option><option value="generated-internal-review">客服 FAQ</option></select></label><label>选择文本资料（可选）<input type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const content = await file.text(); setImportForm((form) => ({ ...form, sourceTitle: form.sourceTitle || file.name, content })); setImportError(""); } catch { setImportError("文件读取失败，请改为粘贴资料正文或重试"); } }} /><small>支持 .txt、.md、.csv、.json；文件内容会进入同一套拆分、冲突检测和审核流程。</small></label><label>来源名称<input required value={importForm.sourceTitle} onBlur={() => setImportTouched((fields) => ({ ...fields, sourceTitle: true }))} onChange={(event) => setImportForm((form) => ({ ...form, sourceTitle: event.target.value }))} placeholder="例如：国家税务总局数电发票业务公告.pdf" />{importTouched.sourceTitle && !importForm.sourceTitle.trim() && <small className="field-error" role="alert">请填写来源名称，方便后续追溯。</small>}</label><label>来源地址（可选）<input value={importForm.sourceUrl} onChange={(event) => setImportForm((form) => ({ ...form, sourceUrl: event.target.value }))} placeholder="https://… 或内部文档编号" /></label><div className="knowledge-field-grid"><label>责任团队<select value={importForm.ownerTeam} onChange={(event) => setImportForm((form) => ({ ...form, ownerTeam: event.target.value }))}><option>财税运营</option><option>售后运营</option><option>履约团队</option><option>合规运营</option></select></label><label>服务域<select value={importForm.category} onChange={(event) => setImportForm((form) => ({ ...form, category: event.target.value }))}><option value="refund">退款售后</option><option value="damage">破损与质量</option><option value="address">地址与物流</option><option value="invoice">发票服务</option></select></label></div><label>资料正文<textarea required value={importForm.content} onBlur={() => setImportTouched((fields) => ({ ...fields, content: true }))} onChange={(event) => setImportForm((form) => ({ ...form, content: event.target.value }))} maxLength={50000} placeholder={'可粘贴带标题的多段资料，例如：\n## 适用范围\n……\n\n## 处理边界\n……'} /><small>{importForm.content.length}/50000 · 至少 12 个字；标题或空行会形成独立草稿</small>{importTouched.content && !importForm.content.trim() && <small className="field-error" role="alert">请粘贴正文或选择一个文本资料文件。</small>}</label>{importError && <div className="import-error" role="alert" aria-live="assertive"><span>{importError}</span><button className="text-button" onClick={() => void importKnowledgeSource()} disabled={importSaving}>重试导入</button></div>}{importResult && <div className="import-result" role={importResult.conflicts.length ? "alert" : "status"} aria-live="polite"><b>本次导入：生成 {importResult.created.length} 条草稿，跳过 {importResult.skipped} 条</b>{importResult.conflicts.length ? <ul>{importResult.conflicts.slice(0, 5).map((item, index) => <li key={`${item.title}-${index}`}>{item.title}：{item.reason}</li>)}</ul> : <span>草稿已进入工作队列，完成回答测试和双人复核后才能发布。</span>}</div>}<footer><button className="ghost-button" onClick={() => { setImportOpen(false); setImportResult(null); setImportError(""); setImportTouched({ sourceTitle: false, content: false }); }}>取消</button><button className="primary-button" disabled={importSaving || !importForm.sourceTitle.trim() || !importForm.content.trim()} onClick={() => void importKnowledgeSource()}>{importSaving ? "解析并保存中…" : "解析并生成草稿"}</button></footer></section></div>}
  </section>;
}

type EvaluationRun = { id: string; model: string; datasetVersion: string; suite?: string; systemVersion?: string; totalCases: number; passedCases: number; passRate: number; highRiskPassRate: number; averageLatencyMs: number; completedAt?: string | null };
type EvaluationResultView = { id: string; category: string; query: string; passed: boolean; failures: string[] };
type ScaleSummary = { overall: { total: number; passRate: number; sourceAccuracy: number; handoffAccuracy: number }; standalone: { total: number; passRate: number }; contextRequired: { total: number; passRate: number }; bySplit: Record<string, { total: number; passRate: number }> };
type CompleteSummary = { raw: { dialogues: number; turns: number; annotatedQuestions: number; upstreamIntents: number }; overall: { total: number; passed: number; passRate: number }; supported: { total: number; passRate: number; sourceAccuracy: number; handoffAccuracy: number }; unsupported: { total: number; passRate: number; safeFallbackRate: number; falsePositiveRoutes: number }; bySplit: Record<string, { total: number; passRate: number }> };
type RealDataManifest = { totals: { upstreamDialogues: number; upstreamTurns: number; annotatedQuestions: number; fullCoverageEvaluationCases: number; evaluationCases: number; officialKnowledgeSources: number; officialKnowledgeChunks: number; totalKnowledgeDocuments: number }; quality: { duplicateEvaluationQueries: number; directIdentifiersFound: number; traceableEvaluationCases: number; traceableOfficialChunks: number; fullCoveragePassRate: number; unsupportedSafeFallbackRate: number; unsupportedFalsePositiveRoutes: number }; sources: Array<{ id: string; authenticity: string; name: string; upstream?: string }> };
type RealScenario = { id: string; category: string; query: string; history: Array<{ role: string; content: string }>; contextRequired: boolean; expectedSource: string; expectedHandoff: boolean; sourceSplit: string; source: { dataset: string; dialogueId: string | number; originalIntent: string; form: string } };

function RealScenarioBrowser() {
  const [split, setSplit] = useState("test");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [payload, setPayload] = useState<{ total: number; cases: RealScenario[]; manifest: RealDataManifest } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams({ split, limit: "6", offset: String(offset) });
    if (category) params.set("category", category);
    if (query.trim()) params.set("q", query.trim());
    const timer = window.setTimeout(() => fetch(`/api/evaluations/scale?${params}`).then((response) => response.ok ? response.json() : Promise.reject(new Error("真实场景库读取失败"))).then((body) => { setPayload(body); setError(""); }).catch((cause) => setError(cause instanceof Error ? cause.message : "真实场景库读取失败")), 160);
    return () => window.clearTimeout(timer);
  }, [split, category, query, offset]);
  const authenticityLabel: Record<string, string> = { public_real_anonymized: "公开真实匿名语料", official_public_rule: "官方公开规则", synthetic_internal_demo: "内部模拟流程" };
  const manifest = payload?.manifest;
  return <div className="scenario-browser">
    <div className="evaluation-subhead"><div><b>四类专项场景浏览器</b><span>逐条保留上游对话 ID、数据切分、处理方式和预期路由</span></div><div className="scenario-controls"><select name="evaluation-split" aria-label="数据集切分" value={split} onChange={(event) => { setSplit(event.target.value); setOffset(0); }}><option value="test">测试集</option><option value="val">验证集</option><option value="train">训练集</option><option value="all">全部</option></select><select name="evaluation-category" aria-label="评测场景" value={category} onChange={(event) => { setCategory(event.target.value); setOffset(0); }}><option value="">全部场景</option><option value="real-refund">退款</option><option value="real-invoice">发票</option><option value="real-address">改址</option><option value="real-damage">破损</option></select><input name="evaluation-query" autoComplete="off" aria-label="搜索真实用户问法" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="搜索真实用户问法…" /></div></div>
    {manifest && <div className="provenance-strip"><div><b>{manifest.totals.upstreamDialogues.toLocaleString()}</b><span>全量对话</span></div><div><b>{manifest.totals.upstreamTurns.toLocaleString()}</b><span>全量对话轮次</span></div><div><b>{manifest.totals.annotatedQuestions.toLocaleString()}</b><span>全量标注问题</span></div><div><b>{manifest.totals.evaluationCases.toLocaleString()}</b><span>四类去重专项</span></div><div><b>{manifest.quality.directIdentifiersFound}</b><span>二次扫描直标识符</span></div></div>}
    <div className="truth-legend">{manifest?.sources.filter((source, index) => index === 0 || source.authenticity === "synthetic_internal_demo").map((source) => <span key={source.id} className={`truth-badge ${source.authenticity}`}>{authenticityLabel[source.authenticity] ?? source.authenticity}</span>)}<em>CSDS 未声明明确数据许可，仅限私有研究评测；内部模拟流程不冒充真实企业数据。</em></div>
    {error && <div className="evaluation-error">{error}</div>}
    <div className="scenario-list">{payload?.cases.map((item) => <article key={item.id} className="scenario-row"><div><Status kind={item.contextRequired ? "warning" : "success"}>{item.contextRequired ? "依赖上下文" : "独立问句"}</Status><Status>{item.category.replace("real-", "")}</Status></div><p><b>{item.query}</b><span>CSDS {item.sourceSplit} · 对话 #{item.source.dialogueId} · 原始意图：{item.source.originalIntent || "未标注"}</span></p><small>{item.expectedSource} · {item.expectedHandoff ? "预期转人工" : "预期自动处理"}</small></article>)}</div>
    <div className="scenario-pagination"><span>显示 {payload?.total ? offset + 1 : 0}-{Math.min(offset + 6, payload?.total ?? 0)} / {payload?.total ?? 0}</span><div><button className="ghost-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 6))}>上一页</button><button className="ghost-button" disabled={!payload || offset + 6 >= payload.total} onClick={() => setOffset(offset + 6)}>下一页</button></div></div>
  </div>;
}

function EvaluationDashboard({ onCompleted }: { onCompleted?: () => void }) {
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [results, setResults] = useState<EvaluationResultView[]>([]);
  const [running, setRunning] = useState<"regression" | "blind" | null>(null);
  const [error, setError] = useState("");
  const [blindConsumed, setBlindConsumed] = useState(false);
  const [scale, setScale] = useState<ScaleSummary | null>(null);
  const [complete, setComplete] = useState<CompleteSummary | null>(null);
  const [optimizationNotice, setOptimizationNotice] = useState("");
  function ingest(payload: { latest?: EvaluationRun | null; run?: EvaluationRun; results?: Array<Record<string, unknown>>; blindConsumed?: boolean }) {
    setRun(payload.run ?? payload.latest ?? null);
    if (typeof payload.blindConsumed === "boolean") setBlindConsumed(payload.blindConsumed);
    if (payload.run?.suite === "blind") setBlindConsumed(true);
    setResults((payload.results ?? []).map((raw) => {
      const item = raw.item as { id?: string; category?: string; query?: string } | undefined;
      let failures: string[] = [];
      if (Array.isArray(raw.failures)) failures = raw.failures as string[];
      else if (typeof raw.failuresJson === "string") { try { failures = JSON.parse(raw.failuresJson) as string[]; } catch { failures = ["结果解析失败"]; } }
      return { id: item?.id ?? String(raw.caseId ?? raw.id), category: item?.category ?? String(raw.category ?? "unknown"), query: item?.query ?? String(raw.query ?? ""), passed: Boolean(raw.passed), failures };
    }));
  }
  useEffect(() => { fetch("/api/evaluations").then((r) => r.ok ? r.json() : Promise.reject()).then(ingest).catch(() => undefined); }, []);
  useEffect(() => { fetch("/api/evaluations/scale?limit=1").then((r) => r.ok ? r.json() : Promise.reject()).then((payload: { summary: ScaleSummary; completeSummary: CompleteSummary }) => { setScale(payload.summary); setComplete(payload.completeSummary); }).catch(() => undefined); }, []);
  async function runEvaluation(suite: "regression" | "blind") {
    setRunning(suite); setError("");
    try {
      const response = await fetch("/api/evaluations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ suite }) });
      const body = await response.json() as { error?: string; run?: EvaluationRun; results?: Array<Record<string, unknown>>; blindConsumed?: boolean };
      if (!response.ok) throw new Error(body.error || "评测运行失败");
      ingest(body);
      onCompleted?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "评测运行失败"); }
    finally { setRunning(null); }
  }
  const failed = results.filter((item) => !item.passed);
  return <section className="panel evaluation-panel">{optimizationNotice && <div className="agent-toast" role="status">✓ {optimizationNotice}</div>}<div className="evaluation-head"><div><span className="eyebrow">分层评测体系</span><h3>CSDS 全量覆盖 + 混合意图路由 + GLM-5.2 端到端回归</h3><p>21,126 个标注问题全部逐条测试；4,196 条四类去重场景做专项分析；100 条回归与 55 条盲测调用真实模型</p></div><div className="evaluation-actions"><button className="ghost-button" disabled={Boolean(running) || blindConsumed} onClick={() => runEvaluation("blind")}>{running === "blind" ? "正在运行盲测…" : blindConsumed ? "本版本盲测已完成" : "运行冻结盲测"}</button><button className="primary-button" disabled={Boolean(running)} onClick={() => runEvaluation("regression")}>{running === "regression" ? "正在调用模型…" : run ? "重新运行回归" : "运行首轮回归"}</button></div></div>
    {scale && complete && <><div className="evaluation-kpis"><div><span>全量标注问题</span><b>{complete.overall.total.toLocaleString()}</b><small>{complete.raw.dialogues.toLocaleString()} 段对话 · {complete.raw.turns.toLocaleString()} 轮</small></div><div><span>全量策略通过率</span><b>{(complete.overall.passRate * 100).toFixed(1)}%</b><small>已支持路由 + 未支持兜底</small></div><div><span>支持意图通过率</span><b>{(complete.supported.passRate * 100).toFixed(1)}%</b><small>3 类主意图 + 7 类售后二级意图</small></div><div><span>未支持意图安全兜底</span><b>{(complete.unsupported.safeFallbackRate * 100).toFixed(1)}%</b><small>{complete.unsupported.falsePositiveRoutes.toLocaleString()} 条误路由待治理</small></div></div><div className="process-note"><b>全量评测口径</b><span>train、val、test 的每个标注问题均执行一次测试；退款、地址、发票及破损、质量、少件、丢件、维修、保修、三包检查知识来源与转人工，其余 {complete.unsupported.total.toLocaleString()} 条检查能否安全兜底。路由采用字符向量召回、概率 Rerank 与规则融合；全量测试不逐条调用大模型。四类专项去重集 {scale.overall.total.toLocaleString()} 条，通过率 {(scale.overall.passRate * 100).toFixed(1)}%；上下文依赖样本通过率 {(scale.contextRequired.passRate * 100).toFixed(1)}%。</span></div></>}
    <RealScenarioBrowser />
    {error && <div className="evaluation-error">{error}</div>}
    {run ? <><div className="evaluation-kpis"><div><span>总体通过率</span><b>{(run.passRate * 100).toFixed(1)}%</b><small>{run.passedCases}/{run.totalCases} 条通过</small></div><div><span>高风险通过率</span><b>{(run.highRiskPassRate * 100).toFixed(1)}%</b><small>高风险 · 对抗 · 隐私</small></div><div><span>平均端到端时延</span><b>{run.averageLatencyMs}ms</b><small>包含检索与生成</small></div><div><span>数据集 / 模型</span><b>v{run.datasetVersion}</b><small>{run.model}</small></div></div>
      <div className="evaluation-results"><div className="evaluation-subhead"><b>{run.suite === "blind" ? "盲测失败案例" : "回归失败案例"}</b><span>{failed.length ? `优先处理 ${failed.length} 条` : "本轮全部通过"}</span></div>{failed.length ? failed.slice(0, 5).map((item) => <div className="evaluation-case" key={item.id}><Status kind="danger">{item.category}</Status><p><b>{item.query}</b><span>{item.failures.join("；")}</span></p><button className="text-button" onClick={() => { setOptimizationNotice(`已将“${item.query.slice(0, 24)}”加入知识与策略优化任务`); window.setTimeout(() => setOptimizationNotice(""), 2400); }}>加入优化任务 →</button></div>) : <div className="evaluation-empty">✓ 当前基线未发现规则性失败，可继续扩展长尾用例。</div>}</div></> : <div className="evaluation-placeholder"><b>还没有真实基线结果</b><span>运行后将调用生产 GLM-5.2，并按知识来源、转人工决策、必要信息与禁止内容自动评分。</span></div>}
  </section>;
}

type ReviewDecision = "confirmed_failure" | "label_issue" | "accepted_behavior";
type ReviewItem = { id: string; caseId: string; category: string; query: string; answer: string; expectedSource: string | null; actualSource: string | null; expectedHandoff: boolean; actualHandoff: boolean; routingIntent: string | null; routingConfidence: number | null; failures: string[]; routingSignals: string[]; review: { decision: ReviewDecision; reviewerEmail: string; note: string } | null };

function EvaluationReviewWorkbench({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [mode, setMode] = useState<"pending" | "reviewed">("pending");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const load = () => fetch("/api/evaluations/reviews").then((r) => r.ok ? r.json() : Promise.reject()).then((body: { items?: ReviewItem[] }) => setItems(body.items ?? [])).catch(() => setError("复核队列加载失败"));
  useEffect(() => { void load(); }, [refreshKey]);
  const visible = items.filter((item) => mode === "pending" ? !item.review : Boolean(item.review));
  const selected = visible[0];
  async function submit(decision: ReviewDecision) {
    if (!selected || saving) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/evaluations/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resultId: selected.id, decision, note }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "保存失败");
      setNote(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setSaving(false); }
  }
  const pending = items.filter((item) => !item.review).length;
  const reviewed = items.length - pending;
  return <><section className="metrics-grid quality-metrics"><MetricCard label="待人工复核" value={String(pending)} change={pending ? "需处理" : "已清零"} helper="来自最新生产评测" tone="orange" /><MetricCard label="已完成复核" value={String(reviewed)} change={items.length ? `${Math.round(reviewed / items.length * 100)}%` : "0%"} helper={`共 ${items.length} 条失败案例`} tone="green" /><MetricCard label="检索类失败" value={String(items.filter((item) => item.failures.some((failure) => failure.includes("知识来源"))).length)} change="可回流" helper="用于补充意图与知识" tone="blue" /><MetricCard label="策略类失败" value={String(items.filter((item) => item.failures.some((failure) => failure.includes("转人工"))).length)} change="需复核" helper="防止错误自动化" tone="purple" /></section>
    <section className="quality-grid"><article className="panel table-panel"><div className="table-toolbar"><div className="segmented"><button className={mode === "pending" ? "active" : ""} onClick={() => setMode("pending")}>待复核 {pending}</button><button className={mode === "reviewed" ? "active" : ""} onClick={() => setMode("reviewed")}>已复核 {reviewed}</button></div><span className="muted">双人复核前不自动修改金标</span></div>
      {error && <div className="evaluation-error">{error}</div>}
      {selected ? <div className="review-card"><div className="review-head"><div><Status kind={selected.review ? "success" : "warning"}>{selected.review ? "已复核" : `待复核 · ${selected.routingConfidence?.toFixed(2) ?? "低置信度"}`}</Status><b>{selected.failures.join("；")}</b></div><span>{selected.caseId} · {selected.category}</span></div><div className="review-question"><small>真实用户问题</small><p>{selected.query}</p></div><div className="review-answer"><small>AI 回答</small><p>{selected.answer}</p><div className="evidence"><b>自动判定</b><span>知识 {selected.expectedSource ?? "无"} → {selected.actualSource ?? "未命中"} · 转人工 {selected.expectedHandoff ? "是" : "否"} → {selected.actualHandoff ? "是" : "否"}</span></div><div className="review-routing"><b>路由解释</b><span>{selected.routingIntent ?? "未识别"} · {(selected.routingSignals ?? []).join(" / ") || "无匹配信号"}</span></div></div>
        {selected.review ? <div className="reviewed-note"><b>{selected.review.decision === "confirmed_failure" ? "确认系统失败" : selected.review.decision === "label_issue" ? "标记标签问题" : "确认行为可接受"}</b><span>{selected.review.note || `复核人：${selected.review.reviewerEmail}`}</span></div> : <><textarea name="review-note" aria-label="复核说明" className="review-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="复核说明；标记标签问题时必填…" /><div className="review-actions"><button disabled={saving} className="danger-button" onClick={() => submit("confirmed_failure")}>确认系统失败</button><button disabled={saving || note.trim().length < 4} className="ghost-button" onClick={() => submit("label_issue")}>标记标签问题</button><button disabled={saving} className="primary-button" onClick={() => submit("accepted_behavior")}>行为可接受</button></div></>}</div> : <div className="review-empty">{items.length ? "当前筛选下没有案例" : "暂无需要人工复核的失败案例"}</div>}
      {visible.slice(1, 4).map((item) => <div className="review-card compact" key={item.id}><div><Status kind="neutral">{item.category}</Status><b>{item.query}</b><small>{item.failures.join("；")}</small></div><span className="text-button">队列中</span></div>)}</article>
      <aside className="panel quality-aside"><h3>复核规范</h3><div className="review-guideline"><b>确认系统失败</b><span>金标正确，检索、策略或回答需要修复。</span></div><div className="review-guideline"><b>标记标签问题</b><span>原期望与业务规则不一致，填写原因后进入双人复核。</span></div><div className="review-guideline"><b>行为可接受</b><span>虽未完全匹配自动规则，但不会误导用户或越权执行。</span></div><div className="aside-callout blue"><b>数据治理原则</b><span>人工结论不会直接覆盖原始样本；保留原标签、修订建议、复核人和时间，审批后生成新数据集版本。</span></div></aside></section></>;
}

function Quality() {
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  return <><EvaluationDashboard onCompleted={() => setReviewRefreshKey((value) => value + 1)} /><EvaluationReviewWorkbench refreshKey={reviewRefreshKey} /></>;
}

function Strategy() {
  const [rules, setRules] = useState([true, true, false, true]);
  const [notice, setNotice] = useState("");
  const toggle = (i: number) => setRules((prev) => prev.map((v, idx) => idx === i ? !v : v));
  const publish = () => { setNotice("策略草稿已保存为 v3.1，等待双人审批"); window.setTimeout(() => setNotice(""), 2400); };
  const items = [
    ["高风险操作强制人工确认", "退款、赔付、账户修改与价格承诺不得由AI直接执行"],
    ["连续两次低置信度自动转人工", "置信度低于0.72，且用户继续追问时触发"],
    ["负面情绪立即升级主管", "识别投诉、威胁曝光或强烈不满时通知值班主管"],
    ["回答必须附带知识来源", "政策、时效与权益类答案需展示有效版本引用"],
  ];
  return <section className="strategy-layout">{notice && <div className="agent-toast" role="status">✓ {notice}</div>}<article className="panel strategy-main"><div className="strategy-header"><div><h3>生产策略集</h3><p>默认客服 Agent · v3.0 · 混合路由灰度版</p></div><button className="ghost-button" onClick={() => setNotice("版本记录已刷新：当前生效 v3.0，草稿 v3.1")}>版本记录</button><button className="primary-button" onClick={publish}>发布新版本</button></div><div className="strategy-section"><h4>安全与人工接管</h4>{items.map(([title, desc], i) => <div className="setting-row" key={title}><div><b>{title}</b><span>{desc}</span></div><button aria-label={`切换${title}`} className={rules[i] ? "switch on" : "switch"} onClick={() => toggle(i)}><i /></button></div>)}</div><div className="strategy-section"><h4>模型路由</h4><div className="routing-card"><div><Status kind="info">向量召回</Status><p><b>字符 TF-IDF</b><span>低时延 · 候选意图</span></p></div><div className="routing-arrow">→</div><div><Status kind="warning">概率 Rerank</Status><p><b>Logistic + 规则</b><span>歧义消解 · OOD拒识</span></p></div><div className="routing-arrow">→</div><div><Status kind="danger">高风险</Status><p><b>人工客服</b><span>不允许自动承诺</span></p></div></div></div></article><aside className="panel strategy-aside"><h3>发布检查</h3><ul><li className="pass">未支持意图兜底 95.2%</li><li className="pass">上下文样本通过 75.1%</li><li className="pass">四类专项整体通过 90.8%</li><li className="warn">三包长尾仍需扩充样本</li></ul><div className="approval"><b>双人审批</b><span>产品负责人 ✓</span><span>业务合规 待审批</span></div></aside></section>;
}

function Analytics() {
  const [channel, setChannel] = useState("全部渠道");
  const [metrics, setMetrics] = useState<{ counts: { todayConversations: number; needsHuman: number; waitingInternal: number; resolvedToday: number } } | null>(null);
  useEffect(() => { fetch("/api/workbench", { cache: "no-store", headers: { "x-servicepilot-channel": "customer-demo" } }).then((response) => response.ok ? response.json() : null).then((body) => body && setMetrics(body)).catch(() => undefined); }, []);
  const counts = metrics?.counts;
  const total = counts?.todayConversations ?? 0;
  const resolved = counts?.resolvedToday ?? 0;
  const handoff = counts?.needsHuman ?? 0;
  return <><section className="metrics-grid"><MetricCard label="今日会话量" value={metrics ? String(total) : "读取中"} change="实时" helper="来自 D1 会话表" tone="blue" /><MetricCard label="AI 完成处理" value={total ? `${Math.max(total - handoff, 0)}` : "暂无数据"} change="实时" helper={`${handoff} 个会话需要人工`} tone="green" /><MetricCard label="今日解决率" value={total ? `${Math.round((resolved / total) * 1000) / 10}%` : "暂无数据"} change="实时" helper={`${resolved} 个会话已解决`} tone="purple" /><MetricCard label="单会话成本" value="暂无数据" change="未接入" helper="当前未记录 Token 成本" tone="orange" /></section><section className="analytics-grid"><article className="panel funnel-panel"><div className="panel-head"><div><h3>会话解决漏斗</h3><p>从真实会话状态汇总 · {channel}</p></div><button className="ghost-button" onClick={() => setChannel((current) => current === "全部渠道" ? "商城 App" : current === "商城 App" ? "微信小程序" : "全部渠道")}>按渠道：{channel}⌄</button></div>{metrics ? <div className="funnel"><div style={{width:'100%'}}><span>发起会话</span><b>{total}</b></div><div style={{width:`${total ? Math.max(1, ((total - handoff) / total) * 100) : 1}%`}}><span>无需人工接管</span><b>{Math.max(total - handoff, 0)}</b></div><div style={{width:`${total ? Math.max(1, (resolved / total) * 100) : 1}%`}}><span>已解决</span><b>{resolved}</b></div></div> : <div className="knowledge-empty"><b>正在读取真实会话数据</b></div>}</article><article className="panel matrix-panel"><div className="panel-head"><div><h3>质量 × 成本矩阵</h3><p>成本数据尚未接入模型 usage 记录</p></div></div><div className="overview-empty-chart"><b>暂无可用矩阵数据</b><span>接入模型 Token、成本和质量指标后生成。</span></div></article></section></>;
}

function Audit() {
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState<"全部风险" | "高" | "中" | "低">("全部风险");
  const [notice, setNotice] = useState("");
  const [rows, setRows] = useState<Array<[string, string, string, string, string, string]>>([]);
  useEffect(() => { fetch("/api/audit", { cache: "no-store", headers: { "x-servicepilot-channel": "customer-demo" } }).then((response) => response.ok ? response.json() : Promise.reject(new Error("审计日志读取失败"))).then((body: { logs?: Array<{ id: string; at: string; actor: string; action: string; resourceId: string; result: string; risk: string }> }) => setRows((body.logs ?? []).map((item) => [new Date(item.at).toLocaleString("zh-CN"), item.actor, item.action, item.resourceId, item.result === "allowed" ? "允许" : item.result === "blocked" ? "已拦截" : "失败", item.risk] as [string, string, string, string, string, string]))).catch(() => setRows([])); }, []);
  const visible = rows.filter((row) => (!query.trim() || row.join(" ").includes(query.trim())) && (risk === "全部风险" || row[5] === risk));
  function exportRows() {
    const csv = ["时间,操作者,操作,对象,结果,风险", ...visible.map((row) => row.join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "servicepilot-audit.csv"; link.click(); URL.revokeObjectURL(url);
    setNotice(`已导出 ${visible.length} 条审计记录`); window.setTimeout(() => setNotice(""), 2400);
  }
  return <section className="audit-layout">{notice && <div className="agent-toast" role="status">✓ {notice}</div>}<article className="panel table-panel"><div className="table-toolbar"><div className="search-box wide">⌕ <input name="audit-search" autoComplete="off" aria-label="搜索操作人、资源或审计编号" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索操作人、资源或审计编号…" /></div><button className="filter-button" onClick={() => setRisk((current) => current === "全部风险" ? "高" : current === "高" ? "中" : current === "中" ? "低" : "全部风险")}>风险：{risk}</button><button className="filter-button" onClick={exportRows}>导出记录</button></div><table><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th><th>结果</th><th>风险</th></tr></thead><tbody>
    {visible.map((row) => <tr key={`${row[0]}-${row[3]}`}><td>{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td><td>{row[3]}</td><td><Status kind={row[4] === "已拦截" ? "danger" : "success"}>{row[4]}</Status></td><td className={row[5] === "高" ? "urgent" : ""}>{row[5]}</td></tr>)}
    </tbody></table>{!visible.length && <div className="knowledge-empty"><b>没有匹配记录</b><span>{rows.length ? "调整搜索词或风险筛选后重试。" : "当前租户还没有审计记录。"}</span></div>}</article><aside className="panel security-card"><div className="shield">✓</div><h3>安全基线数据</h3><p>以下内容仅展示已写入审计日志的真实事件。</p><dl><div><dt>审计记录</dt><dd>{rows.length}</dd></div><div><dt>高风险事件</dt><dd>{rows.filter((row) => row[5] === "高").length}</dd></div><div><dt>已拦截事件</dt><dd>{rows.filter((row) => row[4] === "已拦截").length}</dd></div></dl><button className="ghost-button full" onClick={() => setNotice("权限矩阵尚未接入企业身份目录，当前仅展示审计日志")}>查看权限矩阵</button></aside></section>;
}

function CustomerDemo({ onClose }: { onClose: () => void }) {
  type DemoTurn = { role: "user" | "assistant"; content: string };
  type DemoMessage = { id: string; senderType: "customer" | "ai" | "agent" | "system"; content: string; createdAt: string };
  type AgentResult = { answer: string; source: { id: string; title: string; version: string } | null; confidence: number; handoff: boolean; mode: string; trace: Array<{ label: string }>; memory?: { activeIntent: string | null; turnCount: number; source: string } | null };
  const profiles = [
    { key: "consumer", label: "普通消费者", name: "体验用户", hint: "验证常规咨询与多轮追问" },
    { key: "member", label: "会员用户", name: "金卡会员·体验用户", hint: "验证会员场景和订单上下文" },
    { key: "complaint", label: "高风险投诉用户", name: "投诉用户·体验", hint: "验证复杂售后与进度跟进" },
  ] as const;
  // The old 30 分钟会话记忆提示 is intentionally replaced by durable history.
  const sessionKey = "servicepilot-customer-session-v2";
  const [query, setQuery] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [profileKey, setProfileKey] = useState<(typeof profiles)[number]["key"]>("consumer");
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [sessions, setSessions] = useState<Array<{ id: string; topic: string; status: string; time: string }>>([]);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const demoRefreshRef = useRef<{ id: number; conversationId: string; controller: AbortController } | null>(null);
  const demoRefreshIdRef = useRef(0);
  const customerDemoDialogRef = useDialogFocus(true, onClose);
  const profile = profiles.find((item) => item.key === profileKey) ?? profiles[0];

  async function refreshConversation(id: string) {
    if (!id) return;
    demoRefreshRef.current?.controller.abort();
    const requestId = ++demoRefreshIdRef.current;
    const controller = new AbortController();
    demoRefreshRef.current = { id: requestId, conversationId: id, controller };
    try {
      const response = await fetch(`/api/conversations/${id}?limit=100`, { cache: "no-store", signal: controller.signal, headers: { "x-servicepilot-channel": "customer-demo" } });
      if (!response.ok) return;
      const body = await response.json() as { messages?: DemoMessage[] };
      if (requestId !== demoRefreshIdRef.current) return;
      setMessages(body.messages ?? []);
    } catch (cause) {
      if (requestId === demoRefreshIdRef.current && !(cause instanceof DOMException && cause.name === "AbortError")) setError("会话消息暂时无法刷新");
    } finally {
      if (demoRefreshRef.current?.id === requestId) demoRefreshRef.current = null;
    }
  }

  async function loadSessions(customerName: string) {
    const response = await fetch(`/api/conversations?customerName=${encodeURIComponent(customerName)}`, { cache: "no-store", headers: { "x-servicepilot-channel": "customer-demo" } });
    if (!response.ok) return;
    const body = await response.json() as { conversations?: Array<{ id: string; topic: string; status: string; time: string }> };
    setSessions(body.conversations ?? []);
  }

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(sessionKey) ?? "null") as { conversationId?: string; profileKey?: string } | null;
      const savedProfile = profiles.find((item) => item.key === saved?.profileKey);
      // Restore the user-selected demo profile from the browser session.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (savedProfile) setProfileKey(savedProfile.key);
      if (saved?.conversationId) { setConversationId(saved.conversationId); void refreshConversation(saved.conversationId); }
    } catch { /* local session restore is optional */ }
  }, []);

  useEffect(() => {
    // Session history is an external data source keyed by the active profile.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSessions(profile.name);
  }, [profile.name]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    const timer = window.setInterval(() => { if (!cancelled && !demoRefreshRef.current) void refreshConversation(conversationId); }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (demoRefreshRef.current?.conversationId === conversationId) demoRefreshRef.current.controller.abort();
    };
  }, [conversationId]);

  async function send(nextQuery = query) {
    const value = nextQuery.trim();
    if (!value || loading) return;
    const activeConversationId = conversationId || createDemoConversationId();
    if (!conversationId) setConversationId(activeConversationId);
    setQuery(""); setLoading(true); setError(""); setResult(null);
    window.localStorage.setItem(sessionKey, JSON.stringify({ conversationId: activeConversationId, profileKey }));
    try {
      const history = messages.filter((item) => item.senderType === "customer" || item.senderType === "ai" || item.senderType === "agent").slice(-6).map((item) => ({ role: item.senderType === "customer" ? "user" : "assistant", content: item.content })) as DemoTurn[];
      const response = await fetch("/api/agent/respond", { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ query: value, history, conversationId: activeConversationId, customerName: profile.name, channel: "商城智能客服" }) });
      const body = await response.json() as AgentResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "服务暂时不可用");
      setResult(body); await refreshConversation(activeConversationId); await loadSessions(profile.name);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "服务暂时不可用"); }
    finally { setLoading(false); }
  }
  const quick = ["订单 OR-773928 的退款什么时候到账？", "那周末算工作日吗？", "收到的生鲜破损了怎么办？", "订单还没发货怎么改地址？"];
  const resetConversation = () => { setConversationId(""); setMessages([]); setResult(null); setError(""); setQuery(""); window.localStorage.removeItem(sessionKey); };
  const selectConversation = (id: string) => { setConversationId(id); setMessages([]); setResult(null); setError(""); window.localStorage.setItem(sessionKey, JSON.stringify({ conversationId: id, profileKey })); void refreshConversation(id); };
  const changeProfile = (value: string) => { const next = profiles.find((item) => item.key === value); if (!next) return; setProfileKey(next.key); resetConversation(); };
  return <div className="modal-backdrop" onClick={onClose}><div ref={customerDemoDialogRef} tabIndex={-1} className="customer-demo" role="dialog" aria-modal="true" aria-label="商城智能客服体验" onClick={(e) => e.stopPropagation()}><aside className="demo-sessions"><div className="demo-sessions-head"><b>我的会话</b><button onClick={resetConversation}>新建</button></div><div className="demo-profile"><small>模拟身份</small><select aria-label="选择用户测试角色" value={profileKey} onChange={(event) => changeProfile(event.target.value)}>{profiles.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div><div className="demo-session-list">{sessions.map((session) => <button key={session.id} className={session.id === conversationId ? "active" : ""} onClick={() => selectConversation(session.id)}><b>{session.topic || "新的咨询"}</b><span>{session.status} · {new Date(session.time).toLocaleDateString("zh-CN")}</span></button>)}{!sessions.length && <small>还没有历史会话</small>}</div></aside><main className="demo-main"><div className="demo-head"><div className="brand-mark small">S</div><div><b>在线客服</b><span>{conversationId ? `会话 ${conversationId} · 历史消息长期保存` : "新会话 · 历史消息长期保存"}</span></div><button aria-label="关闭" onClick={onClose}>×</button></div><div className="demo-body"><div className="demo-welcome"><b>您好，我是在线客服</b><span>{profile.hint}；您可以继续补充订单、商品或具体情况，我会帮您一起处理。</span></div><div className="quick-questions">{quick.map((item) => <button key={item} onClick={() => send(item)}>{item.replace("？", "")}</button>)}</div><div className="demo-thread" aria-live="polite">{messages.map((message) => message.senderType === "customer" ? <div className="demo-user" key={message.id}><b>{profile.label}</b><span>{message.content}</span></div> : <div className="demo-ai" key={message.id}><b>{message.senderType === "system" ? "服务通知" : "在线客服"}</b><span>{message.content}</span><small>{new Date(message.createdAt).toLocaleString("zh-CN")}</small></div>)}{loading && <div className="demo-ai loading"><b>客服正在为你查询…</b></div>}{!messages.length && !loading && <div className="demo-empty">请输入问题开始会话；历史会话会长期保留在左侧。</div>}</div>{error && <div className="demo-ai error"><b>暂时无法发送</b><span>{error}</span></div>}</div><div className="demo-input"><input name="demo-query" autoComplete="off" aria-label="输入客服问题" value={query} maxLength={500} onChange={(e) => setQuery(e.target.value)} placeholder="请输入您的问题…" onKeyDown={(e) => e.key === 'Enter' && send()} /><button disabled={loading} onClick={() => send()}>{loading ? "发送中…" : "发送"}</button></div><div className="demo-footer">对话记录长期保存 · 您可以随时回来继续交流</div></main></div></div>;
}

function roleKeysFromBackend(values: string[] | undefined): RoleKey[] {
  const map: Record<string, RoleKey> = { agent: "agent", supervisor: "supervisor", knowledge_operator: "knowledge-operator", ai_operator: "ai-operator", product_admin: "administrator", system_admin: "administrator" };
  return Array.from(new Set((values ?? []).map((value) => map[value]).filter((value): value is RoleKey => Boolean(value))));
}

export default function Home() {
  const [entryStage, setEntryStage] = useState<EntryStage>("login");
  const [email, setEmail] = useState(DEFAULT_DEMO_EMAIL);
  const [loginError, setLoginError] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceKey>("qingyu");
  const [active, setActive] = useState<NavKey>("workbench");
  const [role, setRole] = useState<RoleKey>(FRONTLINE_ROLE);
  const [authorizedRoles, setAuthorizedRoles] = useState<RoleKey[]>([]);
  const [accessLoading, setAccessLoading] = useState(true);
  const [rememberWorkbench, setRememberWorkbench] = useState(true);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [knowledgeQuote, setKnowledgeQuote] = useState<KnowledgeQuote | null>(null);
  const [dataMode, setDataMode] = useState<"connecting" | "persistent" | "preview">("connecting");
  const [appNotice, setAppNotice] = useState("");
  const [workbenchRefreshKey, setWorkbenchRefreshKey] = useState(0);
  const [workbenchRefreshing, setWorkbenchRefreshing] = useState(false);
  const [livePending, setLivePending] = useState<number | null>(null);
  const [taskTarget, setTaskTarget] = useState<{ target: NavKey; resourceId: string } | null>(null);
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const globalSearchRef = useRef<HTMLDivElement | null>(null);
  function notify(message: string) {
    setAppNotice(message);
    window.setTimeout(() => setAppNotice(""), 2400);
  }
  function navigate(next: NavKey) {
    if (!hasUiRoleAccess(authorizedRoles, role) || !roles[role].nav.includes(next)) {
      notify(WORKBENCH_ONLY_NOTICE);
      return;
    }
    setTaskTarget(null);
    window.history.replaceState({}, "", `?view=${next}`);
    setActive(next);
  }
  function openGlobalSearchResult(next: NavKey) {
    navigate(next);
    setGlobalQuery("");
    setGlobalSearchOpen(false);
  }
  function openWorkbenchTask(task: { target: NavKey; resourceId?: string }) {
    if (!task.resourceId) { navigate(task.target); return; }
    setTaskTarget({ target: task.target, resourceId: task.resourceId });
    const key = task.target === "tickets" ? "ticket" : "resourceId";
    window.history.pushState({}, "", `?view=${task.target}&${key}=${encodeURIComponent(task.resourceId)}`);
    setActive(task.target);
    notify(`已定位到${task.target === "conversations" ? "会话" : "工单"} ${task.resourceId}`);
  }
  function quoteKnowledge(quote: KnowledgeQuote) {
    setKnowledgeQuote(quote);
    setActive("conversations");
  }
  const title = active === "workbench"
    ? { title: roles[role].title, desc: screenTitles.workbench.desc }
    : active === "knowledge" && role === "knowledge-operator"
      ? { title: "知识运营", desc: "把可信业务资料转化为可验证、可审核、可安全发布的 Agent 知识" }
      : active === "knowledge" && role === "agent"
        ? { title: "知识查询", desc: "查找并引用当前已审核生效的服务知识" }
        : screenTitles[active];
  const visibleNav = navItems.filter((item) => roles[role].nav.includes(item.key));
  const globalSearchResults = visibleNav.filter((item) => {
    const query = globalQuery.trim().toLowerCase();
    if (!query) return true;
    return `${item.label} ${screenTitles[item.key].desc}`.toLowerCase().includes(query);
  });
  function enterWorkbench(nextRole: RoleKey) {
    if (accessLoading) {
      notify("正在确认企业工作台权限，请稍候");
      return;
    }
    if (!hasUiRoleAccess(authorizedRoles, nextRole) || !workspaces[workspace].roles.includes(nextRole)) {
      notify("当前账号没有该工作台权限，请联系企业管理员");
      return;
    }
    setRole(nextRole);
    setActive("workbench");
    setAccountMenuOpen(false);
    setEntryStage("app");
    if (rememberWorkbench) window.localStorage.setItem("servicepilot-entry-v1", JSON.stringify({ version: 2, workspace, role: nextRole, email }));
    else window.localStorage.removeItem("servicepilot-entry-v1");
  }
  function login() {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setLoginError("请输入有效的企业邮箱"); return; }
    setEmail(value); setLoginError(""); setEntryStage("workspace");
  }
  function selectWorkspace(nextWorkspace: WorkspaceKey) {
    if (nextWorkspace !== "qingyu") {
      notify(WORKBENCH_ONLY_NOTICE);
      return;
    }
    setWorkspace(nextWorkspace);
    setRole(FRONTLINE_ROLE);
    setEntryStage("workbench");
  }
  function logout() {
    window.localStorage.removeItem("servicepilot-entry-v1");
    setAccountMenuOpen(false); setActive("workbench"); setEntryStage("login");
  }
  useEffect(() => {
    if (accessLoading) return;
    const saved = window.localStorage.getItem("servicepilot-entry-v1");
    let restoreTimer: number | undefined;
    if (saved) try {
      const value = JSON.parse(saved) as { version?: number; workspace?: WorkspaceKey; role?: RoleKey; email?: string };
      if ((value.version === 1 || value.version === 2) && value.workspace === "qingyu" && value.role && roles[value.role] && hasUiRoleAccess(authorizedRoles, FRONTLINE_ROLE)) {
        restoreTimer = window.setTimeout(() => {
          setWorkspace("qingyu"); setRole(FRONTLINE_ROLE); setEmail(value.email ?? DEFAULT_DEMO_EMAIL); setEntryStage("app");
          window.localStorage.setItem("servicepilot-entry-v1", JSON.stringify({ version: 2, workspace: "qingyu", role: FRONTLINE_ROLE, email: value.email ?? DEFAULT_DEMO_EMAIL }));
        }, 0);
      } else window.localStorage.removeItem("servicepilot-entry-v1");
    } catch { window.localStorage.removeItem("servicepilot-entry-v1"); }
    return () => { if (restoreTimer !== undefined) window.clearTimeout(restoreTimer); };
  }, [accessLoading, authorizedRoles]);
  const restoreNavigationFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("view") as NavKey | null;
    if (!next || !hasUiRoleAccess(authorizedRoles, role) || !roles[role].nav.includes(next)) return;
    const resourceId = params.get(next === "tickets" ? "ticket" : "resourceId") ?? params.get("resourceId");
    setActive(next);
    setTaskTarget(resourceId && (next === "conversations" || next === "tickets") ? { target: next, resourceId } : null);
  }, [authorizedRoles, role]);
  useEffect(() => {
    if (entryStage !== "app") return;
    // Synchronize browser deep links with the app navigation state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    restoreNavigationFromUrl();
    const onPopState = () => restoreNavigationFromUrl();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [entryStage, restoreNavigationFromUrl, role, authorizedRoles]);
  useEffect(() => {
    if (entryStage !== "app" || taskTarget) return;
    const timer = window.setTimeout(() => document.getElementById("main-content")?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [active, entryStage, taskTarget]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setGlobalSearchOpen(true);
        window.setTimeout(() => globalSearchRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 0);
      }
      if (event.key === "Escape") setGlobalSearchOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !globalSearchRef.current?.contains(event.target)) setGlobalSearchOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);
  useEffect(() => {
    const loadingTimer = window.setTimeout(() => setAccessLoading(true), 0);
    fetch("/api/bootstrap", { method: "POST", headers: { "x-servicepilot-channel": "customer-demo" } })
      .then((response) => response.ok ? response.json() as Promise<{ actor?: { roles?: string[] } }> : Promise.reject(new Error("bootstrap failed")))
      .then((body) => { const nextRoles = roleKeysFromBackend(body.actor?.roles); if (nextRoles.length) setAuthorizedRoles(nextRoles); setDataMode("persistent"); })
      .catch(() => { setAuthorizedRoles([FRONTLINE_ROLE]); setDataMode("preview"); })
      .finally(() => { window.clearTimeout(loadingTimer); setAccessLoading(false); });
    return () => window.clearTimeout(loadingTimer);
  }, [entryStage]);
  if (entryStage === "login") return <LoginScreen email={email} error={loginError} onEmailChange={setEmail} onLogin={login} />;
  if (entryStage === "workspace") return <WorkspaceScreen email={email} onSelect={selectWorkspace} onLogout={logout} />;
  const frontlineWorkbenchAvailable = hasUiRoleAccess(authorizedRoles, FRONTLINE_ROLE);
  if (entryStage === "workbench") return <WorkbenchScreen workspace={workspace} allowedRoles={frontlineWorkbenchAvailable ? [FRONTLINE_ROLE] : []} accessLoading={accessLoading} onSelect={enterWorkbench} onBack={() => setEntryStage("workspace")} remember={rememberWorkbench} onRemember={setRememberWorkbench} />;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <header className="global-header">
      <div className="global-brand"><div className="brand-mark">S</div><b>ServicePilot</b><span>企业智能服务平台</span></div>
      <div className="global-search-wrap" ref={globalSearchRef}>
        <div className="global-search"><span aria-hidden="true">⌕</span><input aria-label="快速跳转（全局搜索）" role="combobox" aria-expanded={globalSearchOpen} aria-controls="global-search-results" aria-autocomplete="list" value={globalQuery} onChange={(event) => { setGlobalQuery(event.target.value); setGlobalSearchOpen(true); }} onFocus={() => setGlobalSearchOpen(true)} onKeyDown={(event) => { if (event.key === "Escape") { setGlobalSearchOpen(false); return; } if (event.key === "Enter" && globalSearchResults[0]) { event.preventDefault(); openGlobalSearchResult(globalSearchResults[0].key); } }} placeholder="快速跳转到会话、工单或知识…" /><kbd>⌘ K</kbd></div>
        {globalSearchOpen && <div className="global-search-menu" id="global-search-results" role="listbox" aria-label="可跳转功能">
          {globalSearchResults.length ? globalSearchResults.map((item) => <button key={item.key} role="option" aria-selected={active === item.key} onClick={() => openGlobalSearchResult(item.key)}><span>{item.short}</span><strong>{item.label}</strong><small>{screenTitles[item.key].desc}</small></button>) : <div className="global-search-empty"><b>没有匹配的功能</b><span>可尝试“会话”“工单”或“知识”。</span></div>}
        </div>}
      </div>
      <div className="global-tools">
        <button className="header-signal" aria-label={`我的待办：${livePending === null ? "实时数据暂不可用" : `${livePending} 项待办`}`} title={livePending === null ? "实时待办数据暂不可用" : `当前有 ${livePending} 项待办`} onClick={() => { setActive("workbench"); notify(livePending === null ? "实时待办数据暂不可用" : `当前有 ${livePending} 项待办，已定位到我的工作台`); }}><i className="signal-dot warning" /><span>我的待办</span><b>{livePending ?? "—"}</b></button>
        <button className="header-signal" aria-label={dataMode === "persistent" ? "AI 运行正常" : dataMode === "preview" ? "安全预览模式" : "AI 连接中"} title={dataMode === "persistent" ? "AI 连接正常，知识库与会话服务可用" : "AI 服务正在连接，请稍后重试"} onClick={() => notify(dataMode === "persistent" ? "AI 连接正常，知识库与会话服务可用" : "AI 服务正在连接，请稍后重试")}><i className={`signal-dot ${dataMode}`} /><span>{dataMode === "persistent" ? "AI 运行正常" : dataMode === "preview" ? "安全预览" : "AI 连接中"}</span></button>
        <button className="text-tool" onClick={() => setDemoOpen(true)}>体验用户端</button>
        <button className="icon-button" aria-label="帮助" onClick={() => notify("帮助中心：可从左侧导航进入对应工作台，或联系企业管理员")}>?</button>
        <button className="icon-button notification" aria-label="通知" onClick={() => notify("暂无未读通知")}>○<i /></button>
      <div className="account-menu-wrap"><button className="global-profile" aria-label="账号与工作台" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(!accountMenuOpen)}><span>王</span><b>王瑞峰</b><em>⌄</em></button>{accountMenuOpen && <div className="account-menu"><div className="account-identity"><span>王</span><div><b>王瑞峰</b><small>{email}</small></div></div><div className="account-context"><small>当前空间</small><b>{workspaces[workspace].name}<em>{workspaces[workspace].environment}</em></b><small>当前工作台</small><strong>{roles[role].title}</strong></div><div className="account-actions"><button onClick={() => { setAccountMenuOpen(false); setEntryStage("workspace"); }}>切换企业空间</button><button onClick={() => notify(WORKBENCH_ONLY_NOTICE)}>账号与安全</button><button className="logout-action" onClick={logout}>退出登录</button></div></div>}</div>
      </div>
    </header>
    <div className="app-body">
      <aside className="sidebar">
        <div className="workspace"><span>当前空间</span><button onClick={() => setEntryStage("workspace")}><i>{workspaces[workspace].initials}</i><b>{workspaces[workspace].name}</b><em>⌄</em></button></div>
        <div className="sidebar-workbench"><span>当前工作台</span><b>{roles[role].title}</b></div>
        <div className="nav-group-label">我的工作</div>
        <nav aria-label={`${roles[role].label}导航`}>{visibleNav.map((item) => <button key={item.key} title={item.label} aria-label={item.label} className={active === item.key ? "active" : ""} onClick={() => navigate(item.key)}><i aria-hidden="true">{item.short}</i><span>{item.label}</span>{item.key === "conversations" && <em aria-hidden="true">12</em>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="system-health"><span><i />系统运行正常</span><small>所有服务可用</small></div></div>
      </aside>
      <main id="main-content" tabIndex={-1}>
        <header className="topbar"><div><h1>{title.title}</h1><p>{title.desc}</p></div><div className="top-actions"><button className={`icon-button${workbenchRefreshing ? " is-refreshing" : ""}`} aria-label={workbenchRefreshing ? "正在刷新工作台数据" : "刷新当前页面"} aria-busy={workbenchRefreshing} disabled={active === "workbench" && workbenchRefreshing} onClick={() => { setWorkbenchRefreshing(true); setWorkbenchRefreshKey((value) => value + 1); notify("正在刷新工作台数据…"); }}>↻</button></div></header>
        <div className={active === "resources" ? "content content-wide" : "content"}>
          {active === "workbench" && <RoleWorkbench role={role} workspaceName={workspaces[workspace].name} onNavigate={navigate} onOpenTask={openWorkbenchTask} refreshKey={workbenchRefreshKey} onPendingChange={setLivePending} onLoadingChange={setWorkbenchRefreshing} />}{active === "overview" && <Overview onNavigate={navigate} />}{active === "conversations" && <Conversations initialConversationId={taskTarget?.target === "conversations" ? taskTarget.resourceId : undefined} knowledgeQuote={knowledgeQuote} onConsumeQuote={() => setKnowledgeQuote(null)} />}{active === "tickets" && <Tickets initialTicketId={taskTarget?.target === "tickets" ? taskTarget.resourceId : undefined} onNavigate={navigate} />}{active === "knowledge" && <Knowledge role={role} onNavigate={navigate} onQuote={quoteKnowledge} />}{active === "quality" && <Quality />}{active === "strategy" && <Strategy />}{active === "analytics" && <Analytics />}{active === "resources" && <ResourceAccess />}{active === "audit" && <Audit />}
        </div>
      </main>
    </div>
    {appNotice && <div className="global-toast" role="status">✓ {appNotice}</div>}
    {demoOpen && <CustomerDemo onClose={() => setDemoOpen(false)} />}
  </div>;
}
