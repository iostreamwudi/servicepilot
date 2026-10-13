# Phase 1.2 — Ranking & Router Diagnosis

日期：2026-08-25

本阶段只做 Failure Analysis 与 Golden Set 设计，不修改 V1/V2、生产、知识数据、阈值或 Reranker；不启动 Query Rewrite、Corrective Retrieval、Parent Expansion 或其他 Agentic RAG 能力。

## 结论摘要

- Phase 1.1 已完成；本阶段不启动 Phase 2。
- 新增集 100 条 answerable query 中 15 条未进入 Retrieval。15 条的 expected 知识 `KB-114/KB-301/KB-401/KB-208` 均存在于当前知识快照；失败发生在 Router 返回 `null`，不是知识库为空。
- 12 条没有形成可接受的规则候选，主要是口语化、指代、省略、业务词形未覆盖或上下文不足；3 条形成显式候选但出现意图竞争，因 margin 门禁拒绝。
- 两套真实 Reranker 评测均为 `provider=qwen3-rerank`、fallback=0；holdout3 Top1 退化 33 条、新增集退化 34 条。退化不是接口失败，而是排序目标与当前业务相关性目标不一致的强信号。
- 真实评测 JSON 没有落盘逐候选 BM25/dense/RRF/Business Boost/relevance score。以下结论只使用已持久化的 query、expected、候选 ID、排名和评测结果，不反推或伪造分数。

## 一、Router Failure Analysis

以下 15 条的 `actual router` 均为 `null`。`confidence` 在源码中只有通过 margin 门禁后才会返回，因此被拒绝样本没有生产级 confidence；表中补充向量 Top1/Top2 概率和可重建的业务候选 margin。

| case | query | expected | top1 / top2 | vector top1 / top2 | margin | matched signals | rejection reason |
|---|---|---|---|---|---:|---|---|
| refund-7425 | 我这个订单到哪了 | refund | 无规则候选 | unsupported / refund | N/A | 无 | 订单到哪更像物流跟踪，未命中退款模式；历史仅assistant话术 |
| refund-4514 | 钱返回到哪去了?；我没有看到呢 | refund | 无规则候选 | unsupported / refund | N/A | 无 | 返回到哪未覆盖退款表达式 |
| refund-734 | 退款金额少了 | refund | refund / damage | refund / damage | 0 | 退款；少了 | 两个业务类目显式竞争，margin门禁拒绝 |
| invoice-7175 | 车管所说加盖财务专用章，是吗 | invoice | 无规则候选 | unsupported / refund | N/A | 无 | 财务专用章未覆盖发票模式；历史无用户发票事实 |
| address-5077 | 我申请维修的电脑，上面显示取件的地址错了 | address | address / damage | address / unsupported | -1 | 地址错；维修/售后 | address与damage竞争，margin门禁拒绝 |
| address-4903 | 我给我爸寄东西，要提货码，提货码是什么；我留的那个手机号出了点问题，没收到；现在快递员要提货码，但是我这联通突然没信号了，在app上也找不到提货码；能不能重设手机号；或者直接从平台上确认收货 | address | 无规则候选 | unsupported / address | N/A | 无 | 提货码、号码异常、确认收货复合表达未映射到地址模式 |
| address-2001 | 可以改过来吗? | address | 无规则候选 | unsupported / invoice | N/A | 无 | 孤立省略问句缺少地址主题 |
| damage-6176 | 上门师傅会核对吧?我怕漏了 | damage | 无规则候选 | unsupported / address | N/A | 无 | 核对/漏了未命中缺件或验货模式；历史不能形成稳定damage事实 |
| damage-2353 | 你能帮我处理好吗；我申请售后申请不了；之前取消售后的订单，你们没有处理好，导致我现在无法在线申请售后 | damage | 无规则候选 | unsupported / refund | N/A | 无 | 售后申请失败未命中damage强模式 |
| damage-3634 | 我的手表到了；但是表带出现了点问题；表带上的线掉了 | damage | 无规则候选 | unsupported / damage | N/A | 无 | 线掉了/脱落未覆盖质量问题表达式 |
| damage-7080 | 不是即可赔款的嘛；昨天收到冷饮全化了；以拒收，但问为什么售后还在申请中 | damage | 无规则候选 | unsupported / refund | N/A | 无 | 冷饮融化、拒收、售后状态复合口语未命中当前词形 |
| damage-5085 | 说这是泉州站点那边传输带出了问题导致衣服破损；我现在问题是这样问题件，是你们那边会自动给客户退款还是我们这边联系客户申请退款 | damage | refund / damage | refund / unsupported | -2 | 退款；破损+复合意图 | 退款信号压过破损，margin为负，路由拒绝 |
| damage-2077 | EPL[数字]这个采购单，昨天入仓少入了[数字]个商品，麻烦问下仓库是什么情况，是拒收了吗，还是没有发? | damage | 无规则候选 | unsupported / damage | N/A | 无 | 采购单/入仓少入/拒收未映射到缺件或物流损坏模式 |
| damage-5720 | 我买的这个，昨晚收到货，发现[数字]L没有底板；[数字]升的两个有，[数字]升的没有 | damage | 无规则候选 | unsupported / damage | N/A | 无 | 底板缺失属于缺件，但未命中当前词形 |
| damage-7004 | 退货；显示效果不好，屏幕松动 | damage | 无规则候选 | unsupported / refund | N/A | 无 | 屏幕松动未命中质量/故障模式；退货也未形成有效退款候选 |

