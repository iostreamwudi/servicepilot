# Phase 1.1 — Retrieval Regression Diagnosis & Real Hybrid Validation

日期：2026-08-25

本轮严格停留在 Phase 1.1，不做 Query Rewrite、Corrective Retrieval、Parent Expansion 或 Phase 2，不切换 V2 生产流量。

## 测试类别与数据边界

| 类别 | 本轮状态 | 可解释范围 |
|---|---|---|
| Mock Test | 通过 | `tests/phase1-retrieval.test.mjs` 等确定性单元测试；覆盖 Scope、BM25、RRF、Boost、Reranker fallback/异常，不代表效果提升 |
| Integration Test | 已完成本地诊断 | 同一 `data/knowledge-seed.json` 与同一冻结集 `holdout3`，调用真实 V1/V2 检索代码，但没有外部 Dense/Reranker；只能定位代码阶段差异 |
| Real-model Retrieval Eval | 已完成，未通过晋级门禁 | 从腾讯云 live D1 只读导出同一 active 知识与当前索引，真实调用 Embedding 与 `qwen3-rerank`；Hybrid-before有召回价值，但Reranker显著退化 |

逐条结构化明细见 [phase1.1-retrieval-diagnosis.json](./phase1.1-retrieval-diagnosis.json)。真实模型验证门禁结果见 [phase1.1-real-retrieval-eval.json](./phase1.1-real-retrieval-eval.json)。

## 1. V1-hit / V2-miss 根因

冻结集文件共100条，其中94条可由当前 Router 路由。按上一轮报告使用的 V1 口径（`retrieveBm25Candidates(category=intent, limit=5)`）对比 V2 BM25-only + RRF + Boost：

| 指标 | V1 | V2 BM25 raw | V2 BM25 + RRF | V2 BM25 + RRF + Boost |
|---|---:|---:|---:|---:|
| Recall@1 | 75.53% | 61.70% | 61.70% | 79.79% |
| Recall@3 | 93.62% | 78.72% | 78.72% | 81.91% |
| Recall@5 | 95.74% | 80.85% | 80.85% | 81.91% |
| Recall@10 | — | 81.91% | 81.91% | 81.91% |
| MRR | 0.8399 | 0.6980 | 0.6980 | 0.8050 |
| nDCG@5 | 0.8698 | 0.7248 | 0.7248 | 0.8085 |

窄修复前 V1-hit/V2-miss 共18条，占94条可路由样本的19.15%；修复后剩余14条，占14.89%。根因分布（修复后）：

| 类别 | 数量 | 占 V1-hit/V2-miss |
|---|---:|---:|
| A RetrievalScope 排除 | 0 | 0% |
| B BM25 未召回（存在正BM25但相关知识未进Top30） | 0 | 0% |
| C Fusion 排名下降 | 0 | 0% |
| D Business Boost 挤出 | 0 | 0% |
| E TopK 截断 | 0 | 0% |
| F Golden Set / 旧默认回退语义差异 | 14 | 100% |
| G 其他 | 0 | 0% |

B 类内部诊断（修复前）可拆成：14条没有任何正 BM25 分，V1 命中依赖旧逻辑的默认知识回退；4条有正 BM25 分，但泛化/通用词（如“快递”“显示”“收到”“产品/物流”）把相关父知识排除在 Top30。窄修复保留 Scope 首选父知识作为可审计 prior 后，这4条不再丢失；整路无正分时仍 Safe Fallback。RRF 只有 BM25 单路时不改变排序，说明真实候选回归发生在 BM25/prior 交界，不是 RRF 层。

完整逐条字段包括 query、intent、relevantKnowledgeIds、V1 Top5、V2 BM25 Top30、Fusion Top25、Boosted Top25、Final Top5 和阶段归因，见 JSON 报告。

## 2. RetrievalScope 核验

本地 seed 诊断中，94条 Query 的 expected knowledge 均位于 Scope；`scope_excluded_relevant_count = 0`。本地过滤检查覆盖 category、state、version；seed 没有 organizationId、validFrom、validUntil 列，因此脚本把本地文档映射为 `org-qingyu` 仅用于代码路径诊断。

