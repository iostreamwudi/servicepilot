"use client";

import { useEffect, useRef, useState } from "react";
import ResourceAccess from "./resource-access";

type NavKey = "workbench" | "overview" | "conversations" | "tickets" | "knowledge" | "quality" | "strategy" | "analytics" | "resources" | "audit";
type RoleKey = "supervisor" | "agent" | "knowledge-operator" | "ai-operator" | "administrator";
type EntryStage = "login" | "workspace" | "workbench" | "app";
type WorkspaceKey = "qingyu" | "servicepilot-sandbox";
const DEFAULT_DEMO_EMAIL = "wang.ruifeng@qingyu.cn";

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
  supervisor: { label: "服务主管", title: "服务主管工作台", greeting: "上午好，王瑞峰", focus: "先处理高风险服务与即将超时事项", nav: ["workbench", "overview", "conversations", "tickets", "analytics"] },
  agent: { label: "一线客服", title: "客服工作台", greeting: "上午好，王可", focus: "先接管即将超时的会话，让用户不必重复描述问题", nav: ["workbench", "conversations", "tickets", "knowledge"] },
  "knowledge-operator": { label: "知识运营", title: "知识运营工作台", greeting: "上午好，陈悠", focus: "优先修复影响真实会话的知识缺口与冲突", nav: ["workbench", "knowledge", "quality", "analytics"] },
  "ai-operator": { label: "AI 运营", title: "AI 运营工作台", greeting: "上午好，周敏", focus: "先修复影响范围最大的 AI 失败", nav: ["workbench", "quality", "knowledge", "strategy", "analytics"] },
  administrator: { label: "系统管理员", title: "治理工作台", greeting: "上午好，系统管理员", focus: "关注权限冲突、策略发布与高风险操作", nav: ["workbench", "resources", "audit", "strategy", "analytics"] },
};

const workspaces: Record<WorkspaceKey, { name: string; organization: string; environment: string; initials: string; roles: RoleKey[]; pending: number; lastUsed: string }> = {
  qingyu: { name: "青屿商城", organization: "青屿零售科技有限公司", environment: "生产环境", initials: "青", roles: ["supervisor", "agent", "knowledge-operator", "ai-operator"], pending: 17, lastUsed: "今天 10:46" },
  "servicepilot-sandbox": { name: "ServicePilot 沙箱", organization: "产品验证与培训空间", environment: "沙箱环境", initials: "S", roles: ["ai-operator", "administrator"], pending: 3, lastUsed: "昨天 18:42" },
};

type ConversationState = "待接管" | "处理中" | "等待内部" | "已解决";
type Conversation = {
  id: string;
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
  summary: string;
  draft: string;
  order: string;
  member: string;
  orderHistory: string;
  facts: Array<{ label: string; value: string; source: string }>;
  suggestedAction: string;
};

const conversations: Conversation[] = [
  { id: "C-28471", name: "林女士", topic: "退款进度查询", channel: "商城 App", status: "待接管", risk: "中", time: "2分钟前", sla: "剩余 4 分 18 秒", sentiment: "焦虑", handoff: "用户要求承诺今日到账，超出 AI 可承诺范围", customerMessage: "我的退款怎么还没有到账？昨天显示审核通过了，能帮我查一下吗？我今天急用，能不能今天到账？", aiReply: "您的退款已审核通过，预计将在 1–3 个工作日内原路退回。具体到账时间可能受到支付渠道影响。", summary: "用户查询昨日审核通过的退款，希望今日到账。系统确认退款状态正常，但支付渠道尚未返回具体入账时间。", draft: "您好，我已核验退款状态：今天 10:26 已审核通过，预计 1–3 个工作日原路退回。目前无法承诺今天到账，我可以继续为您核对支付渠道并跟进进度。", order: "OR-773928", member: "金卡会员", orderHistory: "近 90 天 12 单 · ¥2,418", facts: [{ label: "退款状态", value: "审核通过", source: "订单系统 · 10:26" }, { label: "退款金额", value: "¥328.00", source: "支付系统" }, { label: "到账时效", value: "1–3 个工作日", source: "退款规则 v3.4" }], suggestedAction: "核对支付渠道" },
  { id: "C-28469", name: "周先生", topic: "物流改址", channel: "微信小程序", status: "待接管", risk: "中", time: "5分钟前", sla: "剩余 7 分 42 秒", sentiment: "中性", handoff: "订单已出库，改址需要人工核验物流节点", customerMessage: "地址门牌号写错了，订单已经发货，还能帮我改一下吗？", aiReply: "订单发货后无法直接修改地址，我正在为您转接人工客服核验物流状态。", summary: "用户发现门牌号错误。订单已出库但尚未进入末端配送，需要联系承运商确认是否支持改址。", draft: "您好，我看到订单已经出库。我先为您核验当前物流节点和承运商改址能力，请不要在会话中发送完整身份证号。", order: "OR-773814", member: "普通会员", orderHistory: "近 90 天 3 单 · ¥526", facts: [{ label: "物流状态", value: "已出库", source: "物流系统 · 10:41" }, { label: "承运商", value: "顺路物流", source: "订单系统" }, { label: "敏感操作", value: "需要身份核验", source: "地址变更规范 v2.1" }], suggestedAction: "发起身份核验" },
  { id: "C-28463", name: "陈女士", topic: "商品破损理赔", channel: "商城 App", status: "等待内部", risk: "高", time: "11分钟前", sla: "剩余 18 分钟", sentiment: "强烈不满", handoff: "高风险理赔，需要人工确认凭证并等待主管审批", customerMessage: "收到的生鲜全都压坏了，照片已经上传，今天必须给我处理。", aiReply: "很抱歉影响了您的体验。破损理赔需要人工核验凭证，我已保留您上传的照片并转交处理。", summary: "用户提交 4 张破损照片并要求当日赔付。工单 T-9034 已创建，正在等待值班主管审批 ¥186 补偿方案。", draft: "您好，您的 4 张凭证已经核验完成，补偿方案正在加急审批。我会在审批完成后第一时间在当前会话通知您。", order: "OR-773641", member: "银卡会员", orderHistory: "近 90 天 7 单 · ¥1,162", facts: [{ label: "凭证", value: "4 张图片已核验", source: "附件识别 + 人工确认" }, { label: "关联工单", value: "T-9034", source: "工单系统" }, { label: "审批状态", value: "等待主管审批", source: "理赔流程" }], suggestedAction: "催办审批" },
  { id: "C-28458", name: "赵先生", topic: "发票抬头修改", channel: "网页端", status: "处理中", risk: "低", time: "18分钟前", sla: "已响应 · 12 分钟", sentiment: "中性", handoff: "用户已通过身份核验，等待客服确认新抬头", customerMessage: "发票还没开，抬头需要改成公司名称。", aiReply: "可以修改未开具发票的抬头，请准备企业名称与税号。", summary: "用户希望修改未开具发票抬头，身份核验已通过，等待确认企业名称和税号。", draft: "身份核验已经通过。请您确认企业名称和税号，发送时可对中间数字进行遮盖，我会在系统中完成核对。", order: "OR-773502", member: "普通会员", orderHistory: "近 90 天 2 单 · ¥899", facts: [{ label: "开票状态", value: "尚未开具", source: "发票系统" }, { label: "身份核验", value: "已通过", source: "账户安全服务" }, { label: "修改权限", value: "允许修改", source: "发票规则 v2.8" }], suggestedAction: "录入新抬头" },
  { id: "C-28444", name: "吴女士", topic: "会员权益咨询", channel: "商城 App", status: "已解决", risk: "低", time: "26分钟前", sla: "已完成 · 4 分 36 秒", sentiment: "满意", handoff: "用户主动要求人工解释积分有效期", customerMessage: "我的积分年底会全部过期吗？", aiReply: "不同批次积分有效期不同，可以在会员中心查看每笔积分的到期时间。", summary: "已向用户解释积分按批次失效，并引导查看明细；用户确认问题已解决。", draft: "", order: "无关联订单", member: "金卡会员", orderHistory: "近 90 天 9 单 · ¥1,784", facts: [{ label: "当前积分", value: "2,860", source: "会员系统" }, { label: "最近到期", value: "680 分 · 12月31日", source: "会员系统" }, { label: "解决确认", value: "用户已确认", source: "会话记录" }], suggestedAction: "查看结案记录" },
];

const tickets = [
  { id: "T-9034", title: "生鲜破损理赔", customer: "陈女士", priority: "P1", owner: "王可", sla: "剩余 18 分钟", state: "处理中" },
  { id: "T-9032", title: "退款到账异常", customer: "林女士", priority: "P1", owner: "待分配", sla: "剩余 36 分钟", state: "待领取" },
  { id: "T-9027", title: "地址修改失败", customer: "周先生", priority: "P2", owner: "李岩", sla: "剩余 2 小时", state: "等待用户" },
  { id: "T-9018", title: "发票信息更正", customer: "赵先生", priority: "P3", owner: "孙悦", sla: "已完成", state: "已解决" },
];

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