### Router failure taxonomy

| 类别 | 数量 | 说明 |
|---|---:|---|
| 关键词/表达式覆盖不足 | 8 | 财务专用章、提货码、核对漏件、售后申请失败、线掉了、冷饮融化、采购入仓少入、底板缺失、屏幕松动 |
| 口语化、语义改写或省略 | 4 | 钱返回到哪、可以改过来吗、我这个订单到哪了等 |
| 上下文不足或上下文没有用户事实 | 3 | 历史只有助手话术、泛问、商品链接或订单咨询 |
| 多意图/跨类目竞争与 margin 拒绝 | 3 | 退款金额少了、维修电脑且地址错、破损问题同时问退款 |

类别允许交叉；这里不针对任何单条 query 添加特例。

补充字段：15 条的 `actual router` 均为 `null`；由于 Router 在 margin 门禁前不会返回生产级 `confidence`，表中的 `vector top1/top2` 只作诊断信号，`confidence` 统一记为“未返回（被拒绝）”。15 条的 expected knowledge 均存在于当前知识快照；会话上下文与知识存在性逐条如下：

| case | conversation context | 是否存在有效知识 | 未进入 Retrieval 的直接原因 |
|---|---|---|---|
| refund-7425 | 仅 assistant 话术，无用户事实 | 是，KB-114 | “订单到哪”更像物流跟踪，未命中退款模式 |
| refund-4514 | 无有效上下文 | 是，KB-114 | “返回到哪”未覆盖退款到账表达式 |
| refund-734 | 无有效上下文 | 是，KB-114 | refund 与 damage 候选同分，margin=0 |
| invoice-7175 | 仅 assistant 话术，无用户发票事实 | 是，KB-401 | “财务专用章”未覆盖发票模式 |
| address-5077 | 无有效上下文 | 是，KB-301 | address 与 damage 竞争，margin=-1 |
| address-4903 | 仅用户提到“提货码”，无可继承地址事实 | 是，KB-301 | 提货码、号码异常、确认收货复合表达未映射到 address |
| address-2001 | 无有效上下文 | 是，KB-301 | 孤立省略问句缺少地址主题 |
| damage-6176 | 有待处理语气，但无稳定商品/缺件事实 | 是，KB-208 | “核对/漏了”未命中缺件或验货模式 |
| damage-2353 | 无可继承的明确损坏事实 | 是，KB-208 | 售后申请失败未命中 damage 强模式 |
| damage-3634 | 无有效上下文 | 是，KB-208 | “线掉了/脱落”未覆盖质量问题表达式 |
| damage-7080 | 无有效上下文 | 是，KB-208 | 冷饮融化、拒收、售后状态是复合口语 |
| damage-5085 | 无有效上下文 | 是，KB-208 | 退款信号压过破损，margin=-2 |
| damage-2077 | 无有效上下文 | 是，KB-208 | 采购单/入仓少入/拒收未映射到缺件模式 |
| damage-5720 | 无有效上下文 | 是，KB-208 | 底板缺失属于缺件，但词形未覆盖 |
| damage-7004 | 无有效上下文 | 是，KB-208 | 屏幕松动未命中质量/故障模式 |