该本地结论随后已由真实 D1 快照补验：当前索引指向 `org-qingyu`、`qwen3.7-text-embedding`、版本 `2026-08-20T09:23:19.197Z`，25条active知识与25条向量双向一致，文档版本无冲突。

## 3. V1 / V2 BM25 信号差异

- 生产 V1 关键词路径只查 `keywords`，不查 title/content；使用去空格、小写、关键词子串匹配；通用意图词权重1，其他关键词权重 `8 + min(length,4)`，默认知识额外+2。
- 上一轮 95.74% 的“V1”基线实际是旧 `retrieveBm25Candidates`，它查 title/content/keywords，使用中文二/三字 n-gram、Latin/digit token、NFKC、占位符删除和 BM25(`k1=1.2,b=0.75`)；本地生产关键词路径单独计算为 Recall@5 97.87%，说明两种 V1 口径本身不同。
- V2 BM25 保留 title/content/keywords、二/三字 n-gram、BM25 IDF/长度归一化，候选限制到 Scope；正BM25候选存在时允许首选父知识以`scope-preferred-prior-no-direct-bm25-match`原因保留，整路无正分仍返回空并Safe Fallback。它没有 stemming、stop words、phrase 或 fuzzy，也没有 generated questions/aliases 字段。
- 本轮未发现 Scope 错误过滤；已确认的差异是“V1 默认知识回退不等于 BM25 证据”以及 V2 对零分候选的明确剔除。

## 4. Business Boost 数量级与 sweep

冻结集本地单路 RRF 候选共266条：

- RRF：min 0.014925，P10 0.015385，P50 0.016129，P90 0.016393，max 0.016393。
- 默认 `maxBusinessBoost=0.0005` 后，Boost：min -0.000500，P10 -0.000500，P50 -0.000500，P90 0.000333，max 0.000500；报告保留20个真实名次变化案例。
- 原 `0.01` 明显高于当前单路 RRF 相邻名次差距；它不是首次回归原因，但会造成更强局部扰动。V2实验默认已收敛到0.0005，真实双路 RRF 仍需重新 sweep。

Sweep 结果：

| maxBoost | Recall@5 | MRR | nDCG@5 | Top5发生变化的Query数 |
|---:|---:|---:|---:|---:|
| 0 | 80.85% | 0.6980 | 0.7248 | 0 |
| 0.0001 | 80.85% | 0.6980 | 0.7248 | 0 |
| 0.0005 | 81.91% | 0.8050 | 0.8085 | 23 |
| 0.001 | 81.91% | 0.8191 | 0.8191 | 25 |
| 0.002 | 81.91% | 0.8191 | 0.8191 | 25 |
| 0.005 | 81.91% | 0.8191 | 0.8191 | 25 |
| 0.01 | 81.91% | 0.8191 | 0.8191 | 25 |

暂不依据本地无 Dense 结果直接改默认 Boost；真实双路 RRF 需要重新 sweep。

## 5. Golden Set 检查

当前标签是 single `expectedSource/expectedKnowledgeId`，不是 multiple relevantKnowledgeIds，也不是 chunk-level relevance。评分器虽有父子层级接受规则，但冻结 JSON 没有显式多相关性字段。

已按四类各取最多8条，共32条进行人工式初筛。窄修复前发现1条潜在 `label_false_negative`：`csds-train-damage-10300-0` 的问题包含“快递不会压烂”，V2 返回同一 damage 知识族的快件/验货候选，业务上可能足以回答，但单一父知识标签会判 miss；窄修复后该父知识已作为可审计 prior 保留，当前报告不再把它列为未解决 false negative。另有14条 V1 依赖默认知识但 Query 本身没有正 BM25 证据，属于“旧默认回退/上下文不足”问题，不应伪装成检索命中。

建议新增集使用：

```json
{
  "relevantKnowledgeIds": ["KB-208", "KB-210"],
  "primaryKnowledgeId": "KB-208",
  "acceptableRelations": [{"id": "KB-210", "relation": "same-family-child", "condition": "explicit courier-damage evidence"}],
  "relevantChunkIds": []
}
```

## 6. 修复判定

