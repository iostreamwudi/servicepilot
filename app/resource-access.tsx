"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

type Metric = {
  id: string;
  name: string;
  code: string;
  status: "在线" | "校验中";
  owner: string;
  source: string;
  definition: string;
  formula: string;
  updatedAt: string;
  quality: string;
};

type ResourceInterface = {
  id: string;
  name: string;
  method: string;
  metrics: Metric[];
};

type ResourceTask = {
  id: string;
  name: string;
  interfaces: ResourceInterface[];
};

type PersonPermission = {
  id: string;
  name: string;
  email: string;
  initials: string;
  view: boolean;
  edit: boolean;
  mode: "direct" | "inherited";
  source: string;
  conflict?: string;
};

const RESOURCE_TABS = ["basic", "permissions"] as const;

const RESOURCE_TASKS: ResourceTask[] = [
  {
    id: "task-commerce",
    name: "商城客服数据资产",
    interfaces: [
      {
        id: "api-after-sales",
        name: "订单售后 API",
        method: "POST",
        metrics: [
          {
            id: "metric-resolution",
            name: "自助解决率",
            code: "self_resolution_rate",
            status: "在线",
            owner: "周敏",
            source: "D1 · service_session_daily",
            definition: "由 AI 独立完成且用户未在 24 小时内再次追问的会话，占有效服务会话总量的比例。",
            formula: "AI 独立解决会话数 / 有效服务会话数 × 100%",
            updatedAt: "2026-07-27 09:42",
            quality: "99.82%",
          },
          {
            id: "metric-handoff",
            name: "转人工率",
            code: "human_handoff_rate",
            status: "在线",
            owner: "王可",
            source: "D1 · agent_handoff_event",
            definition: "由安全策略、低置信度或用户主动诉求触发人工接管的会话占比。",
            formula: "转人工会话数 / 有效服务会话数 × 100%",
            updatedAt: "2026-07-27 09:42",
            quality: "99.76%",
          },
          {
            id: "metric-ood",
            name: "OOD 安全兜底率",
            code: "ood_fallback_rate",
            status: "校验中",
            owner: "李岩",
            source: "Evaluation · routing_full",
            definition: "未支持意图被系统识别并进入安全兜底链路的比例。",
            formula: "安全兜底 OOD 样本 / 全部 OOD 样本 × 100%",
            updatedAt: "2026-07-27 09:36",
            quality: "95.18%",
          },
        ],
      },
      {
        id: "api-knowledge",
        name: "知识检索 API",
        method: "GET",
        metrics: [
          {
            id: "metric-hit",
            name: "知识命中率",
            code: "knowledge_hit_rate",
            status: "在线",
            owner: "陈悠",
            source: "D1 · knowledge_retrieval_log",
            definition: "有效问答请求中至少返回一个可信知识片段的比例。",
            formula: "有知识依据的请求数 / 有效问答请求数 × 100%",
            updatedAt: "2026-07-27 09:40",
            quality: "98.63%",
          },
        ],
      },
    ],
  },
  {
    id: "task-quality",
    name: "客服质量评测",
    interfaces: [
      {
        id: "api-evaluation",
        name: "离线评测 API",
        method: "POST",
        metrics: [
          {
            id: "metric-context",
            name: "上下文专项通过率",
            code: "context_pass_rate",
            status: "在线",
            owner: "王瑞峰",
            source: "CSDS · complete baseline",
            definition: "需要依赖历史轮次才能正确路由和回答的样本通过比例。",
            formula: "上下文通过样本 / 上下文专项样本 × 100%",
            updatedAt: "2026-07-27 08:58",
            quality: "75.08%",
          },
        ],
      },
    ],
  },
];

const INITIAL_PERMISSIONS: PersonPermission[] = [
  { id: "p-wang", name: "王瑞峰", email: "wang.ruifeng@qingyu.cn", initials: "WR", view: true, edit: true, mode: "direct", source: "当前指标直接配置" },
  { id: "p-zhou", name: "周敏", email: "zhou.min@qingyu.cn", initials: "ZM", view: true, edit: false, mode: "inherited", source: "继承自接口：订单售后 API" },
  { id: "p-chen", name: "陈悠", email: "chen.you@qingyu.cn", initials: "CY", view: true, edit: false, mode: "direct", source: "当前指标直接配置" },
  { id: "p-li", name: "李岩", email: "li.yan@qingyu.cn", initials: "LY", view: true, edit: true, mode: "inherited", source: "继承自任务：商城客服数据资产" },
  { id: "p-zhao", name: "赵婧", email: "zhao.jing@qingyu.cn", initials: "ZJ", view: true, edit: false, mode: "direct", source: "当前指标覆盖父级权限", conflict: "父级授予修改权限，当前指标已收窄为仅查看" },
];