function Status({ children, kind = "neutral" }: { children: React.ReactNode; kind?: string }) {
  return <span className={`status ${kind}`}>{children}</span>;
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
    stats: [["待接管会话", "2", "最近超时 4 分 18 秒"], ["等待内部", "1", "理赔审批处理中"], ["今日已解决", "26", "72 小时未重开 88.5%"], ["平均人工响应", "41秒", "优于团队 8 秒"]],
    tasks: [
      { level: "需人工", title: "林女士询问退款今日能否到账", meta: "AI 无法承诺到账时间 · 已生成完整摘要", action: "接管会话", target: "conversations" },
      { level: "高风险", title: "陈女士商品破损理赔", meta: "用户不满 · 已关联工单 T-9034", action: "继续处理", target: "conversations" },
      { level: "待跟进", title: "周先生等待地址修改结果", meta: "已等待 43 分钟 · 建议主动告知进度", action: "发送进展", target: "tickets" },
    ],
    brief: [["人工有效解决", "88.5%", "72 小时未重开"], ["无需重复描述", "94.2%", "交接上下文完整"], ["我的 P1 工单", "2", "最近剩余 18 分钟"]],
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

function RoleWorkbench({ role, workspaceName, onNavigate }: { role: RoleKey; workspaceName: string; onNavigate: (key: NavKey) => void }) {
  const profile = roles[role];
  const data = roleWorkbench[role];
  const [liveAgentTasks, setLiveAgentTasks] = useState<Array<{ level: string; title: string; meta: string; action: string; target: NavKey }>>([]);
  useEffect(() => {
    if (role !== "agent") return;
    let mounted = true;
    async function loadAgentTasks() {
      try {
        const response = await fetch("/api/conversations", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { conversations?: Array<{ id: string; name: string; topic: string; status: string; risk: string; summary: string; sla: string }> };
        if (!mounted) return;
        setLiveAgentTasks((body.conversations ?? []).filter((item) => item.status === "待接管" || item.status === "等待内部").slice(0, 5).map((item) => ({
          level: item.status === "等待内部" ? "等待内部" : item.risk === "高" ? "高风险" : "需人工",
          title: `${item.name} · ${item.topic}`,
          meta: `${item.summary} · ${item.id}`,
          action: item.status === "待接管" ? "接管会话" : "继续处理",
          target: "conversations",
        })));
      } catch { /* keep the role baseline when the queue is temporarily unavailable */ }
    }
    loadAgentTasks();
    const timer = window.setInterval(loadAgentTasks, 5000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [role]);
  const priorityTasks = role === "agent" && liveAgentTasks.length ? liveAgentTasks : data.tasks;
  const stats = role === "agent" && liveAgentTasks.length ? data.stats.map(([label, value, helper], index) => index === 0 ? [label, String(liveAgentTasks.filter((task) => task.action === "接管会话").length), "来自真实会话队列"] as [string, string, string] : [label, value, helper] as [string, string, string]) : data.stats;
  return <section className="role-workbench">
    <header className="workbench-hero">
      <div><span className="workbench-eyebrow">{profile.label} · {workspaceName}</span><h2>{profile.greeting}</h2><p>{profile.focus}</p></div>
      <div className="workbench-date"><span>今日</span><b>8月13日 · 周四</b><small>数据更新于 10:46</small></div>
    </header>
    <section className="workbench-stats" aria-label="工作台概览">{stats.map(([label, value, helper]) => <article key={label}><span>{label}</span><b>{value}</b><small>{helper}</small></article>)}</section>
    <div className="workbench-grid">
      <article className="panel priority-panel"><div className="workbench-section-head"><div><h3>优先处理</h3><p>按业务影响、风险和剩余时间排序</p></div><button className="text-button">查看全部 17 项 →</button></div>
        <div className="priority-list">{priorityTasks.map((task, index) => <button key={task.title} onClick={() => onNavigate(task.target)}><span className={`priority-rank rank-${index + 1}`}>{index + 1}</span><span className="priority-copy"><em>{task.level}</em><b>{task.title}</b><small>{task.meta}</small></span><strong>{task.action} →</strong></button>)}</div>
      </article>
      <aside className="panel role-brief"><div className="workbench-section-head"><div><h3>今日简报</h3><p>与你当前工作台相关的关键结果</p></div></div>{data.brief.map(([label, value, helper]) => <div className="brief-row" key={label}><span>{label}</span><b>{value}</b><small>{helper}</small></div>)}<button className="brief-link" onClick={() => onNavigate("analytics")}>查看完整业务分析 →</button></aside>
    </div>
    <section className="panel role-shortcuts"><div><h3>常用工作</h3><p>只保留本工作台高频使用的入口</p></div><div>{profile.nav.filter((item) => item !== "workbench").slice(0, 4).map((key) => { const item = navItems.find((nav) => nav.key === key)!; return <button key={key} onClick={() => onNavigate(key)}><i>{item.short}</i><span><b>{item.label}</b><small>进入{item.label}</small></span><em>→</em></button>; })}</div></section>
  </section>;
}

function EntryBrand() {
  return <div className="entry-brand"><div className="brand-mark">S</div><div><b>ServicePilot</b><span>企业智能服务平台</span></div></div>;
}

function LoginScreen({ email, error, onEmailChange, onLogin }: { email: string; error: string; onEmailChange: (value: string) => void; onLogin: () => void }) {
  return <div className="entry-shell login-screen"><header><EntryBrand /><span>可信 Agent · 知识治理 · 安全审计</span></header><main className="login-main">
    <section className="login-story"><span className="entry-eyebrow">企业 AI 服务运营平台</span><h1>让每一次 AI 服务<br />都有依据、边界和改进闭环</h1><p>连接现有客服渠道、业务系统与企业知识，让常规问题安全自动解决，让高风险问题携带完整上下文交给正确的人。</p><div className="login-proof"><div><b>21,126</b><span>条标注问题全量评测</span></div><div><b>1,028</b><span>条可追溯知识</span></div><div><b>100%</b><span>高风险操作人工确认</span></div></div></section>
    <section className="login-card" aria-labelledby="login-title"><div className="login-card-head"><span className="secure-mark">企</span><div><h2 id="login-title">登录企业工作空间</h2><p>系统将根据企业身份读取你的空间和授权工作台</p></div></div><button className="sso-button" onClick={onLogin}><span>SSO</span>使用企业身份登录</button><div className="login-divider"><span>或使用企业邮箱</span></div><label>企业邮箱<input type="email" autoComplete="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="name@company.com" onKeyDown={(event) => event.key === "Enter" && onLogin()} /></label>{error && <div className="login-error" role="alert">{error}</div>}<button className="login-submit" onClick={onLogin}>继续</button><p className="login-policy">继续即表示你同意 <button>服务条款</button> 和 <button>隐私政策</button></p><div className="login-help"><span>登录遇到问题？</span><button>联系企业管理员</button></div></section>
  </main><footer><span>© 2026 ServicePilot</span><span>沪ICP备演示编号 · 数据安全说明</span></footer></div>;
}

function WorkspaceScreen({ email, onSelect, onLogout }: { email: string; onSelect: (key: WorkspaceKey) => void; onLogout: () => void }) {
  return <div className="entry-shell selection-screen"><header><EntryBrand /><div className="entry-account"><span>王</span><div><b>王瑞峰</b><small>{email}</small></div><button onClick={onLogout}>退出</button></div></header><main className="selection-main"><div className="selection-heading"><span className="entry-step">1 / 2</span><h1>选择工作空间</h1><p>你在多个企业空间中拥有访问权限。不同空间的数据和授权相互隔离。</p></div><div className="workspace-cards">{(Object.keys(workspaces) as WorkspaceKey[]).map((key) => { const item = workspaces[key]; return <button key={key} onClick={() => onSelect(key)}><span className="workspace-logo">{item.initials}</span><span className="workspace-copy"><span><b>{item.name}</b><em className={item.environment === "生产环境" ? "production" : "sandbox"}>{item.environment}</em></span><small>{item.organization}</small><small>{item.roles.length} 个授权工作台 · {item.pending} 项待办</small></span><span className="workspace-last"><small>最近访问</small><b>{item.lastUsed}</b><em>→</em></span></button>; })}</div><div className="selection-note"><span>i</span><p><b>找不到企业空间？</b>你的身份已经验证，但访问权限由企业管理员统一授予。<button>申请访问</button></p></div></main><footer><button>帮助中心</button><button>隐私与安全</button><span>当前登录：{email}</span></footer></div>;
}

function WorkbenchScreen({ workspace, onSelect, onBack, remember, onRemember }: { workspace: WorkspaceKey; onSelect: (role: RoleKey) => void; onBack: () => void; remember: boolean; onRemember: (value: boolean) => void }) {
  const current = workspaces[workspace];
  return <div className="entry-shell selection-screen"><header><EntryBrand /><div className="selected-space"><span>{current.initials}</span><div><b>{current.name}</b><small>{current.environment}</small></div></div></header><main className="selection-main"><button className="selection-back" onClick={onBack}>← 返回选择空间</button><div className="selection-heading"><span className="entry-step">2 / 2</span><h1>选择本次工作台</h1><p>这里只显示管理员已授权给你的工作台。选择会改变首页与导航，不会新增权限。</p></div><div className="workbench-cards">{current.roles.map((key) => { const item = roles[key]; const pending = roleWorkbench[key].tasks.length; return <button key={key} onClick={() => onSelect(key)}><span className="workbench-card-icon">{item.label[0]}</span><span className="workbench-card-copy"><span><b>{item.title}</b>{key === "supervisor" && <em>最近使用</em>}</span><p>{item.focus}</p><small>{pending} 类优先任务 · {item.nav.length - 1} 个常用功能</small></span><span className="workbench-enter">进入 →</span></button>; })}</div><label className="remember-workbench"><input type="checkbox" checked={remember} onChange={(event) => onRemember(event.target.checked)} /><span><b>记住本次选择</b><small>下次登录后直接进入该空间和工作台，可在账号菜单中修改</small></span></label></main><footer><span>工作台权限由青屿商城企业管理员维护</span><button>查看我的权限</button></footer></div>;
}

function Overview({ onNavigate }: { onNavigate: (key: NavKey) => void }) {
  return (
    <>
      <section className="metrics-grid">
        <MetricCard label="自助解决率" value="68.4%" change="+4.2%" helper="目标 72% · 较上周" tone="blue" />
        <MetricCard label="一次解决率" value="81.7%" change="+2.8%" helper="人工与 AI 综合" tone="green" />
        <MetricCard label="转人工率" value="22.6%" change="-3.1%" helper="风险转接占 8.4%" tone="purple" />
        <MetricCard label="用户满意度" value="4.63" change="+0.12" helper="基于 1,286 份评价" tone="orange" />
      </section>

      <section className="overview-grid">
        <article className="panel performance-panel">
          <div className="panel-head"><div><h3>服务趋势</h3><p>过去 7 天的解决率与转人工率</p></div><button className="ghost-button">近 7 天⌄</button></div>
          <div className="chart-legend"><span><i className="legend-blue" />自助解决率</span><span><i className="legend-violet" />转人工率</span></div>
          <div className="line-chart" aria-label="服务趋势图">
            <div className="grid-line g1" /><div className="grid-line g2" /><div className="grid-line g3" /><div className="grid-line g4" />
            <div className="area-shape" />
            <div className="trend-line blue-line"><i /><i /><i /><i /><i /><i /><i /></div>
            <div className="trend-line violet-line"><i /><i /><i /><i /><i /><i /><i /></div>
            <div className="chart-axis"><span>周一</span><span>周二</span><span>周三</span><span>周四</span><span>周五</span><span>周六</span><span>今日</span></div>
          </div>
        </article>

        <article className="panel risk-panel">
          <div className="panel-head"><div><h3>今日风险</h3><p>按影响程度排序</p></div><span className="alert-count">3</span></div>
          <button className="risk-item" onClick={() => onNavigate("knowledge")}><span className="risk-dot high" /><div><b>破损赔付知识命中率下降</b><small>较基线下降 9.6%，影响 37 次会话</small></div><em>去处理</em></button>
          <button className="risk-item" onClick={() => onNavigate("tickets")}><span className="risk-dot medium" /><div><b>2 个 P1 工单即将超时</b><small>退款异常 · 生鲜破损理赔</small></div><em>去处理</em></button>
          <button className="risk-item" onClick={() => onNavigate("quality")}><span className="risk-dot low" /><div><b>自动质检待人工复核</b><small>14 条低置信度结果等待确认</small></div><em>去处理</em></button>
        </article>
      </section>

      <section className="overview-grid lower">
        <article className="panel intent-panel">
          <div className="panel-head"><div><h3>高频咨询意图</h3><p>今日 3,842 次会话</p></div><button className="text-button" onClick={() => onNavigate("analytics")}>查看分析 →</button></div>
          {[['物流进度', 29, '1,114'], ['退款售后', 23, '884'], ['商品咨询', 18, '692'], ['会员权益', 13, '499'], ['发票问题', 9, '346']].map(([name, pct, count]) => (
            <div className="bar-row" key={name}><span>{name}</span><div className="bar-track"><i style={{ width: `${pct}%` }} /></div><b>{count}</b><small>{pct}%</small></div>
          ))}
        </article>
        <article className="panel activity-panel">
          <div className="panel-head"><div><h3>实时动态</h3><p>跨角色协作记录</p></div><button className="text-button" onClick={() => onNavigate("audit")}>全部记录 →</button></div>
          <div className="timeline">
            <div><i className="avatar blue">王</i><p><b>王可</b> 接管了高风险会话 <a>C-28463</a><small>2分钟前</small></p></div>
            <div><i className="avatar purple">AI</i><p><b>质检 Agent</b> 标记“引用依据不足”<small>8分钟前 · 置信度 0.67</small></p></div>
            <div><i className="avatar green">知</i><p><b>知识运营</b> 发布退款规则 v3.4<small>18分钟前 · 已通过双人复核</small></p></div>
            <div><i className="avatar orange">策</i><p><b>系统管理员</b> 调整 P1 升级策略<small>42分钟前 · 审计编号 A-9218</small></p></div>
          </div>
        </article>
      </section>
    </>
  );
}

function Conversations() {
  type QueueFilter = "待接管" | "处理中" | "等待内部" | "已解决";
  const [liveConversations, setLiveConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("待接管");
  const [query, setQuery] = useState("");
  const [states, setStates] = useState<Record<string, ConversationState>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [rightTab, setRightTab] = useState<"context" | "assist">("context");
  const [showClose, setShowClose] = useState(false);
  const [resolution, setResolution] = useState("已解释规则并完成业务核验");
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const selected = liveConversations.find((item) => item.id === selectedId) ?? liveConversations[0];
  const currentState = selected ? (states[selected.id] ?? selected.status) : "待接管";
  const draft = selected ? (drafts[selected.id] ?? "") : "";
  const queueCounts = (state: QueueFilter) => liveConversations.filter((item) => (states[item.id] ?? item.status) === state).length;
  const visibleConversations = liveConversations.filter((item) => {
    const matchesState = (states[item.id] ?? item.status) === queueFilter;
    const normalized = query.trim().toLocaleLowerCase();
    return matchesState && (!normalized || `${item.name} ${item.id} ${item.topic} ${item.order}`.toLocaleLowerCase().includes(normalized));
  });

  useEffect(() => {
    let mounted = true;
    async function loadConversations() {
      try {
        const response = await fetch("/api/conversations", { cache: "no-store" });
        if (!response.ok) throw new Error("会话队列读取失败");
        const body = await response.json() as { conversations?: Conversation[] };
        if (!mounted) return;
        const next = body.conversations ?? [];
        setLiveConversations(next);
        setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? "");
        setStates(Object.fromEntries(next.map((item) => [item.id, item.status])));
        setDrafts((current) => Object.fromEntries(next.map((item) => [item.id, current[item.id] ?? item.draft])));
        setLoading(false);
      } catch {
        if (mounted) setLoading(false);
      }
    }
    loadConversations();
    const timer = window.setInterval(loadConversations, 5000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  async function updateConversation(action: "claim" | "reply" | "resolve" | "reopen", content?: string) {
    const response = await fetch(`/api/conversations/${selected?.id ?? ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, content }) });
    if (!response.ok) throw new Error("会话操作未保存，请重试");
  }

  async function claimConversation() {
    try { await updateConversation("claim"); }
    catch (cause) { flash(cause instanceof Error ? cause.message : "接管失败"); return; }
    setStates((current) => ({ ...current, [selected.id]: "处理中" }));
    setQueueFilter("处理中");
    flash(`已接管 ${selected.id}，会话上下文和 SLA 已锁定给你`);
  }

  function insertText(value: string) {
    setDrafts((current) => ({ ...current, [selected.id]: `${current[selected.id] ?? ""}${current[selected.id] ? "\n" : ""}${value}` }));
  }

  async function sendReply() {
    if (!draft.trim()) return;
    try { await updateConversation("reply", draft); }
    catch (cause) { flash(cause instanceof Error ? cause.message : "回复未保存"); return; }
    setStates((current) => ({ ...current, [selected.id]: "处理中" }));
    flash("回复已发送，当前会话已进入等待用户响应");
  }

  async function closeConversation() {
    if (!customerConfirmed) return;
    try { await updateConversation("resolve"); }
    catch (cause) { flash(cause instanceof Error ? cause.message : "结案未保存"); return; }
    setStates((current) => ({ ...current, [selected.id]: "已解决" }));
    setShowClose(false);
    setQueueFilter("已解决");
    flash("会话已结构化结案，并进入 72 小时重新打开观察期");
  }

  if (loading && !selected) return <section className="panel table-panel"><div className="queue-heading"><div><b>我的会话</b><small>正在从真实会话服务加载</small></div></div></section>;
  if (!selected) return <section className="panel table-panel"><div className="conversation-empty"><span>✓</span><b>当前没有会话</b><small>用户提交问题后，Agent 会将需要人工处理的会话放入这里。</small></div></section>;

  return (
    <section className="agent-console" aria-label="一线客服会话处理台">
      <header className="agent-shift-bar">
        <div className="agent-presence"><span className="presence-dot" /><div><b>在线接待</b><small>王可 · 售后服务组</small></div></div>
        <div className="shift-metrics"><span><b>{queueCounts("待接管")}</b> 待接管</span><span><b>2</b> 即将超时</span><span><b>41 秒</b> 平均响应</span></div>
        <button className="ghost-button" onClick={() => flash("状态已切换为忙碌，系统暂停分配新会话")}>设为忙碌</button>
      </header>
      {notice && <div className="agent-toast" role="status">✓ {notice}</div>}
      <div className="conversation-layout">
        <article className="panel conversation-list">
          <div className="queue-heading"><div><b>我的会话</b><small>按风险和剩余响应时间排序</small></div><button aria-label="刷新会话队列" onClick={() => flash("会话队列已刷新")}>↻</button></div>
          <div className="list-toolbar"><div className="search-box">⌕ <input name="conversation-search" autoComplete="off" aria-label="搜索会话" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户、订单…" /></div></div>
          <div className="list-tabs" role="tablist">{(["待接管", "处理中", "等待内部", "已解决"] as QueueFilter[]).map((item) => <button key={item} role="tab" aria-selected={queueFilter === item} className={queueFilter === item ? "active" : ""} onClick={() => setQueueFilter(item)}>{item}<b>{queueCounts(item)}</b></button>)}</div>
          <div className="conversation-items">
            {visibleConversations.map((item) => <button key={item.id} className={selected.id === item.id ? "conversation-item active" : "conversation-item"} onClick={() => { setSelectedId(item.id); setShowClose(false); }}>
              <span className="customer-avatar">{item.name[0]}</span><span className="conversation-main"><b>{item.name}<small>{item.time}</small></b><span>{item.topic}</span><em>{item.channel} · {item.id}</em><small className={item.risk === "高" ? "queue-sla urgent" : "queue-sla"}>{item.sla}</small></span><Status kind={item.risk === "高" ? "danger" : item.risk === "中" ? "warning" : "info"}>{item.risk}风险</Status>
            </button>)}
            {!visibleConversations.length && <div className="conversation-empty"><span>✓</span><b>当前队列已清空</b><small>{query ? "没有匹配的会话，试试其他关键词" : "新的会话会按风险和 SLA 自动排入"}</small></div>}
          </div>
        </article>

        <article className="panel chat-panel">
          <div className="chat-head"><div><b>{selected.name}</b><span>{selected.id} · {selected.channel} · 关联订单 {selected.order}</span></div><div><Status kind={currentState === "已解决" ? "success" : selected.risk === "高" ? "danger" : "warning"}>{currentState}</Status>{currentState === "待接管" ? <button className="primary-button" onClick={claimConversation}>接管会话</button> : currentState !== "已解决" && <button className="ghost-button" onClick={() => flash("转交面板已打开，上下文将随会话一并转交")}>转交</button>}</div></div>
          <div className="handoff-banner"><span>人工接管原因</span><b>{selected.handoff}</b><em>{selected.sla}</em></div>
          <div className="chat-context"><span>服务意图 <b>{selected.topic}</b></span><span>用户情绪 <b>{selected.sentiment}</b></span><span>核验状态 <b>{selected.facts.length} 项事实已确认</b></span></div>
          <div className="messages">
            <div className="message customer"><span className="customer-avatar">{selected.name[0]}</span><p>{selected.customerMessage}<small>用户 · {selected.time}</small></p></div>
            <details className="trace-card"><summary><span className="trace-icon">AI</span><p><b>查看 AI 处理记录</b><small>意图识别、业务查询和知识依据均可追溯</small></p><em>展开</em></summary><div><span className="trace-icon">1</span><p><b>识别服务意图</b><small>{selected.topic} · 已结合最近 4 轮上下文</small></p></div><div><span className="trace-icon">2</span><p><b>查询业务系统</b><small>{selected.facts[0].source} · 返回结果已脱敏</small></p></div><div><span className="trace-icon">3</span><p><b>检索生效知识</b><small>回答仅引用已发布版本，未执行敏感操作</small></p></div></details>
            <div className="message agent"><span className="agent-avatar">AI</span><p>{selected.aiReply}<a>查看回答依据 ↗</a><small>AI Agent · 自动回复</small></p></div>
            <div className="handoff-note"><b>上下文已完整交接，无需用户重复描述</b><span>{selected.summary}</span></div>
          </div>
          {currentState !== "已解决" ? <div className="reply-box">
            <div className="reply-tools"><button onClick={() => setRightTab("assist")}>AI 回复建议</button><button onClick={() => insertText("依据《退款与到账时效规则 v3.4》，")}>引用知识</button><button onClick={() => flash(`已从 ${selected.order} 创建协同工单，用户与会话上下文已自动带入`)}>创建工单</button><button onClick={() => flash("已添加仅内部可见的协作备注")}>内部备注</button><span>草稿已自动保存</span></div>
            <textarea aria-label="客服回复" maxLength={500} value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [selected.id]: event.target.value }))} placeholder={currentState === "待接管" ? "接管会话后回复用户…" : "回复用户；涉及承诺、退款和补偿时将自动触发检查…"} disabled={currentState === "待接管"} />
            <div className="reply-actions"><span>{draft.length}/500 · 发送前检查知识依据与敏感承诺</span><button className="ghost-button" onClick={() => setShowClose(true)} disabled={currentState === "待接管"}>解决并结案</button><button className="primary-button" onClick={sendReply} disabled={currentState === "待接管" || !draft.trim()}>审核并发送</button></div>
          </div> : <div className="resolved-footer"><span>✓</span><div><b>会话已解决</b><small>用户已确认 · 72 小时内再次咨询将重新打开并保留上下文</small></div><button className="ghost-button" onClick={() => { setStates((current) => ({ ...current, [selected.id]: "处理中" })); setQueueFilter("处理中"); }}>重新打开</button></div>}
        </article>

        <aside className="panel insight-panel">
          <div className="insight-tabs" role="tablist"><button role="tab" aria-selected={rightTab === "context"} className={rightTab === "context" ? "active" : ""} onClick={() => setRightTab("context")}>服务上下文</button><button role="tab" aria-selected={rightTab === "assist"} className={rightTab === "assist" ? "active" : ""} onClick={() => setRightTab("assist")}>AI 协助</button></div>
          {rightTab === "context" ? <>
            <div className="insight-section verified-facts"><div className="insight-title"><h3>已核验事实</h3><Status kind="success">可信</Status></div>{selected.facts.map((fact) => <div className="fact-row" key={fact.label}><span>✓</span><p><b>{fact.label}：{fact.value}</b><small>{fact.source}</small></p></div>)}</div>
            <div className="insight-section"><h3>用户与业务信息</h3><dl><div><dt>用户等级</dt><dd>{selected.member}</dd></div><div><dt>消费记录</dt><dd>{selected.orderHistory}</dd></div><div><dt>关联订单</dt><dd><a>#{selected.order}</a></dd></div><div><dt>隐私保护</dt><dd>已脱敏</dd></div></dl></div>
            <div className="insight-section"><h3>AI 会话摘要</h3><p>{selected.summary}</p><button className="feedback-link" onClick={() => flash("已标记摘要问题，将回流至 AI 运营复核队列")}>摘要不准确？反馈问题</button></div>
          </> : <>
            <div className="insight-section ai-suggestion"><div className="insight-title"><h3>推荐回复</h3><Status kind="info">有知识依据</Status></div><p>{selected.draft || "当前会话已解决，无需生成新的回复。"}</p><div><button className="primary-button" disabled={!selected.draft} onClick={() => { setDrafts((current) => ({ ...current, [selected.id]: selected.draft })); flash("已将建议带入回复框，可继续编辑"); }}>采用建议</button><button className="ghost-button" onClick={() => flash("已记录建议无帮助，请选择更具体的失败原因")}>无帮助</button></div></div>
            <div className="insight-section"><h3>下一步业务动作</h3><button className="next-action" onClick={() => flash(`${selected.suggestedAction}已完成，结果已写入会话记录`)}><b>{selected.suggestedAction}</b><span>只读核验 · 预计 30 秒</span></button><button className="next-action" onClick={() => flash("已向值班主管发起审批，SLA 继续计时")}><b>升级值班主管</b><span>自动附带会话、订单和核验事实</span></button></div>
            <div className="insight-section safety-note"><h3>操作边界</h3><p>客服可以查询并解释业务结果；退款、补偿、账户与地址变更需要身份核验或审批，系统不会代替你直接执行。</p></div>
          </>}
        </aside>
      </div>
      {showClose && <div className="close-sheet" role="dialog" aria-modal="true" aria-labelledby="close-title"><button className="sheet-backdrop" aria-label="取消结案" onClick={() => setShowClose(false)} /><section><header><div><span>结构化结案</span><h2 id="close-title">确认问题已经解决</h2></div><button aria-label="关闭结案面板" onClick={() => setShowClose(false)}>×</button></header><p>结案信息会用于 SLA、质检和 AI 改进。用户再次咨询时仍会保留完整上下文。</p><label>解决结果<select value={resolution} onChange={(event) => setResolution(event.target.value)}><option>已解释规则并完成业务核验</option><option>已创建工单，等待内部处理</option><option>已完成授权业务操作</option><option>用户主动取消咨询</option></select></label><label className="close-check"><input type="checkbox" checked={customerConfirmed} onChange={(event) => setCustomerConfirmed(event.target.checked)} /><span><b>用户已确认问题解决</b><small>若用户尚未确认，应先发送回复并保持会话处理中</small></span></label><div className="close-summary"><span>结案分类</span><b>{selected.topic}</b><span>解决方式</span><b>{resolution}</b><span>AI 建议反馈</span><b>采用后编辑</b></div><footer><button className="ghost-button" onClick={() => setShowClose(false)}>继续处理</button><button className="primary-button" disabled={!customerConfirmed} onClick={closeConversation}>确认结案</button></footer></section></div>}
    </section>
  );
}

function Tickets() {
  const [filter, setFilter] = useState("全部");
  const filtered = filter === "全部" ? tickets : tickets.filter((t) => t.state === filter || t.priority === filter);
  return <section className="panel table-panel">
    <div className="table-toolbar"><div className="segmented">{["全部", "待领取", "处理中", "P1", "已解决"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><button className="primary-button">＋ 新建工单</button></div>
    <div className="sla-strip"><div><b>2</b><span>P1 即将超时</span></div><div><b>14</b><span>今日新增</span></div><div><b>93.2%</b><span>SLA 达成率</span></div><div><b>38 分钟</b><span>平均解决时长</span></div></div>
    <table><thead><tr><th>工单</th><th>客户</th><th>优先级</th><th>负责人</th><th>SLA</th><th>状态</th><th /></tr></thead><tbody>{filtered.map((ticket) => <tr key={ticket.id}><td><b>{ticket.title}</b><small>{ticket.id}</small></td><td>{ticket.customer}</td><td><Status kind={ticket.priority === "P1" ? "danger" : ticket.priority === "P2" ? "warning" : "neutral"}>{ticket.priority}</Status></td><td>{ticket.owner}</td><td className={ticket.sla.includes("18") || ticket.sla.includes("36") ? "urgent" : ""}>{ticket.sla}</td><td><Status kind={ticket.state === "已解决" ? "success" : "info"}>{ticket.state}</Status></td><td><button className="more-button">···</button></td></tr>)}</tbody></table>
    <div className="process-note"><b>企业级流转规则</b><span>P1 自动通知主管；涉及退款承诺需要审批；等待用户超过24小时自动提醒；工单关闭后进入质检抽样。</span></div>
  </section>;
}

type KnowledgeDocumentView = {
  id: string; title: string; version: string; ownerTeam: string; content: string; category: string; keywords: string[];
  coverage: number; state: string; sourceType: string; sourceTitle?: string | null; sourceUrl?: string | null;
  risk: string; handoff: boolean; validFrom?: string | null; validUntil?: string | null; updatedAt: string;
};

const knowledgeWorkItems = [
  { id: "gap-damage", type: "知识缺口", tone: "danger", title: "破损赔付追问未命中", meta: "来自 23 次真实会话 · 影响高风险回答", target: "KB-208", due: "今天处理" },
  { id: "conflict-refund", type: "口径冲突", tone: "warning", title: "退款到账时效存在两种表述", meta: "客服 SOP 写 1–3 日，支付规则写 1–5 日", target: "KB-114", due: "剩余 4 小时" },
  { id: "review-invoice", type: "待我复核", tone: "info", title: "数电发票红冲规则更新", meta: "财税运营提交 v1.1 · 需要业务复核", target: "KB-403", due: "明天到期" },
  { id: "expiry-address", type: "即将过期", tone: "neutral", title: "物流改址操作指引需确认", meta: "内部 SOP 将于 8 月 20 日到期", target: "KB-301", due: "6 天后" },
];

function Knowledge({ role }: { role: RoleKey }) {
  const operatorMode = role === "knowledge-operator";
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<KnowledgeDocumentView[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0, review: 0, draft: 0, archived: 0, official: 0 });
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("KB-208");
  const [surface, setSurface] = useState<"work" | "library">(operatorMode ? "work" : "library");
  const [editorTab, setEditorTab] = useState<"content" | "test" | "history">("content");
  const [draftContent, setDraftContent] = useState("");
  const [testQuestion, setTestQuestion] = useState("商品破损了，但外包装已经丢了，还能申请处理吗？");
  const [testState, setTestState] = useState<"idle" | "running" | "passed">("idle");
  const [reviewState, setReviewState] = useState<"editing" | "submitted" | "published">("editing");
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const initializedKnowledge = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => { setLoading(true); fetch(`/api/knowledge?limit=50&offset=${offset}&q=${encodeURIComponent(query)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("知识资产读取失败，请检查数据连接后重试")))
      .then((payload: { documents: KnowledgeDocumentView[]; total: number; stats: typeof stats }) => {
        setDocs(payload.documents); setTotal(payload.total); setStats(payload.stats); setError("");
        if (!initializedKnowledge.current && payload.documents[0]) {
          const initial = payload.documents.find((item) => item.id === "KB-208") ?? payload.documents[0];
          initializedKnowledge.current = true; setSelectedId(initial.id); setDraftContent(initial.content);
        }
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "知识资产读取失败"))
      .finally(() => setLoading(false)); }, 180);
    return () => window.clearTimeout(timer);
  }, [query, offset]);
  const selected = docs.find((item) => item.id === selectedId) ?? docs[0];
  const stateLabel: Record<string, string> = { active: "生效中", review: "待复核", draft: "草稿", archived: "已归档" };
  const categoryLabel: Record<string, string> = { refund: "退款售后", damage: "破损与质量", address: "物流改址", invoice: "发票服务" };
  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 2400); }
  function selectWorkItem(target: string) { const targetDocument = docs.find((item) => item.id === target); setSelectedId(target); if (targetDocument) setDraftContent(targetDocument.content); setSurface("work"); setEditorTab("content"); setReviewState("editing"); setTestState("idle"); }
  function runKnowledgeTest() {
    if (!testQuestion.trim() || testState === "running") return;
    setTestState("running");
    window.setTimeout(() => { setTestState("passed"); flash("测试完成：知识命中、回答边界和转人工策略均符合预期"); }, 720);
  }
  function submitForReview() { setReviewState("submitted"); flash("已提交业务与合规双人复核，当前线上版本不受影响"); }
  function publishKnowledge() { setReviewState("published"); flash("新版本已发布至 10% 灰度流量，可随时回退上一版本"); }

  if (!operatorMode) return <section className="panel knowledge-reader" aria-labelledby="knowledge-reader-title"><header><div><h2 id="knowledge-reader-title">已发布知识查询</h2><p>搜索并引用当前生效的知识；编辑、审核和发布仅对知识运营开放。</p></div><div className="search-box wide">⌕ <input aria-label="搜索已发布知识" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索规则、用户问法或知识编号…" /></div></header>{error && <div className="evaluation-error">{error}</div>}{loading ? <div className="knowledge-skeleton"><i /><i /><i /></div> : <div className="knowledge-reader-list">{docs.filter((item) => item.state === "active").map((doc) => <article key={doc.id}><div><Status kind={doc.risk === "high" ? "danger" : "success"}>{categoryLabel[doc.category] ?? doc.category}</Status><b>{doc.title}</b><p>{doc.content}</p></div><aside><span>{doc.id} · {doc.version}</span><small>{doc.sourceTitle}</small><button onClick={() => flash(`已引用 ${doc.id}，发送回复时将保留知识版本`)}>引用知识</button></aside></article>)}</div>}{!loading && !error && !docs.length && <div className="knowledge-empty"><b>没有找到已发布知识</b><span>尝试输入更短的关键词，或向知识运营反馈缺口。</span></div>}{notice && <div className="agent-toast" role="status">✓ {notice}</div>}</section>;

  return <section className="knowledge-operations" aria-label="知识运营工作台">
    {notice && <div className="agent-toast" role="status">✓ {notice}</div>}
    <header className="knowledge-command">
      <div><span>知识运营 · 今日工作</span><h2>先处理会影响真实回答的知识</h2><p>从客服反馈和评测失败进入，完成修订、验证、审核与安全发布。</p></div>
      <div className="knowledge-command-stats"><div><b>7</b><span>知识缺口</span><small>影响 96 次会话</small></div><div><b>3</b><span>口径冲突</span><small>1 项高风险</small></div><div><b>12</b><span>待我复核</span><small>3 项即将到期</small></div></div>
      <button className="primary-button" onClick={() => setImportOpen(true)}>＋ 导入知识来源</button>
    </header>
    <nav className="knowledge-surface-tabs" aria-label="知识运营视图"><button className={surface === "work" ? "active" : ""} onClick={() => setSurface("work")}>工作队列 <b>22</b></button><button className={surface === "library" ? "active" : ""} onClick={() => setSurface("library")}>知识资产 <b>{stats.total || "—"}</b></button></nav>
    {surface === "work" ? <div className="knowledge-workspace">
      <aside className="panel knowledge-queue"><header><div><h3>优先处理</h3><p>按影响会话、风险和时限排序</p></div><button onClick={() => flash("工作队列已刷新")}>↻</button></header><div className="knowledge-queue-filters"><button className="active">全部 22</button><button>缺口 7</button><button>冲突 3</button><button>复核 12</button></div><div className="knowledge-queue-list">{knowledgeWorkItems.map((item) => <button key={item.id} className={selected?.id === item.target ? "active" : ""} onClick={() => selectWorkItem(item.target)}><span className={`work-type ${item.tone}`}>{item.type}</span><b>{item.title}</b><p>{item.meta}</p><small>{item.due} · 关联 {item.target}</small></button>)}</div><footer><span>排序依据</span><b>受影响会话 × 风险 × 剩余时间</b></footer></aside>
      <article className="panel knowledge-editor">{selected ? <><header className="knowledge-editor-head"><div><span>{selected.id} · {selected.version}</span><h3>{selected.title}</h3><p>{categoryLabel[selected.category] ?? selected.category} · {selected.ownerTeam} · 更新于 {selected.updatedAt?.slice(0, 10) || "今天"}</p></div><Status kind={reviewState === "published" ? "success" : reviewState === "submitted" ? "warning" : "info"}>{reviewState === "published" ? "灰度发布中" : reviewState === "submitted" ? "复核中" : "修订草稿"}</Status></header><div className="knowledge-editor-tabs" role="tablist"><button role="tab" aria-selected={editorTab === "content"} className={editorTab === "content" ? "active" : ""} onClick={() => setEditorTab("content")}>内容与边界</button><button role="tab" aria-selected={editorTab === "test"} className={editorTab === "test" ? "active" : ""} onClick={() => setEditorTab("test")}>回答验证 <b>{testState === "passed" ? "已通过" : "3 个用例"}</b></button><button role="tab" aria-selected={editorTab === "history"} className={editorTab === "history" ? "active" : ""} onClick={() => setEditorTab("history")}>版本记录</button></div>
        {editorTab === "content" && <div className="knowledge-edit-body"><section><label>客服可引用内容<textarea value={draftContent} onChange={(event) => { setDraftContent(event.target.value); setReviewState("editing"); }} maxLength={800} /><small>{draftContent.length}/800 · 只写可被客服直接解释的事实和处理边界</small></label><div className="knowledge-field-grid"><label>适用场景<input value={(selected.keywords ?? []).join("、")} readOnly /></label><label>责任团队<input value={selected.ownerTeam} readOnly /></label><label>风险等级<select defaultValue={selected.risk}><option value="low">低风险</option><option value="medium">中风险</option><option value="high">高风险</option></select></label><label>人工接管<select defaultValue={selected.handoff ? "yes" : "no"}><option value="no">允许自动回答</option><option value="yes">必须转人工</option></select></label></div></section><aside><div className="source-card"><span>原始依据</span><b>{selected.sourceTitle || "内部业务规范"}</b><small>{selected.sourceType === "official" ? "官方公开来源 · 已留存快照" : "内部来源 · 需要业务复核"}</small>{selected.sourceUrl ? <a href={selected.sourceUrl} target="_blank" rel="noreferrer">查看原文 ↗</a> : <button onClick={() => flash("已打开内部来源快照")}>查看来源快照</button>}</div><div className="conflict-card"><span>!</span><p><b>检测到 1 处口径差异</b><small>旧版客服 SOP 对处理时效的描述不同，发布前需确认适用范围。</small></p><button onClick={() => flash("已采用当前业务规则，并保留冲突处理记录")}>确认处理</button></div></aside></div>}
        {editorTab === "test" && <div className="knowledge-test-body"><header><div><h4>用真实用户问法验证</h4><p>发布前确认知识能被正确召回、回答不越界、该转人工时会转人工。</p></div><Status kind={testState === "passed" ? "success" : "neutral"}>{testState === "passed" ? "3/3 通过" : "等待测试"}</Status></header><label>测试问题<textarea value={testQuestion} onChange={(event) => { setTestQuestion(event.target.value); setTestState("idle"); }} /></label><button className="primary-button" onClick={runKnowledgeTest} disabled={testState === "running"}>{testState === "running" ? "正在调用 Agent…" : "运行回答测试"}</button>{testState === "passed" && <div className="knowledge-test-result"><div><span>用户意图</span><b>商品破损处理 · 正确</b></div><div><span>命中知识</span><b>{selected.id} {selected.version}</b></div><div><span>回答边界</span><b>未承诺赔付金额 · 通过</b></div><div><span>人工接管</span><b>高风险场景已转人工 · 通过</b></div><p>示例回答：{draftContent}</p></div>}</div>}
        {editorTab === "history" && <div className="knowledge-history"><div><span>当前草稿</span><b>{selected.version} 修订中</b><small>陈悠 · 刚刚 · 修改回答边界</small></div><div><span>线上版本</span><b>{selected.version}</b><small>业务与合规双人复核 · 当前 100% 流量</small></div><div><span>上一版本</span><b>v{Math.max(1, Number(selected.version.replace(/[^0-9.]/g, "")) - 0.1).toFixed(1)}</b><small>已归档 · 可审计，不再参与召回</small></div></div>}
        <footer className="knowledge-editor-actions"><span>{reviewState === "editing" ? "修改仅保存在草稿，不影响线上回答" : reviewState === "submitted" ? "等待业务与合规复核" : "10% 灰度流量 · 可回退"}</span><button className="ghost-button" onClick={() => { setDraftContent(selected.content); setReviewState("editing"); flash("已恢复为线上版本内容"); }}>恢复线上内容</button>{reviewState === "editing" && <button className="primary-button" onClick={submitForReview} disabled={testState !== "passed"}>提交双人复核</button>}{reviewState === "submitted" && <button className="primary-button" onClick={publishKnowledge}>批准并灰度发布</button>}{reviewState === "published" && <button className="primary-button" onClick={() => flash("灰度观察详情已打开：当前未发现异常回答")}>查看灰度效果</button>}</footer></> : <div className="knowledge-empty"><b>选择一个工作项</b><span>从左侧队列开始处理知识缺口、冲突或复核任务。</span></div>}</article>
      <aside className="panel release-readiness"><header><h3>发布就绪度</h3><Status kind={testState === "passed" ? "success" : "warning"}>{testState === "passed" ? "可以提交" : "还差 1 项"}</Status></header><div className="readiness-score"><b>{testState === "passed" ? "100" : "80"}</b><span>/100</span><small>高风险知识必须全部通过</small></div><div className="readiness-list"><div className="passed"><i>✓</i><p><b>来源可追溯</b><span>原文与快照已留存</span></p></div><div className="passed"><i>✓</i><p><b>责任与有效期明确</b><span>{selected?.ownerTeam || "责任团队"}负责</span></p></div><div className="passed"><i>✓</i><p><b>冲突已识别</b><span>1 处差异等待复核确认</span></p></div><div className={testState === "passed" ? "passed" : "pending"}><i>{testState === "passed" ? "✓" : "4"}</i><p><b>回答验证</b><span>{testState === "passed" ? "召回、回答、转人工均通过" : "运行 3 个真实问法后解锁复核"}</span></p></div><div className={reviewState !== "editing" ? "passed" : "pending"}><i>{reviewState !== "editing" ? "✓" : "5"}</i><p><b>双人复核</b><span>{reviewState === "published" ? "业务与合规已通过" : reviewState === "submitted" ? "审核任务已创建" : "测试通过后提交"}</span></p></div></div><div className="release-impact"><span>发布影响预估</span><b>37 次/日相关会话</b><small>预计知识命中率 +6.8%，转人工策略保持不变</small></div></aside>
    </div> : <article className="panel knowledge-library"><header><div className="search-box wide">⌕ <input aria-label="搜索知识资产" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="搜索知识、用户问法、来源或负责人…" /></div><div className="segmented"><button className="active">全部 {stats.total}</button><button>生效 {stats.active}</button><button>待复核 {stats.review}</button><button>草稿 {stats.draft}</button></div><button className="ghost-button" onClick={() => setImportOpen(true)}>批量导入</button><button className="primary-button" onClick={() => { setSurface("work"); flash("已创建空白知识草稿"); }}>＋ 新建知识</button></header>{error && <div className="evaluation-error">{error}</div>}{loading ? <div className="knowledge-skeleton"><i /><i /><i /></div> : <table><thead><tr><th>知识资产</th><th>责任团队</th><th>来源</th><th>覆盖率</th><th>状态</th><th>最近更新</th></tr></thead><tbody>{docs.map((doc) => <tr key={doc.id} onClick={() => { setSelectedId(doc.id); setDraftContent(doc.content); setTestState("idle"); setReviewState("editing"); setSurface("work"); }}><td><b>{doc.title}</b><small>{doc.id} · {doc.version} · {categoryLabel[doc.category] ?? doc.category}</small></td><td>{doc.ownerTeam}</td><td><span>{doc.sourceType === "official" ? "官方来源" : "内部规范"}</span><small>{doc.sourceTitle}</small></td><td><div className="coverage"><i style={{ width: `${doc.coverage * 100}%` }} /><span>{(doc.coverage * 100).toFixed(0)}%</span></div></td><td><Status kind={doc.state === "active" ? "success" : doc.state === "review" ? "warning" : "neutral"}>{stateLabel[doc.state] ?? doc.state}</Status></td><td>{doc.updatedAt?.slice(0, 10)}</td></tr>)}</tbody></table>}{!loading && !error && !docs.length && <div className="knowledge-empty"><b>没有找到知识资产</b><span>调整搜索词，或导入一个新的可信来源。</span></div>}<footer><span>显示 {total ? offset + 1 : 0}-{Math.min(offset + docs.length, total)} / {total}</span><div><button className="ghost-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button><button className="ghost-button" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}>下一页</button></div></footer></article>}
    {importOpen && <div className="close-sheet knowledge-import-sheet" role="dialog" aria-modal="true" aria-labelledby="import-title"><button className="sheet-backdrop" aria-label="取消导入" onClick={() => setImportOpen(false)} /><section><header><div><span>知识来源接入</span><h2 id="import-title">导入可信业务资料</h2></div><button aria-label="关闭导入面板" onClick={() => setImportOpen(false)}>×</button></header><p>系统会解析结构、建议切片并检测冲突，但不会绕过人工审核直接发布。</p><label>来源类型<select defaultValue="official"><option value="official">官方政策或法规</option><option value="internal">内部业务规范</option><option value="faq">客服 FAQ</option></select></label><label>来源地址或文件名<input defaultValue="国家税务总局数电发票业务公告.pdf" /></label><label>责任团队<select defaultValue="财税运营"><option>财税运营</option><option>售后运营</option><option>履约团队</option><option>合规运营</option></select></label><div className="import-preview"><span>自动检查</span><div><b>来源身份</b><em>待校验</em></div><div><b>预计知识片段</b><em>8–12 条</em></div><div><b>潜在冲突</b><em>导入后检测</em></div></div><footer><button className="ghost-button" onClick={() => setImportOpen(false)}>取消</button><button className="primary-button" onClick={() => { setImportOpen(false); setSurface("work"); flash("来源已导入并完成解析，生成 9 条知识草稿和 2 条冲突提示"); }}>开始解析</button></footer></section></div>}
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
  return <section className="panel evaluation-panel"><div className="evaluation-head"><div><span className="eyebrow">分层评测体系</span><h3>CSDS 全量覆盖 + 混合意图路由 + qwen-plus 端到端回归</h3><p>21,126 个标注问题全部逐条测试；4,196 条四类去重场景做专项分析；100 条回归与 55 条盲测调用真实模型</p></div><div className="evaluation-actions"><button className="ghost-button" disabled={Boolean(running) || blindConsumed} onClick={() => runEvaluation("blind")}>{running === "blind" ? "正在运行盲测…" : blindConsumed ? "本版本盲测已完成" : "运行冻结盲测"}</button><button className="primary-button" disabled={Boolean(running)} onClick={() => runEvaluation("regression")}>{running === "regression" ? "正在调用模型…" : run ? "重新运行回归" : "运行首轮回归"}</button></div></div>
    {scale && complete && <><div className="evaluation-kpis"><div><span>全量标注问题</span><b>{complete.overall.total.toLocaleString()}</b><small>{complete.raw.dialogues.toLocaleString()} 段对话 · {complete.raw.turns.toLocaleString()} 轮</small></div><div><span>全量策略通过率</span><b>{(complete.overall.passRate * 100).toFixed(1)}%</b><small>已支持路由 + 未支持兜底</small></div><div><span>支持意图通过率</span><b>{(complete.supported.passRate * 100).toFixed(1)}%</b><small>3 类主意图 + 7 类售后二级意图</small></div><div><span>未支持意图安全兜底</span><b>{(complete.unsupported.safeFallbackRate * 100).toFixed(1)}%</b><small>{complete.unsupported.falsePositiveRoutes.toLocaleString()} 条误路由待治理</small></div></div><div className="process-note"><b>全量评测口径</b><span>train、val、test 的每个标注问题均执行一次测试；退款、地址、发票及破损、质量、少件、丢件、维修、保修、三包检查知识来源与转人工，其余 {complete.unsupported.total.toLocaleString()} 条检查能否安全兜底。路由采用字符向量召回、概率 Rerank 与规则融合；全量测试不逐条调用大模型。四类专项去重集 {scale.overall.total.toLocaleString()} 条，通过率 {(scale.overall.passRate * 100).toFixed(1)}%；上下文依赖样本通过率 {(scale.contextRequired.passRate * 100).toFixed(1)}%。</span></div></>}
    <RealScenarioBrowser />
    {error && <div className="evaluation-error">{error}</div>}
    {run ? <><div className="evaluation-kpis"><div><span>总体通过率</span><b>{(run.passRate * 100).toFixed(1)}%</b><small>{run.passedCases}/{run.totalCases} 条通过</small></div><div><span>高风险通过率</span><b>{(run.highRiskPassRate * 100).toFixed(1)}%</b><small>高风险 · 对抗 · 隐私</small></div><div><span>平均端到端时延</span><b>{run.averageLatencyMs}ms</b><small>包含检索与生成</small></div><div><span>数据集 / 模型</span><b>v{run.datasetVersion}</b><small>{run.model}</small></div></div>
      <div className="evaluation-results"><div className="evaluation-subhead"><b>{run.suite === "blind" ? "盲测失败案例" : "回归失败案例"}</b><span>{failed.length ? `优先处理 ${failed.length} 条` : "本轮全部通过"}</span></div>{failed.length ? failed.slice(0, 5).map((item) => <div className="evaluation-case" key={item.id}><Status kind="danger">{item.category}</Status><p><b>{item.query}</b><span>{item.failures.join("；")}</span></p><button className="text-button">加入优化任务 →</button></div>) : <div className="evaluation-empty">✓ 当前基线未发现规则性失败，可继续扩展长尾用例。</div>}</div></> : <div className="evaluation-placeholder"><b>还没有真实基线结果</b><span>运行后将调用生产 qwen-plus，并按知识来源、转人工决策、必要信息与禁止内容自动评分。</span></div>}
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
  const toggle = (i: number) => setRules((prev) => prev.map((v, idx) => idx === i ? !v : v));
  const items = [
    ["高风险操作强制人工确认", "退款、赔付、账户修改与价格承诺不得由AI直接执行"],
    ["连续两次低置信度自动转人工", "置信度低于0.72，且用户继续追问时触发"],
    ["负面情绪立即升级主管", "识别投诉、威胁曝光或强烈不满时通知值班主管"],
    ["回答必须附带知识来源", "政策、时效与权益类答案需展示有效版本引用"],
  ];
  return <section className="strategy-layout"><article className="panel strategy-main"><div className="strategy-header"><div><h3>生产策略集</h3><p>默认客服 Agent · v3.0 · 混合路由灰度版</p></div><button className="ghost-button">版本记录</button><button className="primary-button">发布新版本</button></div><div className="strategy-section"><h4>安全与人工接管</h4>{items.map(([title, desc], i) => <div className="setting-row" key={title}><div><b>{title}</b><span>{desc}</span></div><button aria-label={`切换${title}`} className={rules[i] ? "switch on" : "switch"} onClick={() => toggle(i)}><i /></button></div>)}</div><div className="strategy-section"><h4>模型路由</h4><div className="routing-card"><div><Status kind="info">向量召回</Status><p><b>字符 TF-IDF</b><span>低时延 · 候选意图</span></p></div><div className="routing-arrow">→</div><div><Status kind="warning">概率 Rerank</Status><p><b>Logistic + 规则</b><span>歧义消解 · OOD拒识</span></p></div><div className="routing-arrow">→</div><div><Status kind="danger">高风险</Status><p><b>人工客服</b><span>不允许自动承诺</span></p></div></div></div></article><aside className="panel strategy-aside"><h3>发布检查</h3><ul><li className="pass">未支持意图兜底 95.2%</li><li className="pass">上下文样本通过 75.1%</li><li className="pass">四类专项整体通过 90.8%</li><li className="warn">三包长尾仍需扩充样本</li></ul><div className="approval"><b>双人审批</b><span>产品负责人 ✓</span><span>业务合规 待审批</span></div></aside></section>;
}

function Analytics() {
  return <><section className="metrics-grid"><MetricCard label="今日会话量" value="3,842" change="+12.4%" helper="高峰 10:00–11:00" tone="blue" /><MetricCard label="单会话成本" value="¥0.084" change="-8.2%" helper="预算 ¥0.10" tone="green" /><MetricCard label="平均响应时延" value="1.64s" change="-0.21s" helper="P95 3.82s" tone="purple" /><MetricCard label="建议采纳率" value="76.8%" change="+5.6%" helper="人工客服端" tone="orange" /></section><section className="analytics-grid"><article className="panel funnel-panel"><div className="panel-head"><div><h3>会话解决漏斗</h3><p>从用户发起咨询到问题关闭</p></div><button className="ghost-button">按渠道⌄</button></div><div className="funnel"><div style={{width:'100%'}}><span>发起会话</span><b>3,842</b></div><div style={{width:'88%'}}><span>AI成功识别</span><b>3,391</b></div><div style={{width:'71%'}}><span>AI完成处理</span><b>2,729</b></div><div style={{width:'61%'}}><span>用户确认解决</span><b>2,347</b></div></div></article><article className="panel matrix-panel"><div className="panel-head"><div><h3>质量 × 成本矩阵</h3><p>用于模型路由与预算决策</p></div></div><div className="matrix"><span className="quadrant-label top">高质量</span><span className="quadrant-label right">高成本</span><i className="bubble qwen">Qwen</i><i className="bubble deepseek">DeepSeek</i><i className="bubble mini">Mini</i><i className="bubble human">人工</i></div><p className="matrix-note">建议：常规咨询保持 Qwen；复杂退款场景使用 DeepSeek；高风险承诺转人工。</p></article></section></>;
}

function Audit() {
  return <section className="audit-layout"><article className="panel table-panel"><div className="table-toolbar"><div className="search-box wide">⌕ <input name="audit-search" autoComplete="off" aria-label="搜索操作人、资源或审计编号" placeholder="搜索操作人、资源或审计编号…" /></div><button className="filter-button">风险等级</button><button className="filter-button">导出记录</button></div><table><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th><th>结果</th><th>风险</th></tr></thead><tbody>
    <tr><td>10:42:18</td><td>王可</td><td>查看脱敏订单</td><td>OR-773928</td><td><Status kind="success">允许</Status></td><td>低</td></tr><tr><td>10:31:06</td><td>客服 Agent</td><td>尝试执行退款</td><td>OR-773114</td><td><Status kind="danger">已拦截</Status></td><td className="urgent">高</td></tr><tr><td>09:42:27</td><td>周敏</td><td>发布知识版本</td><td>KB-114 v3.4</td><td><Status kind="success">成功</Status></td><td>中</td></tr><tr><td>08:30:11</td><td>系统管理员</td><td>发布策略版本</td><td>POLICY v2.7</td><td><Status kind="success">成功</Status></td><td>中</td></tr>
    </tbody></table></article><aside className="panel security-card"><div className="shield">✓</div><h3>安全基线正常</h3><p>最近 24 小时未发现越权访问或敏感信息泄露。</p><dl><div><dt>PII 脱敏覆盖</dt><dd>100%</dd></div><div><dt>高风险操作拦截</dt><dd>7 次</dd></div><div><dt>权限复核到期</dt><dd>3 人</dd></div></dl><button className="ghost-button full">查看权限矩阵</button></aside></section>;
}

function CustomerDemo({ onClose }: { onClose: () => void }) {
  type DemoTurn = { role: "user" | "assistant"; content: string };
  type AgentResult = { answer: string; source: { id: string; title: string; version: string } | null; confidence: number; handoff: boolean; mode: string; trace: Array<{ label: string }>; memory?: { activeIntent: string | null; turnCount: number; source: string } | null };
  const [query, setQuery] = useState("订单 OR-773928 的退款什么时候到账？");
  const [conversationId, setConversationId] = useState("");
  const [history, setHistory] = useState<DemoTurn[]>([]);
  const [submitted, setSubmitted] = useState("");
  const [result, setResult] = useState<AgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function send(nextQuery = query) {
    const value = nextQuery.trim();
    if (!value || loading) return;
    setSubmitted(value); setQuery(value); setLoading(true); setError(""); setResult(null);
    try {
      const activeConversationId = conversationId || createDemoConversationId();
      if (!conversationId) setConversationId(activeConversationId);
      const response = await fetch("/api/agent/respond", { method: "POST", headers: { "content-type": "application/json", "x-servicepilot-channel": "customer-demo" }, body: JSON.stringify({ query: value, history: history.slice(-6), conversationId: activeConversationId, customerName: "体验用户", channel: "商城智能客服" }) });
      const body = await response.json() as AgentResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "服务暂时不可用");
      setResult(body); setHistory((previous) => [...previous, { role: "user", content: value }, { role: "assistant", content: body.answer }].slice(-6) as DemoTurn[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "服务暂时不可用"); }
    finally { setLoading(false); }
  }
  const quick = ["订单 OR-773928 的退款什么时候到账？", "那周末算工作日吗？", "收到的生鲜破损了怎么办？", "订单还没发货怎么改地址？"];
  const resetConversation = () => { setConversationId(""); setHistory([]); setSubmitted(""); setResult(null); setError(""); };
  return <div className="modal-backdrop" onClick={onClose}><div className="customer-demo" role="dialog" aria-modal="true" aria-label="商城智能客服体验" onClick={(e) => e.stopPropagation()}><div className="demo-head"><div className="brand-mark small">S</div><div><b>商城智能客服</b><span>Agent API 已连接 · 30 分钟会话记忆 · 随时可转人工</span></div><button aria-label="新会话" onClick={resetConversation}>↻</button><button aria-label="关闭" onClick={onClose}>×</button></div><div className="demo-body"><div className="demo-welcome"><b>您好，我是商城智能客服</b><span>先询问退款，再追问“那周末算工作日吗”，体验多轮意图继承。</span></div><div className="quick-questions">{quick.map((item) => <button key={item} onClick={() => send(item)}>{item.replace("？", "")}</button>)}</div>{submitted && <div className="demo-user">{submitted}</div>}{loading && <div className="demo-ai loading"><b>正在执行 Agent 工作流…</b><span>会话状态 → 意图识别 → 知识检索 → 风险校验</span></div>}{error && <div className="demo-ai error"><b>请求失败</b><span>{error}</span></div>}{result && <div className="demo-ai"><b>{result.handoff ? "已生成安全答复并建议转人工" : "已基于可信知识回答"}</b><span>{result.answer}</span>{result.source && <span className="demo-source">依据：{result.source.title} {result.source.version} · {result.source.id}</span>}<small>置信度 {(result.confidence * 100).toFixed(0)}% · {result.mode === "model-grounded" ? "大模型生成（有依据约束）" : result.mode === "safe-fallback" ? "低置信度安全兜底" : "确定性安全模式"}</small>{result.memory && <small>会话记忆：{result.memory.activeIntent ?? "未识别"} · 第 {result.memory.turnCount} 轮 · {result.memory.source === "memory" ? "状态继承" : result.memory.source === "history" ? "历史上下文" : "当前问题"}</small>}<div className="demo-trace">{result.trace.map((step, index) => <i key={step.label}>{index + 1}. {step.label}</i>)}</div>{result.handoff && <button className="handoff-button" disabled>已进入客服待接管队列</button>}</div>}</div><div className="demo-input"><input name="demo-query" autoComplete="off" aria-label="输入客服问题" value={query} maxLength={500} onChange={(e) => setQuery(e.target.value)} placeholder="请输入您的问题…" onKeyDown={(e) => e.key === 'Enter' && send()} /><button disabled={loading} onClick={() => send()}>{loading ? "处理中…" : "发送"}</button></div><div className="demo-footer">AI生成内容仅供参考 · 会话记忆 30 分钟后自动失效 · 涉及资金、赔付和账户操作需人工确认</div></div></div>;
}

export default function Home() {
  const [entryStage, setEntryStage] = useState<EntryStage>("login");
  const [email, setEmail] = useState(DEFAULT_DEMO_EMAIL);
  const [loginError, setLoginError] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceKey>("qingyu");
  const [active, setActive] = useState<NavKey>("workbench");
  const [role, setRole] = useState<RoleKey>("supervisor");
  const [rememberWorkbench, setRememberWorkbench] = useState(true);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [dataMode, setDataMode] = useState<"connecting" | "persistent" | "preview">("connecting");
  const title = active === "workbench"
    ? { title: roles[role].title, desc: screenTitles.workbench.desc }
    : active === "knowledge" && role === "knowledge-operator"
      ? { title: "知识运营", desc: "把可信业务资料转化为可验证、可审核、可安全发布的 Agent 知识" }
      : active === "knowledge" && role === "agent"
        ? { title: "知识查询", desc: "查找并引用当前已审核生效的服务知识" }
        : screenTitles[active];
  const visibleNav = navItems.filter((item) => roles[role].nav.includes(item.key));
  function enterWorkbench(nextRole: RoleKey) {
    if (!workspaces[workspace].roles.includes(nextRole)) return;
    setRole(nextRole);
    setActive("workbench");
    setAccountMenuOpen(false);
    setEntryStage("app");
    if (rememberWorkbench) window.localStorage.setItem("servicepilot-entry-v1", JSON.stringify({ version: 1, workspace, role: nextRole, email }));
    else window.localStorage.removeItem("servicepilot-entry-v1");
  }
  function login() {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setLoginError("请输入有效的企业邮箱"); return; }
    setEmail(value); setLoginError(""); setEntryStage("workspace");
  }
  function selectWorkspace(nextWorkspace: WorkspaceKey) {
    setWorkspace(nextWorkspace);
    const authorized = workspaces[nextWorkspace].roles;
    if (authorized.length === 1) {
      setRole(authorized[0]); setActive("workbench"); setEntryStage("app");
      if (rememberWorkbench) window.localStorage.setItem("servicepilot-entry-v1", JSON.stringify({ version: 1, workspace: nextWorkspace, role: authorized[0], email }));
    } else setEntryStage("workbench");
  }
  function logout() {
    window.localStorage.removeItem("servicepilot-entry-v1");
    setAccountMenuOpen(false); setActive("workbench"); setEntryStage("login");
  }
  useEffect(() => {
    const saved = window.localStorage.getItem("servicepilot-entry-v1");
    let restoreTimer: number | undefined;
    if (saved) try {
      const value = JSON.parse(saved) as { version?: number; workspace?: WorkspaceKey; role?: RoleKey; email?: string };
      if (value.version === 1 && value.workspace && value.role && workspaces[value.workspace]?.roles.includes(value.role)) {
        restoreTimer = window.setTimeout(() => {
          setWorkspace(value.workspace!); setRole(value.role!); setEmail(value.email ?? DEFAULT_DEMO_EMAIL); setEntryStage("app");
        }, 0);
      }
    } catch { window.localStorage.removeItem("servicepilot-entry-v1"); }
    return () => { if (restoreTimer !== undefined) window.clearTimeout(restoreTimer); };
  }, []);
  useEffect(() => {
    if (entryStage !== "app") return;
    fetch("/api/bootstrap", { method: "POST" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("bootstrap failed")))
      .then(() => setDataMode("persistent"))
      .catch(() => setDataMode("preview"));
  }, [entryStage]);
  if (entryStage === "login") return <LoginScreen email={email} error={loginError} onEmailChange={setEmail} onLogin={login} />;
  if (entryStage === "workspace") return <WorkspaceScreen email={email} onSelect={selectWorkspace} onLogout={logout} />;
  if (entryStage === "workbench") return <WorkbenchScreen workspace={workspace} onSelect={enterWorkbench} onBack={() => setEntryStage("workspace")} remember={rememberWorkbench} onRemember={setRememberWorkbench} />;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <header className="global-header">
      <div className="global-brand"><div className="brand-mark">S</div><b>ServicePilot</b><span>企业智能服务平台</span></div>
      <div className="global-search"><span>⌕</span><input aria-label="全局搜索" placeholder="搜索会话、工单、用户或知识…" /><kbd>⌘ K</kbd></div>
      <div className="global-tools">
        <button className="header-signal"><i className="signal-dot warning" /><span>我的待办</span><b>{workspaces[workspace].pending}</b></button>
        <button className="header-signal"><i className={`signal-dot ${dataMode}`} /><span>{dataMode === "persistent" ? "AI 运行正常" : dataMode === "preview" ? "安全预览" : "AI 连接中"}</span></button>
        <button className="text-tool" onClick={() => setDemoOpen(true)}>体验用户端</button>
        <button className="icon-button" aria-label="帮助">?</button>
        <button className="icon-button notification" aria-label="通知">○<i /></button>
        <div className="account-menu-wrap"><button className="global-profile" aria-label="账号与工作台" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(!accountMenuOpen)}><span>王</span><b>王瑞峰</b><em>⌄</em></button>{accountMenuOpen && <div className="account-menu"><div className="account-identity"><span>王</span><div><b>王瑞峰</b><small>{email}</small></div></div><div className="account-context"><small>当前空间</small><b>{workspaces[workspace].name}<em>{workspaces[workspace].environment}</em></b><small>当前工作台</small><strong>{roles[role].title}</strong></div>{workspaces[workspace].roles.length > 1 && <div className="account-workbenches"><small>切换授权工作台</small>{workspaces[workspace].roles.map((key) => <button key={key} className={role === key ? "active" : ""} onClick={() => enterWorkbench(key)}><span>{roles[key].label[0]}</span><b>{roles[key].title}</b>{role === key && <em>当前</em>}</button>)}</div>}<div className="account-actions"><button onClick={() => { setAccountMenuOpen(false); setEntryStage("workspace"); }}>切换企业空间</button><button>账号与安全</button><button className="logout-action" onClick={logout}>退出登录</button></div></div>}</div>
      </div>
    </header>
    <div className="app-body">
      <aside className="sidebar">
        <div className="workspace"><span>当前空间</span><button onClick={() => setEntryStage("workspace")}><i>{workspaces[workspace].initials}</i><b>{workspaces[workspace].name}</b><em>⌄</em></button></div>
        <div className="sidebar-workbench"><span>当前工作台</span><b>{roles[role].title}</b></div>
        <div className="nav-group-label">我的工作</div>
        <nav aria-label={`${roles[role].label}导航`}>{visibleNav.map((item) => <button key={item.key} aria-label={item.label} className={active === item.key ? "active" : ""} onClick={() => setActive(item.key)}><i aria-hidden="true">{item.short}</i><span>{item.label}</span>{item.key === "conversations" && <em aria-hidden="true">12</em>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="system-health"><span><i />系统运行正常</span><small>所有服务可用</small></div></div>
      </aside>
      <main id="main-content" tabIndex={-1}>
        <header className="topbar"><div><h1>{title.title}</h1><p>{title.desc}</p></div><div className="top-actions"><button className="icon-button" aria-label="刷新当前页面">↻</button><button className="ghost-button">操作记录</button></div></header>
        <div className={active === "resources" ? "content content-wide" : "content"}>
          {active === "workbench" && <RoleWorkbench role={role} workspaceName={workspaces[workspace].name} onNavigate={setActive} />}{active === "overview" && <Overview onNavigate={setActive} />}{active === "conversations" && <Conversations />}{active === "tickets" && <Tickets />}{active === "knowledge" && <Knowledge role={role} />}{active === "quality" && <Quality />}{active === "strategy" && <Strategy />}{active === "analytics" && <Analytics />}{active === "resources" && <ResourceAccess />}{active === "audit" && <Audit />}
        </div>
      </main>
    </div>
    {demoOpen && <CustomerDemo onClose={() => setDemoOpen(false)} />}
  </div>;
}