本轮没有用增加 Query Rewrite、Corrective Retrieval 或 Parent Expansion 来掩盖问题。窄修复仅保留“存在其他正BM25证据时的Scope首选父知识 prior”；整路无正分仍Safe Fallback。现有证据显示剩余14条主要来自评测口径差异：旧 V1 在无文本证据时用默认知识回退，而 V2 将其视为不可信并拒绝强答；不是 Scope、RRF 或 Boost 首先造成的回归。V2当前Safe Fallback行为保持可审计，不能为追求Recall强行复用默认知识。

因此本轮暂不提交生产检索逻辑修复；先完成真实 D1/Embedding/Reranker Eval，再决定是否需要增加“可解释的 prior-only / no-evidence”评测分层或修订 BM25 信号。任何冻结集标签修订必须由业务复核后另建版本，不能改动当前集。

## 7. Real-model Retrieval Eval 门禁

脚本 [evaluate-phase1-real-retrieval.mjs](../scripts/evaluate-phase1-real-retrieval.mjs) 已实现强制门禁，要求：同一知识库快照、同一 indexVersion、同一 `qwen3.7-text-embedding`、同一 Golden Set、真实 `qwen3-rerank` API；不调用 GLM-5.2。

当前运行结果：`status=completed`。真实回归集94条可路由请求和新增集85条可路由请求均完成真实 Embedding 与真实 `qwen3-rerank`，Reranker fallback均为0；详细结果见下一节与JSON报告。

## 7.1 Real-model Retrieval Eval 结果（2026-08-25）

- 环境一致性：腾讯云live D1只读导出25条active知识、当前版本25条1024维向量；组织、Embedding模型、indexVersion、文档ID与文档版本双向一致。评测没有调用GLM-5.2，也没有切换生产流量。
- 冻结回归集：100条中94条进入检索。V1 Recall@5=97.87%、MRR=0.9734；BM25-only Recall@5=80.85%；Dense-only Recall@5=95.74%；Hybrid-before-rerank Recall@5=96.81%、MRR=0.9176；Hybrid-after-rerank Recall@5=84.04%、MRR=0.6460。
- 独立新增集：110条中100条可回答、10条no-answer；Router正确拦截10/10 no-answer，但另有15条可回答样本未进入检索，实际检索85条。V1与Hybrid-before Recall@5均为96.47%，MRR分别0.9647/0.9373；Reranker后Recall@5=88.24%、MRR=0.6801。
- Reranker真实性：两套运行均为`provider=qwen3-rerank`、fallback=0；回归集P50/P95约173/221ms，新增集约173/240ms。按Top1命中比较，回归集改善0、退化33；新增集改善1、退化34。
- 判定：Dense证明可补足BM25，但当前RRF+Boost没有在两套数据上超过V1；纯Reranker排序在两套数据上均显著退化。Phase 1.1真实验证已完成但不通过晋级门禁，V2继续隔离，Phase 2不开始。后续若继续优化，应先冻结新的Reranker任务说明/融合方式与多相关性Golden Set，再用独立数据验证，禁止按当前单题调参。

## 8. 新增泛化集

已生成 [eval-phase1-v2-additional.json](../data/eval-phase1-v2-additional.json)：110条，包含100条从 CSDS test/val 中按四类各25条抽取的独立 DialogueID Query，以及10条新的 no-answer 补充样本；排除了 holdout2、generalization-100、holdout3 的 DialogueID。冻结指纹：`f189c1212b20a3aa5cbe98f5a0145135f2b5aaf15524ab96db374701be1f7260`。

该数据集只作为后续 generalization set；当前 holdout3 仍是 regression set。由于真实模型验证尚未完成，本轮不报告两套数据集的真实效果指标。

## 当前结论

- BM25-only 本地诊断的窄修复前首次回归层：BM25 candidate/prior 交界；修复后剩余差异属于旧默认回退与Golden Set语义差异。
- Scope 本地排除相关知识：0；真实 D1 尚未核验。
- Boost 不是首次回归原因，但0.01确实会造成局部排名变化。
- Mock/本地 Integration 通过，不代表 Real-model Retrieval Eval 通过。
- Dense、Hybrid、Reranker 已完成真实验证：Hybrid-before接近但未超过V1，Reranker在两套数据上显著退化。
- V2 不切生产。
- Phase 2 不开始。