const DIRECTORY = [
  { id: "p-lin", name: "林晴", email: "lin.qing@qingyu.cn", initials: "LQ" },
  { id: "p-sun", name: "孙悦", email: "sun.yue@qingyu.cn", initials: "SY" },
  { id: "p-he", name: "何澄", email: "he.cheng@qingyu.cn", initials: "HC" },
];

const ALL_METRICS = RESOURCE_TASKS.flatMap((task) => task.interfaces.flatMap((resourceInterface) => resourceInterface.metrics));

function highlightText(value: string, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return value;
  const index = value.toLocaleLowerCase().indexOf(normalized);
  if (index < 0) return value;
  return <>{value.slice(0, index)}<mark>{value.slice(index, index + normalized.length)}</mark>{value.slice(index + normalized.length)}</>;
}

function PermissionToggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      className={checked ? "access-toggle is-on" : "access-toggle"}
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
    >
      <span aria-hidden="true" />
    </button>
  );
}

export default function ResourceAccess() {
  const [selectedMetricId, setSelectedMetricId] = useState(ALL_METRICS[0].id);
  const [expandedTasks, setExpandedTasks] = useState(() => new Set(RESOURCE_TASKS.map((task) => task.id)));
  const [expandedInterfaces, setExpandedInterfaces] = useState(() => new Set(RESOURCE_TASKS.flatMap((task) => task.interfaces.map((item) => item.id))));
  const [resourceQuery, setResourceQuery] = useState("");
  const [resourceFilter, setResourceFilter] = useState<"all" | "checking">("all");
  const [personQuery, setPersonQuery] = useState("");
  const deferredResourceQuery = useDeferredValue(resourceQuery);
  const deferredPersonQuery = useDeferredValue(personQuery);
  const [permissions, setPermissions] = useState(INITIAL_PERMISSIONS);
  const [savedPermissions, setSavedPermissions] = useState(INITIAL_PERMISSIONS);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "synced">("idle");
  const [activeTab, setActiveTab] = useState<"basic" | "permissions">("basic");

  const selectedMetric = useMemo(
    () => ALL_METRICS.find((metric) => metric.id === selectedMetricId) ?? ALL_METRICS[0],
    [selectedMetricId],
  );

  const filteredTasks = useMemo(() => {
    const query = deferredResourceQuery.trim().toLocaleLowerCase();
    if (!query && resourceFilter === "all") return RESOURCE_TASKS;
    return RESOURCE_TASKS.flatMap((task) => {
      const interfaces = task.interfaces.flatMap((resourceInterface) => {
        const metrics = resourceInterface.metrics.filter((metric) => {
          const matchesQuery = !query || `${metric.name} ${metric.code}`.toLocaleLowerCase().includes(query);
          const matchesFilter = resourceFilter === "all" || metric.status === "校验中";
          return matchesQuery && matchesFilter;
        });
        if (resourceFilter === "all" && resourceInterface.name.toLocaleLowerCase().includes(query)) return resourceInterface;
        return metrics.length ? [{ ...resourceInterface, metrics }] : [];
      });
      if (resourceFilter === "all" && task.name.toLocaleLowerCase().includes(query)) return task;
      return interfaces.length ? [{ ...task, interfaces }] : [];
    });
  }, [deferredResourceQuery, resourceFilter]);

  const directoryMatches = useMemo(() => {
    const query = deferredPersonQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    const currentIds = new Set(permissions.map((person) => person.id));
    return DIRECTORY.filter((person) =>
      !currentIds.has(person.id) && `${person.name} ${person.email}`.toLocaleLowerCase().includes(query),
    );
  }, [deferredPersonQuery, permissions]);

  const visiblePermissions = useMemo(() => {
    const query = deferredPersonQuery.trim().toLocaleLowerCase();
    if (!query) return permissions;
    return permissions.filter((person) => `${person.name} ${person.email}`.toLocaleLowerCase().includes(query));
  }, [deferredPersonQuery, permissions]);

  const hasChanges = useMemo(
    () => JSON.stringify(permissions) !== JSON.stringify(savedPermissions),
    [permissions, savedPermissions],
  );

  useEffect(() => {
    if (!hasChanges) return;
    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnAboutUnsavedChanges);
    return () => window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
  }, [hasChanges]);

  const directCount = permissions.filter((person) => person.mode === "direct").length;
  const conflictCount = permissions.filter((person) => person.conflict).length;

  function toggleTask(id: string) {
    setExpandedTasks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleInterface(id: string) {
    setExpandedInterfaces((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updatePermission(id: string, field: "view" | "edit") {
    setSaveState("idle");
    setPermissions((current) => current.map((person) => {
      if (person.id !== id || person.mode === "inherited") return person;
      if (field === "edit") return { ...person, edit: !person.edit, view: person.edit ? person.view : true };
      return { ...person, view: !person.view, edit: person.view ? false : person.edit };
    }));
  }

  function convertToDirect(id: string) {
    setSaveState("idle");
    setPermissions((current) => current.map((person) =>
      person.id === id ? { ...person, mode: "direct", source: "当前指标直接配置" } : person,
    ));
  }

  function addPerson(person: typeof DIRECTORY[number]) {
    setSaveState("idle");
    setPermissions((current) => [
      ...current,
      { ...person, view: true, edit: false, mode: "direct", source: "当前指标直接配置" },
    ]);
    setPersonQuery("");
  }

  function savePermissions() {
    if (!hasChanges || saveState === "saving") return;
    setSaveState("saving");
    window.setTimeout(() => {
      setSavedPermissions(permissions);
      setSaveState("saved");
    }, 620);
  }

  function syncResources() {
    if (syncState === "syncing") return;
    setSyncState("syncing");
    window.setTimeout(() => setSyncState("synced"), 780);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = RESOURCE_TABS.indexOf(activeTab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? RESOURCE_TABS.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + RESOURCE_TABS.length) % RESOURCE_TABS.length;
    const nextTab = RESOURCE_TABS[nextIndex];
    setActiveTab(nextTab);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`#resource-tab-${nextTab}`)
      ?.focus();
  }

  const currentValue = selectedMetric.id === "metric-resolution" ? "68.42%" : selectedMetric.id === "metric-handoff" ? "22.61%" : selectedMetric.quality;

  return (
    <section className="resource-access" aria-labelledby="resource-page-title">
      <header className="resource-toolbar">
        <div>
          <h2 id="resource-page-title">数据资源与人员权限</h2>
          <p>按任务、接口、指标逐级管理访问边界，所有修改均进入安全审计。</p>
        </div>
        <dl className="resource-summary">
          <div><dt>数据来源</dt><dd>ServicePilot Production</dd></div>
          <div><dt>最近同步</dt><dd>{syncState === "synced" ? "刚刚" : "2026-07-27 09:42"}</dd></div>
          <div><dt>资源规模</dt><dd>2 个任务 · 3 个接口 · 5 个指标</dd></div>
        </dl>
        <button className="primary-button" type="button" disabled={syncState === "syncing"} onClick={syncResources}>
          {syncState === "syncing" ? "正在同步…" : "同步资源"}
        </button>
      </header>

      <div className="resource-workbench">
        <aside className="resource-tree-panel" aria-label="资源树">
          <div className="resource-panel-head">
            <div><strong>资源目录</strong><span>任务 → 接口 → 指标</span></div>
            <button type="button" title="折叠全部资源" aria-label="折叠全部资源" onClick={() => { setExpandedTasks(new Set()); setExpandedInterfaces(new Set()); }}>收起</button>
          </div>
          <label className="resource-search">
            <span aria-hidden="true" />
            <span className="sr-only">搜索任务、接口或指标</span>
            <input name="resource-search" autoComplete="off" value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} placeholder="搜索资源…" />
          </label>
          <div className="resource-filter-row"><span>状态</span><button className={resourceFilter === "all" ? "active" : ""} type="button" onClick={() => setResourceFilter("all")}>全部</button><button className={resourceFilter === "checking" ? "active" : ""} type="button" onClick={() => setResourceFilter("checking")}>校验中</button></div>
          <div className="resource-tree" aria-live="polite">
            {filteredTasks.length ? filteredTasks.map((task) => {
              const taskExpanded = expandedTasks.has(task.id) || Boolean(resourceQuery);
              return <div className="tree-task" key={task.id}>
                <button className="tree-row tree-task-row" type="button" aria-expanded={taskExpanded} onClick={() => toggleTask(task.id)} title={task.name}>
                  <span className={taskExpanded ? "tree-caret is-open" : "tree-caret"} aria-hidden="true" />
                  <span className="tree-code">T</span>
                  <span className="tree-copy"><strong>{highlightText(task.name, resourceQuery)}</strong><small>{task.interfaces.length} 个接口</small></span>
                </button>
                {taskExpanded ? <div className="tree-branch">{task.interfaces.map((resourceInterface) => {
                  const interfaceExpanded = expandedInterfaces.has(resourceInterface.id) || Boolean(resourceQuery);
                  return <div className="tree-interface" key={resourceInterface.id}>
                    <button className="tree-row tree-interface-row" type="button" aria-expanded={interfaceExpanded} onClick={() => toggleInterface(resourceInterface.id)} title={resourceInterface.name}>
                      <span className={interfaceExpanded ? "tree-caret is-open" : "tree-caret"} aria-hidden="true" />
                      <span className="tree-code api">API</span>
                      <span className="tree-copy"><strong>{highlightText(resourceInterface.name, resourceQuery)}</strong><small>{resourceInterface.method} · {resourceInterface.metrics.length} 个指标</small></span>
                    </button>
                    {interfaceExpanded ? <div className="tree-metrics">{resourceInterface.metrics.map((metric) => <button
                      type="button"
                      key={metric.id}
                      className={metric.id === selectedMetric.id ? "tree-row tree-metric-row is-selected" : "tree-row tree-metric-row"}
                      aria-current={metric.id === selectedMetric.id ? "true" : undefined}
                      onClick={() => setSelectedMetricId(metric.id)}
                      title={`${metric.name} · ${metric.code}`}
                    >
                      <span className="tree-metric-dot" aria-hidden="true" />
                      <span className="tree-copy"><strong>{highlightText(metric.name, resourceQuery)}</strong><small>{metric.code}</small></span>
                    </button>)}</div> : null}
                  </div>;
                })}</div> : null}
              </div>;
            }) : <div className="resource-empty"><strong>未找到匹配资源</strong><p>检查关键词，或清除搜索后查看全部层级。</p><button type="button" onClick={() => setResourceQuery("")}>清除搜索</button></div>}
          </div>
        </aside>

        <article className="resource-main-panel">
          <header className="metric-page-head">
            <div>
              <div className="metric-title-line"><h3>{selectedMetric.name}</h3><span className={selectedMetric.status === "在线" ? "metric-state" : "metric-state is-checking"}>{selectedMetric.status}</span></div>
              <p><code>{selectedMetric.code}</code><span>责任人：{selectedMetric.owner}</span><span>更新于 {selectedMetric.updatedAt}</span></p>
            </div>
            <div className="metric-head-actions"><button className="ghost-button" type="button">查看血缘</button><button className="ghost-button" type="button">更多</button></div>
          </header>
          <nav className="resource-tabs" aria-label="指标信息" role="tablist">
            <button id="resource-tab-basic" type="button" role="tab" aria-controls="resource-panel-basic" aria-selected={activeTab === "basic"} tabIndex={activeTab === "basic" ? 0 : -1} className={activeTab === "basic" ? "active" : ""} onKeyDown={handleTabKeyDown} onClick={() => setActiveTab("basic")}>基本信息</button>
            <button id="resource-tab-permissions" type="button" role="tab" aria-controls="resource-panel-permissions" aria-selected={activeTab === "permissions"} tabIndex={activeTab === "permissions" ? 0 : -1} className={activeTab === "permissions" ? "active" : ""} onKeyDown={handleTabKeyDown} onClick={() => setActiveTab("permissions")}>权限配置 <span>{permissions.length}</span></button>
          </nav>

          {activeTab === "basic" ? <div id="resource-panel-basic" className="metric-basic" role="tabpanel" aria-labelledby="resource-tab-basic" tabIndex={0}>
            <section className="metric-overview-strip">
              <div><span>当前观测值</span><strong>{currentValue}</strong><small>较 7 日基线 +2.38%</small></div>
              <div><span>质量得分</span><strong>{selectedMetric.quality}</strong><small>校验规则全部通过</small></div>
              <div><span>敏感级别</span><strong>L2 · 内部</strong><small>仅限已授权人员</small></div>
              <div><span>刷新频率</span><strong>5 分钟</strong><small>增量同步</small></div>
            </section>
            <section className="metric-info-section">
              <h4>业务信息</h4>
              <dl className="description-grid">
                <div><dt>指标说明</dt><dd>{selectedMetric.definition}</dd></div>
                <div><dt>计算公式</dt><dd><code>{selectedMetric.formula}</code></dd></div>
                <div><dt>统计粒度</dt><dd>会话 / 自然日 / UTC+8</dd></div>
                <div><dt>指标版本</dt><dd>v3.4</dd></div>
              </dl>
            </section>
            <section className="metric-info-section">
              <h4>数据信息</h4>
              <dl className="description-grid">
                <div><dt>数据来源</dt><dd>{selectedMetric.source}</dd></div>
                <div><dt>最近更新</dt><dd>{selectedMetric.updatedAt}</dd></div>
                <div><dt>责任人</dt><dd>{selectedMetric.owner}</dd></div>
                <div><dt>运行状态</dt><dd>{selectedMetric.status}</dd></div>
              </dl>
            </section>
            <div className="metric-audit-note"><span aria-hidden="true">i</span><p><strong>权限继承路径</strong>任务“商城客服数据资产” → 接口“订单售后 API” → 当前指标。直接配置优先于父级继承。</p></div>
          </div> : <div id="resource-panel-permissions" className="permission-workspace" role="tabpanel" aria-labelledby="resource-tab-permissions" tabIndex={0}>
            <div className="permission-toolbar">
              <div><h4>已授权人员</h4><p>权限仅面向具体人员，所有变更均记录来源。</p></div>
              <label className="resource-search person-search">
                <span aria-hidden="true" /><span className="sr-only">搜索姓名或邮箱</span>
                <input name="person-search" autoComplete="off" spellCheck={false} value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="搜索姓名或邮箱…" />
              </label>
            </div>
            {directoryMatches.length > 0 ? <div className="directory-results" aria-label="可添加人员">
              {directoryMatches.map((person) => <button type="button" key={person.id} onClick={() => addPerson(person)}><span>{person.initials}</span><p><strong>{person.name}</strong><small>{person.email}</small></p><b>添加</b></button>)}
            </div> : null}
            <div className="permission-table-wrap">
              <table className="permission-table">
                <thead><tr><th>人员</th><th>权限来源</th><th>查看</th><th>修改</th><th>说明</th><th>操作</th></tr></thead>
                <tbody>{visiblePermissions.length ? visiblePermissions.map((person) => <tr className={person.conflict ? "has-conflict" : ""} key={person.id}>
                  <td><div className="permission-person"><span className="permission-avatar">{person.initials}</span><p><strong>{person.name}</strong><small>{person.email}</small></p></div></td>
                  <td><span className={person.mode === "direct" ? "source-label is-direct" : "source-label"}>{person.mode === "direct" ? "直接配置" : "父级继承"}</span></td>
                  <td><PermissionToggle checked={person.view} disabled={person.mode === "inherited" || saveState === "saving"} label={`${person.name}查看权限`} onChange={() => updatePermission(person.id, "view")} /></td>
                  <td><PermissionToggle checked={person.edit} disabled={person.mode === "inherited" || saveState === "saving"} label={`${person.name}修改权限`} onChange={() => updatePermission(person.id, "edit")} /></td>
                  <td><span className="permission-source-text" title={person.conflict ?? person.source}>{person.conflict ?? person.source}</span></td>
                  <td>{person.mode === "inherited" ? <button className="text-button" type="button" onClick={() => convertToDirect(person.id)}>转为直接配置</button> : <span className="muted">—</span>}</td>
                </tr>) : <tr><td colSpan={6}><div className="permission-empty"><strong>没有匹配的已授权人员</strong><p>可从上方搜索结果添加人员。</p></div></td></tr>}</tbody>
              </table>
            </div>
            <div className="permission-note"><span>直接配置 {directCount} 人</span><span>父级继承 {permissions.length - directCount} 人</span><span>{conflictCount ? `${conflictCount} 个覆盖项需关注` : "无权限冲突"}</span></div>
            <div className="permission-actions">
              <div aria-live="polite">{saveState === "saved" ? <span className="save-success">已保存并写入审计日志</span> : hasChanges ? <span>有未保存的修改</span> : <span>权限配置已是最新</span>}</div>
              <button type="button" className="ghost-button" disabled={!hasChanges || saveState === "saving"} onClick={() => { setPermissions(savedPermissions); setSaveState("idle"); }}>撤销</button>
              <button type="button" className="primary-button" disabled={!hasChanges || saveState === "saving"} onClick={savePermissions}>{saveState === "saving" ? "保存中…" : "保存权限"}</button>
            </div>
          </div>}
        </article>
      </div>
    </section>
  );
}
