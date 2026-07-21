"use client";

import { useEffect, useMemo, useState } from "react";

type NavKey = "overview" | "conversations" | "tickets" | "knowledge" | "quality" | "strategy" | "analytics" | "audit";

const navItems: Array<{ key: NavKey; label: string; short: string }> = [
  { key: "overview", label: "运营总览", short: "总" },
  { key: "conversations", label: "会话中心", short: "话" },
  { key: "tickets", label: "工单管理", short: "单" },
  { key: "knowledge", label: "知识库", short: "知" },
  { key: "quality", label: "质检中心", short: "检" },
  { key: "strategy", label: "策略中心", short: "策" },
  { key: "analytics", label: "数据分析", short: "数" },
  { key: "audit", label: "安全审计", short: "安" },
];

const conversations = [
  { id: "C-28471", name: "林女士", topic: "退款进度查询", channel: "商城 App", status: "需人工", risk: "中", time: "2分钟前", score: 72, sentiment: "焦虑" },
  { id: "C-28469", name: "周先生", topic: "物流改址", channel: "微信小程序", status: "AI处理中", risk: "低", time: "5分钟前", score: 94, sentiment: "中性" },
  { id: "C-28463", name: "陈女士", topic: "商品破损理赔", channel: "商城 App", status: "已转工单", risk: "高", time: "11分钟前", score: 61, sentiment: "不满" },
  { id: "C-28458", name: "赵先生", topic: "发票抬头修改", channel: "网页端", status: "已解决", risk: "低", time: "18分钟前", score: 97, sentiment: "满意" },
  { id: "C-28444", name: "吴女士", topic: "会员权益咨询", channel: "商城 App", status: "已解决", risk: "低", time: "26分钟前", score: 96, sentiment: "中性" },
];

const tickets = [
  { id: "T-9034", title: "生鲜破损理赔", customer: "陈女士", priority: "P1", owner: "王可", sla: "剩余 18 分钟", state: "处理中" },
  { id: "T-9032", title: "退款到账异常", customer: "林女士", priority: "P1", owner: "待分配", sla: "剩余 36 分钟", state: "待领取" },
  { id: "T-9027", title: "地址修改失败", customer: "周先生", priority: "P2", owner: "李岩", sla: "剩余 2 小时", state: "等待用户" },
  { id: "T-9018", title: "发票信息更正", customer: "赵先生", priority: "P3", owner: "孙悦", sla: "已完成", state: "已解决" },
];

const knowledgeDocs = [
  { title: "退款与到账时效规则", version: "v3.4", owner: "售后运营", updated: "今天 09:42", coverage: 96, state: "生效中" },
  { title: "生鲜商品破损赔付标准", version: "v2.8", owner: "生鲜业务", updated: "昨天 17:10", coverage: 88, state: "待复核" },
  { title: "物流地址修改操作指引", version: "v1.9", owner: "履约团队", updated: "07-18", coverage: 92, state: "生效中" },
  { title: "电子发票常见问题", version: "v4.1", owner: "财税运营", updated: "07-16", coverage: 99, state: "生效中" },
];

