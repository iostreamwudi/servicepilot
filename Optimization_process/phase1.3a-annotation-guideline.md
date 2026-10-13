# Phase 1.3A — Graded Golden Set V2 标注指南

日期：2026-08-25

状态：`draft-pending-human-review`（冻结产物已另存为`data/graded-golden-set-v2-frozen.json`）

本阶段只构建评测资产，不修改 Router、Retrieval、RRF、Reranker、阈值、Agent、生产代码、真实知识数据或原 Golden Set。当前文件与 `data/graded-golden-set-v2.json` 都不是 frozen Golden Set；只有完成业务人工复核、填写 reviewer/reviewedAt/reviewNotes 后，样本才可以进入 frozen 版本。

## 1. 标注对象与字段

每个 query 保留原始 `expectedSource`，并默认设置：

- `primaryKnowledgeId = expectedSource`；
- `relevanceGrades[primaryKnowledgeId] = 3`（初始默认）；
- `relevantKnowledgeIds` 初始只包含 primary；
- 其他 knowledgeId 不自动赋予任何 grade；
- `labelRationale` 必须说明 primary 的继承来源和人工审核状态。

初始默认不等于最终业务结论：人工复核后，如正文、适用条件或动作证据表明原`expectedSource`并非最高相关，可在独立 frozen V2 中将其降为2/1/0；必须保留完整复核元数据，且`primaryKnowledgeId`仍保留原`expectedSource`以兼容旧单标签评测。

待审核候选使用 `proposedGrade: null`。程序只负责把阶段候选、父子关系、title、各阶段 rank 和失败覆盖标签放入队列，不根据 Reranker 排名、embedding similarity 或词面相似度产生 grade。

## 2. Grade 定义

| grade | 名称 | 判定标准 |
|---:|---|---|
| 3 | Highly Relevant | 该知识直接回答 query 的主问题，且适用条件、业务动作、时效或风险边界与 query 一致；应作为 primary evidence。 |
| 2 | Relevant | 能回答 query 的明确子问题，或是同一业务问题下业务上可接受的补充/替代知识；即使不是首选主证据，也足以支持正确回答的一部分。 |
| 1 | Partially Relevant | 只提供背景、前置条件、部分事实或相邻流程；单独使用不能完整回答 query，或需要另一个知识补足。 |
| 0 | Irrelevant | 只有主题/关键词相似，不能支持当前结论；或其适用条件、业务状态、时间、对象与 query 冲突。 |

Recall、MRR 和 nDCG 的“相关”门槛统一为 `grade >= 2`；grade 1 只进入 DCG/nDCG 的分级收益，不计为主 Recall 命中。

## 3. 知识关系标注规则

### 3.1 父知识

父知识不是因为层级更高就自动 grade=2。只有在父知识直接覆盖 query 的通用规则、主动作或安全边界时才标为 2 或 3。若父知识只提供背景而子知识才包含执行条件，则父知识通常为 1。

### 3.2 子知识

子知识只有在 query 明确提出该子场景，且正文能直接回答时才可为 2 或 3。例如：明确问“维修/寄修”可使维修子知识成为 2；只说“商品坏了怎么办”时，维修子知识不能仅凭语义相似自动成为 2。

### 3.3 兄弟知识

同一父知识下的兄弟知识必须按 query 的对象、动作、条件和时效逐条判断。仅属于同一业务类目或共享“退款/破损/发票”等词，不足以给 2。未覆盖主问题但能提供少量背景时给 1；条件不匹配时给 0。

### 3.4 互补知识

一个 query 可以有多个 `grade >= 2`。当两个知识分别覆盖 query 中独立且同时需要的证据槽位，例如“破损后如何处理 + 是否需要拍照留证”，两者可分别标 3/2。互补关系必须在 `acceptableRelations` 中写明证据槽位，不得因为候选同时出现就自动标注。

### 3.5 条件冲突知识

如果知识的商品类型、订单状态、时间窗口、责任主体、售后动作或政策条件与 query 冲突，标 0，即使标题和关键词高度相似也不能标 1/2。无法确定是否冲突时先保持待审核，不使用相似度猜测。

## 4. 人工复核流程

1. 先确认 query 的主意图、对象、业务动作、状态、条件和需要的证据槽位。
2. 确认原 `expectedSource` 是否仍然应为 primary；如果不应保持，不能直接覆盖原 Golden Set，应在新集记录迁移意见并由业务负责人确认。
3. 对候选逐个判断关系：exact、parent、child、sibling、complementary 或 conflict。
4. 为每个 grade>=2 的 knowledgeId 补入 `relevantKnowledgeIds`，并在 `relevanceGrades` 填写 2/3；grade 1/0 也要在 `labelRationale` 或审核记录中说明原因。
5. 写明 `labelRationale`，至少包含“为什么相关/不相关”和适用条件。
6. 填写 `reviewer`、`reviewedAt`、`reviewNotes`，将 `humanReviewed` 设为 true。
7. 只有该记录完成复核后，才允许复制到 frozen Golden Set；draft 文件本身不作为最终基线。

禁止事项：

- 不使用当前 Reranker 的排序结果反向定义相关性；
- 不用 embedding similarity 自动产生 grade；
- 不把 Reranker top1 直接视为 0，也不把 Hybrid top1 直接视为 3；
- 不按失败 query 添加 Router/Retrieval 特例；
- 不修改原 single-label Golden Set；
- 不启动 Phase 1.3B 或新的 Reranker 实验。

## 5. 覆盖范围

`data/graded-golden-set-v2.json` 当前覆盖：

- Phase 1.2 报告中的 67 条 Top1 退化样本；
- Phase 1.2 报告中的 20 条 Recall@5 hit→miss 样本；
- 174 条出现父子/兄弟知识竞争的样本；
- 15 条 answerable 但 Router 未送入 Retrieval 的样本；
- 5 条确定性随机正常 control 样本。

这些覆盖标签只是审核优先级，不是 relevance label。当前 194 条记录、1,090 个候选均为待人工复核；人工确认数为 0。