## 二、Reranker Failure Analysis

### 2.1 真实调用协议

- provider/model：`qwen3-rerank`。
- API：由 `RERANK_BASE_URL` 派生 `/reranks`；百炼兼容模式对应 `.../compatible-api/v1/reranks`。
- `top_n=8`，`return_documents=false`。
- `instruct` 未传，`mode` 未传。
- candidate 文本是 `title + sectionTitle + content` 换行拼接；title包含，当前 document-level 评测 section 为 null。
- metadata、parentId、BM25/Dense/RRF/BusinessBoost 没有进入发送文本。
- ServicePilot 没有显式文本截断；模型端是否内部截断未被 trace 记录。
- 两套真实评测 fallback 均为0。

### 2.2 结果

| dataset | routed | Hybrid-before Recall@5 | Reranker-after Recall@5 | Top1改善 | Top1退化 | Recall@5命中→未命中 | P95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| holdout3 regression | 94 | 96.81% | 84.04% | 0 | 33 | 12 | 约221ms |
| phase1-v2 additional | 85 | 96.47% | 88.24% | 1 | 34 | 8 | 约240ms |

### 2.3 全部退化样本的可复核范围

两份真实 JSON 的每条 `records` 已保存完整 `query`、`expected`、`bm25`、`dense`、`hybrid`、`reranked` 候选 ID 顺序，以及 `rerankProvider`/`rerankFallback`。Top1 退化集合完整保存在：

- [holdout3 真实评测](./phase1.1-real-retrieval-eval.json) 的 `reranker.top1DegradedCases`：33条。
- [additional 真实评测](./phase1.1-real-retrieval-eval-additional.json) 的 `reranker.top1DegradedCases`：34条。

Recall@5 从命中变为未命中的完整 ID：

- holdout3：`csds-train-refund-2898-0`, `csds-train-refund-10471-0`, `csds-train-refund-6188-0`, `csds-train-refund-2268-0`, `csds-train-damage-2866-0`, `csds-train-damage-10646-0`, `csds-train-damage-8418-2`, `csds-train-damage-4371-1`, `csds-train-damage-2421-1`, `csds-train-damage-1661-0`, `csds-train-damage-4404-0`, `csds-train-damage-858-0`。
- additional：`csds-test-refund-4017-0`, `csds-val-refund-3672-1`, `csds-test-refund-2346-0`, `csds-val-damage-4504-2`, `csds-val-damage-4510-0`, `csds-test-damage-318-0`, `csds-test-damage-6895-0`, `csds-val-damage-2106-0`。

当前产物没有逐候选原始 BM25 分、Dense 分、RRF 分、Business Boost 或 qwen3-rerank relevance score，因此这些字段不能被可靠输出；报告明确保留为“未记录”，不反推数值。

### 2.4 失败原因聚类