const screenTitles: Record<NavKey, { title: string; desc: string }> = {
  overview: { title: "运营总览", desc: "从业务结果到模型质量，定位今日服务风险" },
  conversations: { title: "会话中心", desc: "处理 AI 会话、人工接管与上下文协同" },
  tickets: { title: "工单管理", desc: "跨团队流转、SLA 管理和异常升级" },
  knowledge: { title: "知识库", desc: "管理可信知识、版本、权限与内容覆盖" },
  quality: { title: "质检中心", desc: "自动质检、人工复核与失败案例回流" },
  strategy: { title: "策略中心", desc: "配置路由、兜底、风险和模型策略" },
  analytics: { title: "数据分析", desc: "联动业务指标、AI 指标、成本与体验" },
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
  const [selected, setSelected] = useState(conversations[0]);
  const [claimed, setClaimed] = useState(false);
  const [draft, setDraft] = useState("您好，我已查询到退款申请于今天 10:26 审核通过，预计 1–3 个工作日原路退回。为避免信息误差，我可以为您继续核对支付渠道。 ");
  return (
    <section className="conversation-layout">
      <article className="panel conversation-list">
        <div className="list-toolbar"><div className="search-box">⌕ <input aria-label="搜索会话" placeholder="搜索会话、用户或订单" /></div><button className="filter-button">筛选</button></div>
        <div className="list-tabs"><button className="active">待处理 <b>12</b></button><button>处理中 <b>8</b></button><button>已结束</button></div>
        <div className="conversation-items">
          {conversations.map((item) => <button key={item.id} className={selected.id === item.id ? "conversation-item active" : "conversation-item"} onClick={() => { setSelected(item); setClaimed(false); }}>
            <span className="customer-avatar">{item.name[0]}</span><span className="conversation-main"><b>{item.name}<small>{item.time}</small></b><span>{item.topic}</span><em>{item.channel} · {item.id}</em></span><Status kind={item.risk === "高" ? "danger" : item.status === "需人工" ? "warning" : "info"}>{item.status}</Status>
          </button>)}
        </div>
      </article>

      <article className="panel chat-panel">
        <div className="chat-head"><div><b>{selected.name}</b><span>{selected.id} · {selected.channel}</span></div><div><Status kind={selected.risk === "高" ? "danger" : "warning"}>{selected.risk}风险</Status><button className="primary-button" onClick={() => setClaimed(true)}>{claimed ? "已由我接管" : "接管会话"}</button></div></div>
        <div className="chat-context"><span>识别意图：<b>{selected.topic}</b></span><span>情绪：<b>{selected.sentiment}</b></span><span>AI置信度：<b>{selected.score}%</b></span></div>
        <div className="messages">
          <div className="message customer"><span className="customer-avatar">{selected.name[0]}</span><p>我的退款怎么还没有到账？昨天显示审核通过了，能帮我查一下吗？<small>10:28</small></p></div>
          <div className="trace-card"><div><span className="trace-icon">1</span><p><b>意图识别</b><small>退款进度查询 · 置信度 0.96</small></p><em>124ms</em></div><div><span className="trace-icon">2</span><p><b>调用订单工具</b><small>order.refund.get · 已脱敏</small></p><em>386ms</em></div><div><span className="trace-icon">3</span><p><b>检索知识库</b><small>命中“退款与到账时效规则 v3.4”</small></p><em>212ms</em></div></div>
          <div className="message agent"><span className="agent-avatar">AI</span><p>您的退款已审核通过，预计将在 1–3 个工作日内原路退回。具体到账时间可能受到支付渠道影响。<a>退款与到账时效规则 v3.4 ↗</a><small>10:28 · 自动回复</small></p></div>
          <div className="message customer"><span className="customer-avatar">{selected.name[0]}</span><p>但我是急用，能不能今天到账？<small>10:29</small></p></div>
          <div className="handoff-note"><b>触发人工接管</b><span>用户表达紧急诉求，AI无法承诺到账时间；已生成会话摘要并保留完整上下文。</span></div>
        </div>
        <div className="reply-box"><div className="reply-tools"><button>AI回复建议</button><button>知识引用</button><button>创建工单</button><span>发送前需人工确认</span></div><textarea aria-label="客服回复" value={draft} onChange={(e) => setDraft(e.target.value)} /><div className="reply-actions"><span>{draft.length}/500</span><button className="ghost-button">保存草稿</button><button className="primary-button">审核并发送</button></div></div>
      </article>

      <aside className="panel insight-panel">
        <div className="insight-section"><h3>用户上下文</h3><dl><div><dt>用户等级</dt><dd>金卡会员</dd></div><div><dt>近90天订单</dt><dd>12 单 / ¥2,418</dd></div><div><dt>历史投诉</dt><dd>0 次</dd></div><div><dt>关联订单</dt><dd><a>#OR-773928</a></dd></div></dl></div>
        <div className="insight-section"><h3>AI会话摘要</h3><p>用户查询昨日审核通过的退款，希望今日到账。系统确认退款状态正常，但无法承诺支付渠道的具体到账时间。</p><Status kind="warning">建议：解释时效并持续跟进</Status></div>
        <div className="insight-section"><h3>下一步建议</h3><button className="next-action"><b>核对支付渠道</b><span>预计 30 秒</span></button><button className="next-action"><b>创建加急跟踪工单</b><span>需主管审批</span></button></div>
      </aside>
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

function Knowledge() {
  const [query, setQuery] = useState("");
  const docs = knowledgeDocs.filter((d) => d.title.includes(query));
  return <section className="knowledge-layout">
    <article className="panel knowledge-main"><div className="table-toolbar"><div className="search-box wide">⌕ <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索知识、规则或负责人" /></div><button className="ghost-button">批量导入</button><button className="primary-button">＋ 新建知识</button></div>
      <div className="knowledge-summary"><div><span>知识条目</span><b>1,284</b></div><div><span>近7日更新</span><b>46</b></div><div><span>待复核</span><b className="warning-text">12</b></div><div><span>问答覆盖率</span><b>91.6%</b></div></div>
      <table><thead><tr><th>知识文档</th><th>版本</th><th>责任团队</th><th>问题覆盖率</th><th>更新时间</th><th>状态</th></tr></thead><tbody>{docs.map((doc) => <tr key={doc.title}><td><b>{doc.title}</b><small>结构化规则 · 可追溯引用</small></td><td>{doc.version}</td><td>{doc.owner}</td><td><div className="coverage"><i style={{ width: `${doc.coverage}%` }} /><span>{doc.coverage}%</span></div></td><td>{doc.updated}</td><td><Status kind={doc.state === "生效中" ? "success" : "warning"}>{doc.state}</Status></td></tr>)}</tbody></table>
    </article>
    <aside className="panel knowledge-aside"><h3>内容治理流程</h3><div className="governance-step done"><i>1</i><p><b>内容录入</b><span>来源、责任人、有效期</span></p></div><div className="governance-step done"><i>2</i><p><b>自动解析</b><span>切片、标签、冲突检测</span></p></div><div className="governance-step active"><i>3</i><p><b>双人复核</b><span>业务与合规共同确认</span></p></div><div className="governance-step"><i>4</i><p><b>灰度发布</b><span>小流量验证命中效果</span></p></div><div className="governance-step"><i>5</i><p><b>失效归档</b><span>保留版本与审计记录</span></p></div><div className="aside-callout"><b>检测到 3 处潜在冲突</b><span>“生鲜赔付标准”与旧版客服 SOP 存在口径差异。</span><button>查看冲突</button></div></aside>
  </section>;
}

type EvaluationRun = { id: string; model: string; datasetVersion: string; suite?: string; systemVersion?: string; totalCases: number; passedCases: number; passRate: number; highRiskPassRate: number; averageLatencyMs: number; completedAt?: string | null };
type EvaluationResultView = { id: string; category: string; query: string; passed: boolean; failures: string[] };

function EvaluationDashboard({ onCompleted }: { onCompleted?: () => void }) {
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [results, setResults] = useState<EvaluationResultView[]>([]);
  const [running, setRunning] = useState<"regression" | "blind" | null>(null);
  const [error, setError] = useState("");
  const [blindConsumed, setBlindConsumed] = useState(false);
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
  return <section className="panel evaluation-panel"><div className="evaluation-head"><div><span className="eyebrow">真实模型回归</span><h3>qwen-plus 基线评测</h3><p>回归集 100 条 · 冻结盲测 40 条 + 安全门禁 15 条 · 多轮上下文 · 结果写入 D1</p></div><div className="evaluation-actions"><button className="ghost-button" disabled={Boolean(running) || blindConsumed} onClick={() => runEvaluation("blind")}>{running === "blind" ? "正在运行盲测…" : blindConsumed ? "本版本盲测已完成" : "运行冻结盲测"}</button><button className="primary-button" disabled={Boolean(running)} onClick={() => runEvaluation("regression")}>{running === "regression" ? "正在调用模型…" : run ? "重新运行回归" : "运行首轮回归"}</button></div></div>
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
        {selected.review ? <div className="reviewed-note"><b>{selected.review.decision === "confirmed_failure" ? "确认系统失败" : selected.review.decision === "label_issue" ? "标记标签问题" : "确认行为可接受"}</b><span>{selected.review.note || `复核人：${selected.review.reviewerEmail}`}</span></div> : <><textarea className="review-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="复核说明；标记标签问题时必填" /><div className="review-actions"><button disabled={saving} className="danger-button" onClick={() => submit("confirmed_failure")}>确认系统失败</button><button disabled={saving || note.trim().length < 4} className="ghost-button" onClick={() => submit("label_issue")}>标记标签问题</button><button disabled={saving} className="primary-button" onClick={() => submit("accepted_behavior")}>行为可接受</button></div></>}</div> : <div className="review-empty">{items.length ? "当前筛选下没有案例" : "暂无需要人工复核的失败案例"}</div>}
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
  return <section className="strategy-layout"><article className="panel strategy-main"><div className="strategy-header"><div><h3>生产策略集</h3><p>默认客服 Agent · v2.7 · 今日 08:30 发布</p></div><button className="ghost-button">版本记录</button><button className="primary-button">发布新版本</button></div><div className="strategy-section"><h4>安全与人工接管</h4>{items.map(([title, desc], i) => <div className="setting-row" key={title}><div><b>{title}</b><span>{desc}</span></div><button aria-label={`切换${title}`} className={rules[i] ? "switch on" : "switch"} onClick={() => toggle(i)}><i /></button></div>)}</div><div className="strategy-section"><h4>模型路由</h4><div className="routing-card"><div><Status kind="info">常规问答</Status><p><b>Qwen-Plus</b><span>低成本 · 平均 1.2s</span></p></div><div className="routing-arrow">→</div><div><Status kind="warning">复杂推理</Status><p><b>DeepSeek-V3</b><span>高准确 · 平均 2.8s</span></p></div><div className="routing-arrow">→</div><div><Status kind="danger">高风险</Status><p><b>人工客服</b><span>不允许自动承诺</span></p></div></div></div></article><aside className="panel strategy-aside"><h3>发布检查</h3><ul><li className="pass">评测集通过率 96.4%</li><li className="pass">高风险用例全部通过</li><li className="pass">平均成本未超过预算</li><li className="warn">3 条边界 Case 待确认</li></ul><div className="approval"><b>双人审批</b><span>产品负责人 ✓</span><span>业务合规 待审批</span></div></aside></section>;
}

function Analytics() {
  return <><section className="metrics-grid"><MetricCard label="今日会话量" value="3,842" change="+12.4%" helper="高峰 10:00–11:00" tone="blue" /><MetricCard label="单会话成本" value="¥0.084" change="-8.2%" helper="预算 ¥0.10" tone="green" /><MetricCard label="平均响应时延" value="1.64s" change="-0.21s" helper="P95 3.82s" tone="purple" /><MetricCard label="建议采纳率" value="76.8%" change="+5.6%" helper="人工客服端" tone="orange" /></section><section className="analytics-grid"><article className="panel funnel-panel"><div className="panel-head"><div><h3>会话解决漏斗</h3><p>从用户发起咨询到问题关闭</p></div><button className="ghost-button">按渠道⌄</button></div><div className="funnel"><div style={{width:'100%'}}><span>发起会话</span><b>3,842</b></div><div style={{width:'88%'}}><span>AI成功识别</span><b>3,391</b></div><div style={{width:'71%'}}><span>AI完成处理</span><b>2,729</b></div><div style={{width:'61%'}}><span>用户确认解决</span><b>2,347</b></div></div></article><article className="panel matrix-panel"><div className="panel-head"><div><h3>质量 × 成本矩阵</h3><p>用于模型路由与预算决策</p></div></div><div className="matrix"><span className="quadrant-label top">高质量</span><span className="quadrant-label right">高成本</span><i className="bubble qwen">Qwen</i><i className="bubble deepseek">DeepSeek</i><i className="bubble mini">Mini</i><i className="bubble human">人工</i></div><p className="matrix-note">建议：常规咨询保持 Qwen；复杂退款场景使用 DeepSeek；高风险承诺转人工。</p></article></section></>;
}

function Audit() {
  return <section className="audit-layout"><article className="panel table-panel"><div className="table-toolbar"><div className="search-box wide">⌕ <input placeholder="搜索操作人、资源或审计编号" /></div><button className="filter-button">风险等级</button><button className="filter-button">导出记录</button></div><table><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th><th>结果</th><th>风险</th></tr></thead><tbody>
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
      const response = await fetch("/api/agent/respond", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: value, history: history.slice(-6), conversationId: activeConversationId }) });
      const body = await response.json() as AgentResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "服务暂时不可用");
      setResult(body); setHistory((previous) => [...previous, { role: "user", content: value }, { role: "assistant", content: body.answer }].slice(-6) as DemoTurn[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "服务暂时不可用"); }
    finally { setLoading(false); }
  }
  const quick = ["订单 OR-773928 的退款什么时候到账？", "那周末算工作日吗？", "收到的生鲜破损了怎么办？", "订单还没发货怎么改地址？"];
  const resetConversation = () => { setConversationId(""); setHistory([]); setSubmitted(""); setResult(null); setError(""); };
  return <div className="modal-backdrop" onClick={onClose}><div className="customer-demo" onClick={(e) => e.stopPropagation()}><div className="demo-head"><div className="brand-mark small">S</div><div><b>商城智能客服</b><span>Agent API 已连接 · 30 分钟会话记忆 · 随时可转人工</span></div><button aria-label="新会话" onClick={resetConversation}>↻</button><button aria-label="关闭" onClick={onClose}>×</button></div><div className="demo-body"><div className="demo-welcome"><b>您好，我是商城智能客服</b><span>先询问退款，再追问“那周末算工作日吗”，体验多轮意图继承。</span></div><div className="quick-questions">{quick.map((item) => <button key={item} onClick={() => send(item)}>{item.replace("？", "")}</button>)}</div>{submitted && <div className="demo-user">{submitted}</div>}{loading && <div className="demo-ai loading"><b>正在执行 Agent 工作流</b><span>会话状态 → 意图识别 → 知识检索 → 风险校验</span></div>}{error && <div className="demo-ai error"><b>请求失败</b><span>{error}</span></div>}{result && <div className="demo-ai"><b>{result.handoff ? "已生成安全答复并建议转人工" : "已基于可信知识回答"}</b><span>{result.answer}</span>{result.source && <a>依据：{result.source.title} {result.source.version} · {result.source.id}</a>}<small>置信度 {(result.confidence * 100).toFixed(0)}% · {result.mode === "model-grounded" ? "大模型生成（有依据约束）" : result.mode === "safe-fallback" ? "低置信度安全兜底" : "确定性安全模式"}</small>{result.memory && <small>会话记忆：{result.memory.activeIntent ?? "未识别"} · 第 {result.memory.turnCount} 轮 · {result.memory.source === "memory" ? "状态继承" : result.memory.source === "history" ? "历史上下文" : "当前问题"}</small>}<div className="demo-trace">{result.trace.map((step, index) => <i key={step.label}>{index + 1}. {step.label}</i>)}</div>{result.handoff && <button className="handoff-button">转接人工客服</button>}</div>}</div><div className="demo-input"><input value={query} maxLength={500} onChange={(e) => setQuery(e.target.value)} placeholder="请输入您的问题" onKeyDown={(e) => e.key === 'Enter' && send()} /><button disabled={loading} onClick={() => send()}>{loading ? "处理中" : "发送"}</button></div><div className="demo-footer">AI生成内容仅供参考 · 会话记忆 30 分钟后自动失效 · 涉及资金、赔付和账户操作需人工确认</div></div></div>;
}

