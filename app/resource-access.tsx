"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { CSSProperties } from "react";

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
  const [personQuery, setPersonQuery] = useState("");
  const deferredResourceQuery = useDeferredValue(resourceQuery);
  const deferredPersonQuery = useDeferredValue(personQuery);
  const [permissions, setPermissions] = useState(INITIAL_PERMISSIONS);
  const [savedPermissions, setSavedPermissions] = useState(INITIAL_PERMISSIONS);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "synced">("idle");

  const selectedMetric = useMemo(
    () => ALL_METRICS.find((metric) => metric.id === selectedMetricId) ?? ALL_METRICS[0],
    [selectedMetricId],
  );

  const filteredTasks = useMemo(() => {
    const query = deferredResourceQuery.trim().toLocaleLowerCase();
    if (!query) return RESOURCE_TASKS;
    return RESOURCE_TASKS.flatMap((task) => {
      const interfaces = task.interfaces.flatMap((resourceInterface) => {
        const metrics = resourceInterface.metrics.filter((metric) =>
          `${metric.name} ${metric.code}`.toLocaleLowerCase().includes(query),
        );
        if (resourceInterface.name.toLocaleLowerCase().includes(query)) return resourceInterface;
        return metrics.length ? [{ ...resourceInterface, metrics }] : [];
      });
      if (task.name.toLocaleLowerCase().includes(query)) return task;
      return interfaces.length ? [{ ...task, interfaces }] : [];
    });
  }, [deferredResourceQuery]);

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

  return (
    <section className="resource-access" aria-labelledby="resource-page-title">
      <header className="resource-command">
        <div className="resource-grid-pattern" aria-hidden="true" />
        <div className="resource-heading">
          <div className="resource-kicker"><span aria-hidden="true" />RESOURCE CONTROL · D1</div>
          <h2 id="resource-page-title">数据资源与人员权限</h2>
          <p>按任务、接口、指标逐级管理访问边界，所有修改均进入安全审计。</p>
        </div>
        <div className="resource-source-rail" aria-label="数据源与同步状态">
          <div><span>数据来源</span><strong>ServicePilot Production</strong></div>
          <div><span>最近同步</span><strong>{syncState === "synced" ? "刚刚" : "2026-07-27 09:42"}</strong></div>
          <div><span>同步状态</span><strong className={syncState === "syncing" ? "sync-status is-syncing" : "sync-status"}>{syncState === "syncing" ? "同步中…" : "运行正常"}</strong></div>
        </div>
        <button className="resource-primary-action" type="button" disabled={syncState === "syncing"} onClick={syncResources}>
          <span aria-hidden="true" />
          {syncState === "syncing" ? "正在同步…" : "同步资源"}
        </button>
        <div className="resource-metrics" aria-label="资源概览">
          <div><span>任务</span><strong>02</strong><small>全部在线</small></div>
          <div><span>接口</span><strong>03</strong><small>1 个校验中</small></div>
          <div><span>指标</span><strong>05</strong><small>5 个可授权</small></div>
          <div><span>已授权人员</span><strong>{String(permissions.length).padStart(2, "0")}</strong><small>{directCount} 个直接配置</small></div>
        </div>
      </header>

      <div className="resource-workbench">
        <aside className="resource-panel resource-tree-panel" aria-label="资源树">
          <div className="resource-panel-head">
            <div><span>资源目录</span><strong>任务 → 接口 → 指标</strong></div>
            <button type="button" title="折叠全部资源" aria-label="折叠全部资源" onClick={() => { setExpandedTasks(new Set()); setExpandedInterfaces(new Set()); }}>收起</button>
          </div>
          <label className="resource-search">
            <span aria-hidden="true" />
            <span className="sr-only">搜索任务、接口或指标</span>
            <input name="resource-search" autoComplete="off" value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} placeholder="搜索任务、接口或指标…" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="resource-tree" aria-live="polite">
            {filteredTasks.length ? filteredTasks.map((task) => {
              const taskExpanded = expandedTasks.has(task.id) || Boolean(resourceQuery);
              return (
                <div className="tree-task" key={task.id}>
                  <button className="tree-row tree-task-row" type="button" aria-expanded={taskExpanded} onClick={() => toggleTask(task.id)} title={task.name}>
                    <span className={taskExpanded ? "tree-caret is-open" : "tree-caret"} aria-hidden="true" />
                    <span className="tree-code">T</span>
                    <span className="tree-copy"><strong>{highlightText(task.name, resourceQuery)}</strong><small>{task.interfaces.length} 个接口</small></span>
                  </button>
                  {taskExpanded && <div className="tree-branch">{task.interfaces.map((resourceInterface) => {
                    const interfaceExpanded = expandedInterfaces.has(resourceInterface.id) || Boolean(resourceQuery);
                    return (
                      <div className="tree-interface" key={resourceInterface.id}>
                        <button className="tree-row tree-interface-row" type="button" aria-expanded={interfaceExpanded} onClick={() => toggleInterface(resourceInterface.id)} title={resourceInterface.name}>
                          <span className={interfaceExpanded ? "tree-caret is-open" : "tree-caret"} aria-hidden="true" />
                          <span className="tree-code api">API</span>
                          <span className="tree-copy"><strong>{highlightText(resourceInterface.name, resourceQuery)}</strong><small>{resourceInterface.method} · {resourceInterface.metrics.length} 个指标</small></span>
                        </button>
                        {interfaceExpanded && <div className="tree-metrics">{resourceInterface.metrics.map((metric) => (
                          <button
                            type="button"
                            key={metric.id}
                            className={metric.id === selectedMetric.id ? "tree-row tree-metric-row is-selected" : "tree-row tree-metric-row"}
                            aria-current={metric.id === selectedMetric.id ? "true" : undefined}
                            onClick={() => setSelectedMetricId(metric.id)}
                            title={`${metric.name} · ${metric.code}`}
                          >
                            <span className="tree-metric-dot" aria-hidden="true" />
                            <span className="tree-copy"><strong>{highlightText(metric.name, resourceQuery)}</strong><small>{metric.code}</small></span>
                            <span className={metric.status === "在线" ? "tree-health" : "tree-health is-checking"}>{metric.status}</span>
                          </button>
                        ))}</div>}
                      </div>
                    );
                  })}</div>}
                </div>
              );
            }) : (
              <div className="resource-empty">
                <span aria-hidden="true">0</span>
                <strong>未找到匹配资源</strong>
                <p>检查关键词，或清除搜索后查看全部层级。</p>
                <button type="button" onClick={() => setResourceQuery("")}>清除搜索</button>
              </div>
            )}
          </div>
          <div className="resource-panel-foot"><span className="health-pulse" aria-hidden="true" />资源树已通过完整性校验</div>
        </aside>

        <article className="resource-panel metric-detail-panel" key={selectedMetric.id}>
          <div className="metric-detail-head">
            <div>
              <span className="metric-code">{selectedMetric.code}</span>
              <h3>{selectedMetric.name}</h3>
              <p>{selectedMetric.definition}</p>
            </div>
            <span className={selectedMetric.status === "在线" ? "metric-state" : "metric-state is-checking"}><i aria-hidden="true" />{selectedMetric.status}</span>
          </div>
          <div className="metric-signal">
            <div className="metric-signal-copy"><span>当前观测值</span><strong>{selectedMetric.id === "metric-resolution" ? "68.42%" : selectedMetric.id === "metric-handoff" ? "22.61%" : selectedMetric.quality}</strong><small>相较 7 日基线 <b>+2.38%</b></small></div>
            <div className="signal-chart" role="img" aria-label={`${selectedMetric.name}最近七日趋势`}>
              {[34, 46, 42, 59, 54, 72, 81, 76, 88, 92].map((height, index) => <i key={index} style={{ "--signal-height": `${height}%` } as CSSProperties} />)}
            </div>
          </div>
          <section className="metric-section">
            <div className="metric-section-title"><h4>指标口径</h4><span>版本 v3.4</span></div>
            <dl className="metric-definition-list">
              <div><dt>计算公式</dt><dd><code>{selectedMetric.formula}</code></dd></div>
              <div><dt>数据来源</dt><dd>{selectedMetric.source}</dd></div>
              <div><dt>刷新频率</dt><dd>每 5 分钟增量同步</dd></div>
              <div><dt>统计粒度</dt><dd>会话 / 自然日 / UTC+8</dd></div>
            </dl>
          </section>
          <section className="metric-section">
            <div className="metric-section-title"><h4>治理信息</h4><button type="button">查看血缘</button></div>
            <div className="governance-grid">
              <div><span>责任人</span><strong>{selectedMetric.owner}</strong></div>
              <div><span>质量得分</span><strong>{selectedMetric.quality}</strong></div>
              <div><span>最近更新</span><strong>{selectedMetric.updatedAt}</strong></div>
              <div><span>敏感级别</span><strong>L2 · 内部</strong></div>
            </div>
          </section>
          <div className="metric-audit-note">
            <span aria-hidden="true">i</span>
            <p><strong>权限继承路径</strong>任务“商城客服数据资产” → 接口“订单售后 API” → 当前指标。直接配置优先于父级继承。</p>
          </div>
        </article>

        <aside className="resource-panel permission-panel" aria-label="人员权限配置">
          <div className="permission-head">
            <div><span>人员权限</span><strong>{permissions.length} 人已授权</strong></div>
            <span className={conflictCount ? "conflict-indicator" : "conflict-indicator is-clear"}>{conflictCount ? `${conflictCount} 个覆盖项` : "无冲突"}</span>
          </div>
          <label className="resource-search person-search">
            <span aria-hidden="true" />
            <span className="sr-only">搜索姓名或邮箱</span>
            <input name="person-search" autoComplete="off" spellCheck={false} value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="搜索姓名或邮箱…" />
          </label>
          {directoryMatches.length > 0 && (
            <div className="directory-results" aria-label="可添加人员">
              {directoryMatches.map((person) => <button type="button" key={person.id} onClick={() => addPerson(person)}><span>{person.initials}</span><p><strong>{person.name}</strong><small>{person.email}</small></p><b>添加</b></button>)}
            </div>
          )}
          <div className="permission-columns" aria-hidden="true"><span>人员与来源</span><span>查看</span><span>修改</span></div>
          <div className="permission-list">
            {visiblePermissions.length ? visiblePermissions.map((person) => (
              <article className={person.conflict ? "permission-row has-conflict" : "permission-row"} key={person.id}>
                <div className="permission-person">
                  <span className="permission-avatar">{person.initials}</span>
                  <p><strong>{person.name}</strong><small>{person.email}</small></p>
                </div>
                <div className="permission-controls">
                  <PermissionToggle checked={person.view} disabled={person.mode === "inherited" || saveState === "saving"} label={`${person.name}查看权限`} onChange={() => updatePermission(person.id, "view")} />
                  <PermissionToggle checked={person.edit} disabled={person.mode === "inherited" || saveState === "saving"} label={`${person.name}修改权限`} onChange={() => updatePermission(person.id, "edit")} />
                </div>
                <div className="permission-source">
                  <span className={person.mode === "direct" ? "source-label is-direct" : "source-label"}>{person.mode === "direct" ? "直接配置" : "父级继承"}</span>
                  <span title={person.source}>{person.source}</span>
                  {person.mode === "inherited" && <button type="button" onClick={() => convertToDirect(person.id)}>转为直接配置</button>}
                  {person.conflict && <p><b>覆盖提示</b>{person.conflict}</p>}
                </div>
              </article>
            )) : (
              <div className="permission-empty"><strong>没有匹配的已授权人员</strong><p>可从上方搜索结果添加人员，权限只面向具体个人。</p></div>
            )}
          </div>
          <div className="permission-legend"><span><i className="legend-direct" />直接配置</span><span><i className="legend-inherited" />父级继承</span><p>修改权限会自动包含查看权限。</p></div>
          <div className="permission-actions">
            <div aria-live="polite">{saveState === "saved" ? <span className="save-success">已保存并写入审计日志</span> : hasChanges ? <span>有未保存的修改</span> : <span>权限配置已是最新</span>}</div>
            <button type="button" className="permission-undo" disabled={!hasChanges || saveState === "saving"} onClick={() => { setPermissions(savedPermissions); setSaveState("idle"); }}>撤销</button>
            <button type="button" className="permission-save" disabled={!hasChanges || saveState === "saving"} onClick={savePermissions}>{saveState === "saving" ? "保存中…" : "保存权限"}</button>
          </div>
        </aside>
      </div>
    </section>
  );
}