1. **业务相关性与一般语义相关性不一致**：Reranker 常把退款父知识 `KB-114` 换成 `KB-120/KB-119`，把发票父知识 `KB-401` 换成 `KB-402/KB-405`，把破损父知识 `KB-208` 换成 `KB-209/KB-210/KB-211/KB-216`。候选语义相关，但不一定是当前问题的 primary evidence。
2. **Single expectedSource 可能放大误判**：同一业务族父子/兄弟知识可能都能回答部分问题；当前单标签会把同族相关候选全部算错。没有 graded labels 前，不能把所有退化归因于模型。
3. **Exact keyword / stable prior 在 Rerank 阶段不可见**：lexical rank、RRF rank、route preference 和 action boost 没有发送给远程 Reranker，精确词命中的保守父知识可能被通用语义候选压低。
4. **Business action 丢失**：`businessBoost`、`businessBoostReason`、`parentId`、BM25/Dense排名和 metadata 没有进入 Reranker 文本；它看不到“用户明确说寄修”等治理信号。
5. **Parent/child 关系丢失**：内部有 parentId，但远程输入没有结构化父子关系，子知识可能因语义更具体而压过父知识。
6. **Candidate 结构偏文档级**：没有 section、chunk、condition、timing 或 evidence slot；每条候选只是 title+正文。代码没有显式截断，但未记录模型端截断。
7. **Instruct/mode 缺失**：请求没有 `instruct` 或 `mode`，当前更接近通用语义相关性排序，而不是“能否回答当前客服问题”的业务排序。

## 三、Golden Set graded multi-relevance 设计

原始 Golden Set 继续冻结，不修改。后续版本建议：

```json
{
  "id": "...",
  "query": "...",
  "expectedSource": "KB-208",
  "primaryKnowledgeId": "KB-208",
  "relevantKnowledgeIds": ["KB-208", "KB-211"],
  "relevanceGrades": {"KB-208": 3, "KB-211": 2, "KB-210": 1, "KB-214": 0},
  "acceptableRelations": [
    {"id": "KB-211", "relation": "same-family-child", "condition": "explicit inspection/evidence query"}
  ],
  "relevantChunkIds": [],
  "labelRationale": "...",
  "labelVersion": "phase1.2-graded-v1"
}
```

等级定义：

| grade | 含义 | 评测用途 |
|---:|---|---|
| 3 | Highly Relevant：直接回答主问题，条件/动作/时效匹配 | Recall命中；DCG权重3 |
| 2 | Relevant：同族或互补知识，能回答明确子问题，但不是首选主证据 | Recall命中；DCG权重2 |
| 1 | Partially Relevant：只有部分事实、背景或前置条件 | 不作为主Recall命中；DCG权重1 |
| 0 | Irrelevant：主题相似但不能支持当前结论，或条件冲突 | 不计入命中 |

兼容规则：

- 原 `expectedSource` 保留，作为 `primaryKnowledgeId` 的兼容别名。
- 旧样本迁移为 `primaryKnowledgeId=expectedSource`、`relevanceGrades[expectedSource]=3`；其他知识不自动推断。
- 新的 2/1/0 关系必须业务复核，不能由模型相似度自动生成。
- 旧评测继续使用单标签口径，新评测使用 graded 口径；两者分开报告，不覆盖旧基线。

建议指标：

```text
Recall@5  = Top5中是否命中任一 grade >= 2
Recall@10 = Top10中是否命中任一 grade >= 2
MRR       = 第一个 grade >= 2 的相关知识倒数排名
DCG@10    = Σ (2^grade - 1) / log2(rank + 1)
nDCG@5    = DCG@5 / ideal_DCG@5
```

## 四、停止点

- Router 15 条已逐条完成归因，没有添加关键词特例。
- Reranker 调用协议、Top1 退化集合和 Recall@5 损失集合已完成分析。
- Single expectedSource 标签风险已确认，graded multi-relevance 方案已设计但未修改原 Golden Set。
- 本阶段到此停止：不实施修复、不调阈值、不重跑候选、不部署、不切生产、不启动 Phase 2。