export default function Home() {
  const [active, setActive] = useState<NavKey>("overview");
  const [demoOpen, setDemoOpen] = useState(false);
  const [dataMode, setDataMode] = useState<"connecting" | "persistent" | "preview">("connecting");
  const title = useMemo(() => screenTitles[active], [active]);
  useEffect(() => {
    fetch("/api/bootstrap", { method: "POST" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("bootstrap failed")))
      .then(() => setDataMode("persistent"))
      .catch(() => setDataMode("preview"));
  }, []);
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">S</div><div><b>ServicePilot</b><span>企业智能服务平台</span></div></div><div className="workspace"><span>当前空间</span><button><i>云</i><b>青屿商城</b><em>⌄</em></button></div><nav>{navItems.map((item) => <button key={item.key} className={active === item.key ? "active" : ""} onClick={() => setActive(item.key)}><i>{item.short}</i><span>{item.label}</span>{item.key === "conversations" && <em>12</em>}</button>)}</nav><div className="sidebar-bottom"><div className="system-health"><span><i />系统运行正常</span><small>所有服务可用</small></div><button className="profile"><span>王</span><p><b>王瑞峰</b><small>产品管理员</small></p><em>···</em></button></div></aside>
    <main><header className="topbar"><div><h1>{title.title}</h1><p>{title.desc}</p></div><div className="top-actions"><span className={`data-mode ${dataMode}`}>{dataMode === "persistent" ? "持久数据已连接" : dataMode === "preview" ? "安全预览模式" : "正在连接数据"}</span><button className="demo-button" onClick={() => setDemoOpen(true)}>体验用户端</button><button className="icon-button" aria-label="帮助">?</button><button className="icon-button notification" aria-label="通知">○<i /></button></div></header><div className="content">
      {active === "overview" && <Overview onNavigate={setActive} />}{active === "conversations" && <Conversations />}{active === "tickets" && <Tickets />}{active === "knowledge" && <Knowledge />}{active === "quality" && <Quality />}{active === "strategy" && <Strategy />}{active === "analytics" && <Analytics />}{active === "audit" && <Audit />}
    </div></main>{demoOpen && <CustomerDemo onClose={() => setDemoOpen(false)} />}
  </div>;
}
