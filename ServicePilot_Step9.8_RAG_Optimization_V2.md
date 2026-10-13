# ServicePilot Step 9.8 RAG 优化实施方案
## —— 面向企业级智能客服的 Bounded Agentic RAG V2 改造指南

> 文档目标：在**不推翻现有 Step 9.8 有界 Agentic RAG** 的前提下，对检索、路由、Rerank、纠正检索、工具分流、证据治理与可观测性进行工程化升级，使其更接近 2026 年微软 Azure AI Search、AWS Bedrock、Google Agent Search、阿里云百炼等公开的企业级 RAG 实践。
>
> 本文档可直接交给 Codex，作为后续代码改造、测试与验收的实施基线。

---

# 0. 最终结论

当前 Step 9.8 的问题**不在 Agent 治理层**，而主要在 Retrieval 层。

当前系统值得保留的核心能力：

- 多租户隔离；
- 会话结构化记忆；
- 确定性工具决策；
- 只读工具；
- 知识证据 / 工具证据分层；
- GLM-5.2 仅负责自然语言生成；
- 声明级回答审查；
- 全链路 trace / audit；
- 工具调用次数限制；
- 模型调用次数限制；
- 超时与安全降级；
- 禁止无限 Agent Loop。

当前最需要升级的能力：

1. **单知识硬路由 → Retrieval Scope + Boost**
2. **Hybrid Top5 直接截断 → Wider Recall + RRF/Fusion + Rerank**
3. **增加真正的 Semantic Reranker**
4. **增加 Contextual Query Rewrite**
5. **增加最多一次 Corrective Retrieval**
6. **支持最多 2~3 个知识来源共同形成证据**
7. **增加 Parent Context Expansion**
8. **工具路由前移，避免所有请求都先跑 RAG**
9. **Hybrid 失败改为 BM25-only / Exact-match fallback**
10. **状态数预算改为 Operation Budget**
11. **完善 Retrieval / Rerank / Tool / LLM 的分阶段性能指标**

最终目标架构：

```text
Request Validation
        ↓
Auth / Tenant / Permission
        ↓
Conversation State Resolution
        ↓
Chitchat / Business Router
        ↓
Query Understanding
        ↓
Rule / Live Fact / Mixed / Risk Router
        ↓
Contextual Query Rewrite
        ↓
┌──────────────────── Knowledge Branch ────────────────────┐
│                                                         │
│ Metadata / Tenant / Version Filter                      │
│             ↓                                           │
│     BM25 TopN        Dense TopN                          │
│          \              /                               │
│            RRF / Fusion                                 │
│                 ↓                                       │
│         Business Rule Boost                             │
│                 ↓                                       │
│          Semantic Reranker                              │
│                 ↓                                       │
│       Deduplicate / Parent Expand                       │
│                 ↓                                       │
│        Evidence Sufficiency Check                       │
│                 ↓                                       │
│        不足且 retry = 0                                  │
│                 ↓                                       │
│       Corrective Query Rewrite                          │
│                 ↓                                       │
│        最多再 Retrieval 一次                             │
└─────────────────────┬───────────────────────────────────┘
                      │
┌──────────────────── Tool Branch ────────────────────────┐
│ Need realtime fact?                                    │
│        ↓                                                │
│ Parameter Validation                                   │
│        ↓                                                │
│ Read-only Tool                                         │
│        ↓                                                │
│ Tool Evidence                                          │
└─────────────────────┬───────────────────────────────────┘
                      ↓
           Unified Evidence Package
                      ↓
              Evidence Provenance
                      ↓
                  GLM-5.2
                      ↓
             Claim-level Review
                      ↓
              Citation Mapping
                      ↓
          Complete / Safe Fallback
                      ↓
                    Audit
```

---

# 1. 当前 Step 9.8 的总体评价

## 1.1 当前设计已经做对的部分

### A. 有界状态治理

当前配置：

```json
{
  "maxSteps": 7,
  "maxToolCalls": 1,
  "maxModelCalls": 1,
  "timeoutMs": 25000
}
```

核心思想是正确的：

- 不允许无限循环；
- 不允许模型反复自我思考；
- 不允许第二次任意工具调用；
- 不允许第二次生成模型调用；
- 超时后立即进入 fallback；
- 模型迟到结果不得重新进入链路。

这部分不要删除。

### B. 工具与模型权限严格分离

当前：

```text
工具决策 = 确定性代码
模型 = 只负责语言生成
```

这个设计应继续保留。

不要改成：

```text
LLM 自己决定任意工具
→ 自己调用
→ 自己判断是否继续
→ 自己再次调用
```

对客服系统而言，可控性、审计性、误操作风险远比“Agent 自由度”重要。

### C. Knowledge Evidence 与 Tool Evidence 分层

继续保留：

```text
知识证据
→ 规则 / 流程 / 条件 / 时效 / 材料

工具证据
→ 实时状态 / 当前阶段 / 当前订单信息
```

建议进一步给每条证据增加结构化 provenance：

```ts
type EvidenceItem = {
  evidenceId: string;
  sourceType: "knowledge" | "tool";
  sourceId: string;
  sourceVersion?: string;
  title?: string;

  content: string;

  tenantId: string;
  retrievedAt: string;

  retrievalScore?: number;
  rerankScore?: number;

  parentId?: string;
  metadata?: Record<string, unknown>;
};
```

### D. 声明级审查

这部分非常有价值。

继续检查：

- 未授权操作声明；
- 实时状态无工具证据；
- 工具状态冲突；
- 无知识来源的数字 / 时效；
- 无来源的绝对承诺；
- 无来源的赔偿、退款、政策结论。

建议后续升级为：

```text
Claim
→ Evidence Mapping
→ Supported / Unsupported / Contradicted
```

而不仅是正则匹配。

---

# 2. P0 改造：删除“唯一稳定知识硬路由”

## 2.1 当前问题

当前大致逻辑：

```text
用户问题
↓
intent router
↓
选择一个稳定知识
↓
retrievalKnowledgeId = KB-208
↓
在该范围继续 Hybrid
```

示例：

```json
{
  "intent": "damage",
  "retrievalKnowledgeId": "KB-208"
}
```

问题是：

> Router 在 Retrieval 之前就把候选空间锁死。

这会产生 Route Lock-in。

例如：

```text
用户：
商品坏了，买了8个月，现在开不了机怎么办？
```

如果 Router 首先选择：

```text
KB-208 通用破损售后
```

但真实答案还依赖：

```text
KB-215 保修政策
KB-221 电子产品故障
KB-228 售后时效
```

那么后续向量检索再强，也无法从被排除的知识中恢复。

---

## 2.2 修改原则

从：

```ts
retrievalKnowledgeId: string
```

改为：

```ts
retrievalScope: RetrievalScope
```

推荐：

```ts
interface RetrievalScope {
  primaryCategory: string;

  allowedCategories: string[];

  preferredKnowledgeIds?: string[];

  excludedKnowledgeIds?: string[];

  businessActions?: string[];

  metadataFilters: Record<string, unknown>;
}
```

示例：

```json
{
  "primaryCategory": "damage",
  "allowedCategories": [
    "damage",
    "warranty",
    "repair",
    "after_sales"
  ],
  "preferredKnowledgeIds": [
    "KB-208"
  ],
  "businessActions": [],
  "metadataFilters": {
    "organizationId": "ORG-001",
    "state": "active"
  }
}
```

---

## 2.3 Router 的角色重新定义

Router 不再负责：

```text
决定唯一答案知识
```

而负责：

```text
1. 缩小搜索空间
2. 设置 metadata filter
3. 给部分知识加 boost
4. 排除明显无关类目
5. 判断是否需要 Tool
```

即：

```text
Router = Retrieval Prior
而不是
Router = Retrieval Final Decision
```

---

## 2.4 推荐实现

原逻辑：

```ts
const kb = selectStableKnowledge(intent);
const candidates = retrieveFromKnowledge(kb.id, query);
```

修改为：

```ts
const scope = buildRetrievalScope({
  organizationId,
  intent,
  subIntent,
  businessActions,
  conversationState,
});

const candidates = await hybridRetrieve({
  query,
  scope,
});
```

### buildRetrievalScope 示例

```ts
function buildRetrievalScope(input): RetrievalScope {
  const scope = {
    primaryCategory: input.intent,
    allowedCategories: [],
    preferredKnowledgeIds: [],
    businessActions: input.businessActions ?? [],
    metadataFilters: {
      organizationId: input.organizationId,
      state: "active",
    },
  };

  switch (input.intent) {
    case "damage":
      scope.allowedCategories = [
        "damage",
        "repair",
        "warranty",
        "after_sales",
      ];

      scope.preferredKnowledgeIds = ["KB-208"];
      break;

    case "refund":
      scope.allowedCategories = [
        "refund",
        "return",
        "payment",
        "after_sales",
      ];
      break;
  }

  return scope;
}
```

---

## 2.5 验收标准

Golden Set 中重点增加：

### Case A：父知识不足

```text
商品坏了怎么办？
```

应优先：

```text
KB-208
```

### Case B：明确寄修

```text
商品坏了，我想寄修。
```

应允许：

```text
KB-214
```

超过父知识。

### Case C：多知识

```text
商品买了8个月坏了，怎么申请保修寄修？
```

必须允许：

```text
通用售后
+
保修
+
寄修
```

至少两个独立来源进入最终 evidence candidate。

---

# 3. P0 改造：Hybrid Retrieval 改成“两阶段召回 + 精排”

## 3.1 当前问题

当前：

```text
关键词
+
向量 × 0.5
+
知识覆盖
+
动作分
↓
最多5条
```

问题一：

不同检索系统的 score 量纲不同。

例如：

```text
BM25 = 13.2
cosine = 0.82
```

直接线性加权：

```text
13.2 + 0.82 × 0.5
```

可解释性较差。

问题二：

Top5 截断过早。

真正的 Rerank 应该是：

```text
先尽量不漏
↓
再进行高精度排序
```

---

# 4. 引入 BM25 + Dense 双路召回

推荐：

```text
Query
  ↓
┌───────────────┐
│               │
BM25           Dense
Top20~30       Top20~30
│               │
└───────┬───────┘
        ↓
     Fusion
        ↓
   Candidate 20~30
        ↓
      Rerank
        ↓
      Top5~8
```

推荐默认参数：

```ts
const RETRIEVAL_CONFIG = {
  bm25TopK: 30,
  denseTopK: 30,
  fusionTopK: 25,
  rerankTopK: 8,
};
```

这些只是初始默认值。

最终必须用 Golden Set 调优。

---

# 5. P0 改造：使用 RRF 或规范化 Fusion

## 5.1 推荐优先采用 RRF

公式：

```text
RRF_score(d)
=
Σ 1 / (k + rank_i(d))
```

其中：

- `rank_i(d)`：文档在第 i 个召回器中的排名；
- `k`：常量。

示例：

```ts
function reciprocalRankFusion(
  rankedLists: Candidate[][],
  k = 60,
): FusedCandidate[] {
  const scores = new Map<string, number>();

  for (const list of rankedLists) {
    list.forEach((candidate, index) => {
      const rank = index + 1;
      const score = 1 / (k + rank);

      scores.set(
        candidate.chunkId,
        (scores.get(candidate.chunkId) ?? 0) + score,
      );
    });
  }

  return mergeCandidates(scores);
}
```

---

## 5.2 业务规则不要混进 raw retrieval score

当前：

```text
keyword
+
vector
+
coverage
+
business action
```

建议拆层：

```text
BM25 / Dense
↓
RRF
↓
Business Rule Boost
↓
Rerank
```

例如：

```ts
candidate.ruleBoost = computeBusinessBoost({
  querySignals,
  candidate,
});
```

但不要直接修改 BM25 / cosine 原始分数。

建议：

```ts
preRerankScore =
  rrfScore
  + clamp(ruleBoost, 0, MAX_RULE_BOOST);
```

---

# 6. P0 改造：增加真正的 Semantic Reranker

## 6.1 当前缺失

Embedding 只能回答：

```text
Query 和 Chunk 语义是否相似？
```

Reranker 更关注：

```text
这个 Chunk 是否真正能够回答 Query？
```

因此：

```text
Retriever = High Recall
Reranker = High Precision
```

---

## 6.2 推荐接入方式

设计接口：

```ts
interface Reranker {
  rerank(input: {
    query: string;
    candidates: RetrievalCandidate[];
    topK: number;
  }): Promise<RerankedCandidate[]>;
}
```

不要把具体厂商写死在业务代码。

例如：

```ts
class QwenReranker implements Reranker {}
class LocalReranker implements Reranker {}
class MockReranker implements Reranker {}
```

生产配置：

```env
RERANK_PROVIDER=qwen
RERANK_TOP_K=8
RERANK_TIMEOUT_MS=1500
```

如果当前环境可用阿里模型，可评估：

```text
qwen3-rerank
qwen3-rerank hybrid
```

但模型选择必须以项目实际 API 能力与离线评测结果为准。

---

## 6.3 Rerank 输入

不要只传 Chunk 正文。

推荐：

```text
title
+
section heading
+
chunk content
+
important metadata
```

例如：

```text
标题：商品质量问题售后规则
章节：签收破损
内容：用户签收后发现商品破损……
业务动作：damage
版本：v3
```

---

## 6.4 Rerank 输出结构

```ts
type RerankedCandidate = {
  chunkId: string;

  retrieval: {
    bm25Rank?: number;
    denseRank?: number;
    rrfScore: number;
  };

  businessBoost?: number;

  rerankScore: number;
  rerankRank: number;

  knowledgeId: string;
  parentId?: string;

  content: string;
  metadata: Record<string, unknown>;
};
```

---

# 7. P1 改造：增加 Contextual Query Rewrite

## 7.1 为什么必须加

示例：

```text
第一轮：
我的商品破损了。

第二轮：
那需要拍什么？
```

原 Query：

```text
那需要拍什么？
```

Embedding 的检索信息量非常低。

正确 Retrieval Query：

```text
商品破损售后申请需要拍摄哪些照片或提供哪些证明材料？
```

---

## 7.2 Rewrite 不能篡改业务事实

Rewrite 只允许：

- 补全指代；
- 补全历史已确认主题；
- 改写为独立查询；
- 补全明确的业务动作。

禁止：

- 猜测订单状态；
- 猜测用户商品；
- 猜测退款成功；
- 猜测时间；
- 从 Assistant 历史幻觉中继承事实。

---

## 7.3 数据来源优先级

只使用：

```text
当前用户 Query
+
verifiedFacts
+
activeIntent
+
confirmedTopic
```

禁止直接把：

```text
assistant summary
```

当事实。

---

## 7.4 输出结构

```json
{
  "originalQuery": "那需要拍什么？",
  "retrievalQuery": "商品破损售后申请需要拍摄哪些照片或提供哪些证明材料？",
  "rewriteApplied": true,
  "inheritedSignals": [
    "activeIntent=damage",
    "confirmedTopic=商品破损"
  ]
}
```

---

## 7.5 建议实现

优先：

```text
规则补全
```

复杂指代时：

```text
轻量 Query Rewrite 模型
```

不要直接调用 GLM-5.2 的主生成链路。

可以独立配置：

```env
QUERY_REWRITE_ENABLED=true
QUERY_REWRITE_MAX_HISTORY=6
QUERY_REWRITE_TIMEOUT_MS=800
```

---

# 8. P1 改造：Tool Decision 前移

## 8.1 当前问题

当前顺序：

```text
Intent
↓
RAG
↓
Tool Decision
↓
Tool
```

即使：

```text
订单 OR-123456 的退款到哪了？
```

也先跑一次知识检索。

这是不必要的。

---

## 8.2 新增 Query Need Router

输出：

```ts
type QueryNeed =
  | "knowledge"
  | "live_fact"
  | "mixed"
  | "chitchat"
  | "unsafe_or_unknown";
```

示例：

### A

```text
退款一般多久到账？
```

```json
{
  "need": "knowledge"
}
```

### B

```text
OR-123456退款到哪了？
```

```json
{
  "need": "live_fact"
}
```

### C

```text
OR-123456退款到哪了？一般还要多久？
```

```json
{
  "need": "mixed"
}
```

---

## 8.3 路由

```text
knowledge
→ Retrieval Branch

live_fact
→ Tool Branch

mixed
→ Retrieval + Tool

chitchat
→ Direct Generation

unknown
→ Clarify / Fallback
```

---

# 9. P1 改造：增加一次有界 Corrective Retrieval

## 9.1 不要做开放式 Agent Loop

禁止：

```text
Retrieve
→ Think
→ Retrieve
→ Think
→ Retrieve
...
```

只允许：

```text
maxRetrievalAttempts = 2
maxQueryRewrites = 1
```

---

## 9.2 触发条件

第一次 Retrieval 完成后计算：

```ts
interface RetrievalSufficiency {
  sufficient: boolean;
  reason:
    | "enough"
    | "low_top_score"
    | "low_coverage"
    | "conflicting_candidates"
    | "no_candidate";
}
```

建议触发：

### 条件 A

```text
rerankTop1 < threshold
```

### 条件 B

```text
Top candidates 对问题关键槽位覆盖不足
```

### 条件 C

```text
候选互相明显冲突
```

### 条件 D

```text
没有有效候选
```

---

## 9.3 第二次 Query Correction

例如：

原 Query：

```text
坏了怎么办？
```

第一次检索不足。

Correction：

```text
商品质量问题 售后处理流程 破损故障
```

或者根据 intent：

```text
damage + after_sales + 当前用户表达
```

---

## 9.4 第二次后必须停止

```text
attempt = 2
↓
无论结果如何
↓
禁止第三次检索
```

如果仍然不足：

```text
low confidence
+
clarification / human handoff
```

---

# 10. P1 改造：支持 2~3 个 Knowledge Source

## 10.1 当前单知识不足

示例：

```text
商品买了8个月坏了，怎么申请保修寄修？
```

可能需要：

```text
KB-208 通用售后
+
KB-215 保修政策
+
KB-214 寄修流程
```

因此不要限制：

```text
exactly 1 knowledge
```

建议：

```env
MAX_KNOWLEDGE_SOURCES=3
```

---

## 10.2 不是简单塞 Top3 Chunk

需要去重和聚类。

例如：

Top5：

```text
KB-208 chunk1
KB-208 chunk2
KB-208 chunk3
KB-215 chunk1
KB-214 chunk1
```

最终 Evidence Selection 可以是：

```text
KB-208 最强 chunk
KB-215 最强 chunk
KB-214 最强 chunk
```

而不是同一知识重复 3 次。

---

## 10.3 Evidence Diversity

实现：

```ts
function diversifyEvidence(
  candidates,
  maxKnowledgeSources = 3,
  maxChunksPerKnowledge = 2,
) {}
```

---

# 11. P1 改造：Parent Context Expansion

## 11.1 问题

命中：

```text
申请后需在7日内寄出。
```

模型不知道“申请”是什么。

因此：

```text
Child Chunk Retrieval
↓
Parent Section Expansion
```

---

## 11.2 建议索引结构

```ts
type KnowledgeChunk = {
  chunkId: string;
  knowledgeId: string;

  parentSectionId?: string;
  documentId: string;

  title: string;
  sectionTitle?: string;

  content: string;

  startOffset?: number;
  endOffset?: number;
};
```

---

## 11.3 Expansion 逻辑

只有 Top Evidence 才扩展。

例如：

```ts
if (candidate.rerankRank <= 3 && candidate.parentSectionId) {
  candidate.context =
    await getParentSection(candidate.parentSectionId);
}
```

禁止：

```text
每个候选都加载全文
```

否则 Token 与延迟会快速上升。

---

# 12. P0 改造：Hybrid Failure Fallback

## 12.1 当前风险

当前：

```text
Embedding失败
↓
保留默认稳定知识
↓
回答
```

问题：

```text
Embedding失败
≠
默认知识一定正确
```

这是把：

```text
技术故障
```

转成：

```text
业务事实错误
```

---

## 12.2 新 fallback

```text
Hybrid
↓ fail
BM25-only
↓ fail
Exact / Metadata Match
↓ fail
Low-confidence Fallback
↓
Clarify / Human Handoff
```

---

## 12.3 推荐错误分类

```ts
type RetrievalFailure =
  | "embedding_timeout"
  | "embedding_error"
  | "vector_index_missing"
  | "vector_index_empty"
  | "bm25_error"
  | "rerank_timeout"
  | "rerank_error"
  | "no_candidate";
```

不同错误采取不同降级策略。

---

# 13. P2 改造：Metadata Filtering

建议知识索引统一携带：

```ts
type KnowledgeMetadata = {
  organizationId: string;

  category: string;
  subCategory?: string;

  product?: string;
  region?: string;
  channel?: string;

  version: string;

  state: "active" | "inactive";

  effectiveFrom?: string;
  effectiveTo?: string;

  accessScope?: string[];

  businessActions?: string[];

  parentKnowledgeId?: string;
};
```

检索前执行：

```text
tenant
+
state
+
effective time
+
permission
+
optional category scope
```

而不是召回后再过滤。

---

# 14. P2 改造：Operation Budget 替代 maxSteps

## 14.1 当前 maxSteps 问题

正常状态：

```text
retrieval
tool-decision
tool
evidence
generation
review
complete
```

已经 7 个。

所以：

```text
maxSteps=7
```

更像状态计数，不是资源预算。

---

## 14.2 推荐改为

```ts
interface AgentBudget {
  maxRetrievalAttempts: 2;
  maxQueryRewrites: 1;

  maxToolCalls: 1;
  maxGenerationCalls: 1;

  maxKnowledgeSources: 3;
  maxEvidenceChunks: 8;

  hardDeadlineMs: 25000;
}
```

保留：

```ts
steps: string[]
```

作为 trace，不再作为预算主指标。

---

# 15. Hard Deadline 与 SLA 分离

当前：

```text
25s
```

建议定义为：

```text
Hard Deadline / Circuit Breaker
```

而不是：

```text
目标响应时间
```

单独统计：

```text
queryRewriteLatency
retrievalLatency
fusionLatency
rerankLatency
toolLatency
evidenceBuildLatency
modelTTFT
modelGenerationLatency
reviewLatency
totalLatency
```

并产出：

```text
P50
P90
P95
P99
```

---

# 16. Unified Evidence Package V2

建议统一结构：

```ts
interface UnifiedEvidencePackage {
  traceId: string;

  query: {
    original: string;
    retrieval: string;
    intent: string;
    queryNeed: "knowledge" | "live_fact" | "mixed";
  };

  knowledgeEvidence: EvidenceItem[];

  toolEvidence: EvidenceItem[];

  constraints: {
    canClaimRealtimeStatus: boolean;
    canClaimPolicyRule: boolean;
    canClaimWriteOperation: false;
  };

  sufficiency: {
    sufficient: boolean;
    retrievalAttempts: number;
    reason: string;
  };
}
```

---

# 17. Prompt 约束升级

给 GLM-5.2 的 prompt 不要出现：

```text
请根据上下文尽量帮助用户回答。
```

改成明确证据约束。

示例：

```text
你是 ServicePilot 客服回答生成器。

你的唯一任务是：
把系统提供的结构化证据转化为简洁自然的客服回答。

规则：

1. 实时订单状态只能来自 TOOL_EVIDENCE。
2. 规则、流程、条件、时效只能来自 KNOWLEDGE_EVIDENCE。
3. 不得补全证据中不存在的事实。
4. 不得推测时间、金额、退款状态、订单状态。
5. 不得声称执行任何写操作。
6. 不得承诺“保证、一定、百分之百”等没有证据支持的结果。
7. 若证据不足，明确说需要进一步核实。
8. 回答控制在约150字以内。
```

---

# 18. Claim-level Review V2

把草稿拆分成 Claim。

例如：

```text
订单 OR-123456 当前正在处理中。
审核完成后通常1—3个工作日原路退回。
```

拆成：

```json
[
  {
    "claim": "订单 OR-123456 当前正在处理中",
    "type": "live_fact"
  },
  {
    "claim": "审核完成后通常1—3个工作日原路退回",
    "type": "policy"
  }
]
```

映射：

```json
[
  {
    "claim": "...正在处理中",
    "supportedBy": [
      "tool:order.refund.get"
    ],
    "status": "supported"
  },
  {
    "claim": "1—3个工作日...",
    "supportedBy": [
      "KB-114:v3"
    ],
    "status": "supported"
  }
]
```

状态：

```text
supported
unsupported
contradicted
```

---

# 19. 审计日志 V2

建议新增以下字段：

```json
{
  "traceId": "...",

  "query": {
    "original": "...",
    "rewritten": "..."
  },

  "routing": {
    "intent": "refund",
    "subIntent": "...",
    "queryNeed": "mixed",
    "retrievalScope": []
  },

  "retrieval": {
    "attempts": 1,
    "bm25Count": 30,
    "denseCount": 30,
    "fusionCount": 25,
    "rerankCount": 8,
    "finalKnowledgeCount": 3
  },

  "tool": {
    "decision": "invoke",
    "name": "order.refund.get",
    "success": true
  },

  "generation": {
    "model": "glm-5.2",
    "calls": 1
  },

  "review": {
    "result": "passed",
    "claims": 2,
    "unsupportedClaims": 0
  },

  "budget": {
    "retrievalAttempts": 1,
    "queryRewrites": 0,
    "toolCalls": 1,
    "modelCalls": 1
  },

  "latency": {
    "retrievalMs": 80,
    "rerankMs": 150,
    "toolMs": 120,
    "modelMs": 800,
    "reviewMs": 20,
    "totalMs": 1180
  }
}
```

---

# 20. 推荐状态机 V2

```text
validate
↓
conversation
↓
route
↓
query-rewrite
↓
knowledge-retrieval? ─────┐
↓                         │
tool? ────────────────────┤
↓                         │
evidence                   │
↓                         │
generation?                │
↓                         │
review                     │
↓                         │
complete / fallback        │
```

内部 operation 不必全部成为状态。

例如：

```text
BM25
Dense
Fusion
Rerank
```

可以作为 retrieval 内部 trace span，而不是状态机一级状态。

---

# 21. 推荐核心接口拆分

```text
src/
├── rag/
│   ├── query/
│   │   ├── query-need-router.ts
│   │   ├── contextual-query-rewriter.ts
│   │   └── retrieval-scope-builder.ts
│   │
│   ├── retrieval/
│   │   ├── bm25-retriever.ts
│   │   ├── dense-retriever.ts
│   │   ├── hybrid-retriever.ts
│   │   ├── rrf-fusion.ts
│   │   ├── business-boost.ts
│   │   ├── reranker.ts
│   │   ├── sufficiency-evaluator.ts
│   │   ├── corrective-retrieval.ts
│   │   └── parent-expander.ts
│   │
│   ├── evidence/
│   │   ├── evidence-builder.ts
│   │   ├── evidence-diversifier.ts
│   │   └── evidence-provenance.ts
│   │
│   ├── generation/
│   │   ├── answer-generator.ts
│   │   └── prompt-builder.ts
│   │
│   ├── review/
│   │   ├── claim-extractor.ts
│   │   ├── claim-grounding-reviewer.ts
│   │   └── response-guardrail.ts
│   │
│   ├── tools/
│   │   ├── tool-router.ts
│   │   ├── tool-parameter-validator.ts
│   │   └── order-refund-get.ts
│   │
│   └── agent/
│       ├── bounded-agent-run.ts
│       ├── operation-budget.ts
│       └── audit-trace.ts
```

不要为了目录漂亮强制重构全部文件。

Codex 应优先复用现有代码。

---

# 22. Retrieval V2 参考伪代码

```ts
async function retrieveKnowledge(input) {
  const {
    organizationId,
    originalQuery,
    conversationState,
    intent,
  } = input;

  const retrievalQuery =
    await contextualQueryRewrite({
      originalQuery,
      conversationState,
    });

  const scope =
    buildRetrievalScope({
      organizationId,
      intent,
      conversationState,
    });

  let attempt = 0;
  let query = retrievalQuery;

  while (attempt < 2) {
    attempt += 1;

    const [bm25, dense] =
      await Promise.all([
        bm25Retrieve({
          query,
          scope,
          topK: 30,
        }),

        denseRetrieve({
          query,
          scope,
          topK: 30,
        }),
      ]);

    const fused =
      reciprocalRankFusion(
        [bm25, dense],
        60,
      );

    const boosted =
      applyBusinessBoost({
        query,
        candidates: fused,
        intent,
        businessActions:
          conversationState.businessActions,
      });

    const candidates =
      boosted.slice(0, 25);

    const reranked =
      await reranker.rerank({
        query,
        candidates,
        topK: 8,
      });

    const diversified =
      diversifyEvidence(
        reranked,
        3,
        2,
      );

    const expanded =
      await expandParents(
        diversified,
      );

    const sufficiency =
      evaluateRetrievalSufficiency({
        query,
        evidence: expanded,
      });

    if (sufficiency.sufficient) {
      return {
        query,
        attempt,
        evidence: expanded,
        sufficiency,
      };
    }

    if (attempt >= 2) {
      return {
        query,
        attempt,
        evidence: expanded,
        sufficiency,
      };
    }

    query =
      await correctiveRewrite({
        originalQuery,
        currentQuery: query,
        intent,
        failureReason:
          sufficiency.reason,
      });
  }
}
```

注意：

```text
这不是开放式 Agent Loop。
```

循环上限由代码硬编码：

```text
2
```

---

# 23. Tool Branch 参考伪代码

```ts
async function resolveToolBranch(input) {
  const decision =
    deterministicToolDecision({
      query: input.query,
      intent: input.intent,
      verifiedFacts:
        input.conversationState.verifiedFacts,
    });

  switch (decision.action) {
    case "skip":
      return {
        toolEvidence: [],
        requestedParameter: null,
      };

    case "request_parameter":
      return {
        toolEvidence: [],
        requestedParameter:
          decision.missingParameters,
      };

    case "invoke":
      agentBudget.consumeToolCall();

      const result =
        await orderRefundGet({
          organizationId:
            input.organizationId,
          orderId:
            decision.orderId,
        });

      return {
        toolEvidence:
          normalizeToolEvidence(result),
        requestedParameter: null,
      };
  }
}
```

---

# 24. 需要删除或避免的设计

## 删除 / 弱化

### 1. 唯一 `retrievalKnowledgeId`

删除：

```ts
retrievalKnowledgeId: "KB-208"
```

替换：

```ts
retrievalScope
preferredKnowledgeIds
allowedCategories
```

### 2. 直接把不同 raw score 相加

弱化：

```text
keywordScore
+
vectorScore × 0.5
```

改为：

```text
RRF
+
受控业务 Boost
+
Rerank
```

### 3. Hybrid 失败自动使用默认知识回答

删除。

### 4. `maxSteps` 作为主要 Agent 预算

弱化为 trace。

---

## 暂时不要加

### 1. Multi-Agent

当前没有必要。

### 2. GraphRAG

你的退款 / 破损 / 地址 / 发票客服业务目前不属于典型图关系问题。

### 3. 任意 Tool Calling

继续使用 allowlist。

### 4. LLM 自由 Planning

当前客服场景不值得。

### 5. 无限 Reflection

禁止。

### 6. 三次以上 Retrieval

不建议。

---

# 25. Eval / 验收体系

不能只看最终回答。

必须拆 Retrieval 与 Generation。

---

## 25.1 Retrieval Eval Dataset

建议至少：

```text
300~500 条
```

真实客服 Query。

覆盖：

```text
refund
damage
address
invoice
multi-turn
ambiguous
tool-required
mixed
no-answer
adversarial
```

每条标注：

```json
{
  "query": "...",
  "intent": "damage",
  "requiredKnowledgeIds": [
    "KB-208",
    "KB-215"
  ],
  "requiredTool": false,
  "answerable": true
}
```

---

## 25.2 Retrieval 指标

至少：

```text
Hit@5
Recall@5
Recall@10
MRR
nDCG@5
```

推荐目标：

```text
Recall@5 >= 90%
Recall@10 >= 95%
```

这些是项目目标，不是行业统一标准。

最终阈值必须基于当前 Golden Set baseline 决定。

---

## 25.3 Router 指标

```text
Intent Accuracy
SubIntent Accuracy
Tool Need Accuracy
False Tool Invocation Rate
Missed Tool Invocation Rate
```

特别关注：

```text
不应该查工具却查了
```

和：

```text
应该查实时状态却走了 RAG
```

---

## 25.4 Rerank 指标

比较：

```text
Hybrid before rerank
vs
Hybrid + rerank
```

关注：

```text
MRR
nDCG
Top1 Hit
```

---

## 25.5 Generation 指标

```text
Answer Correctness
Groundedness
Completeness
Policy Compliance
Unsupported Claim Rate
```

建议硬性：

```text
Unsupported Realtime Claim = 0
Unauthorized Write Claim = 0
```

---

## 25.6 性能指标

```text
P50
P90
P95
P99
```

分别统计：

```text
rewrite
embedding
bm25
dense
fusion
rerank
tool
generation
review
total
```

---

# 26. A/B 实验设计

继续使用现有请求头：

```text
x-servicepilot-retrieval-experiment:
bounded-agentic-rag-step9.8-v1
```

建议新增：

```text
bounded-agentic-rag-step9.8-v2
```

不要直接替换生产。

---

## V1

```text
当前 Step 9.8
```

## V2

```text
Scope Routing
+
BM25/Dense Wider Recall
+
RRF
+
Rerank
+
Contextual Rewrite
+
max 1 Corrective Retrieval
+
Multi-source Evidence
```

---

## 对比指标

```text
Recall@5
Recall@10
MRR
Answer Correctness
Groundedness
Human Handoff Rate
No-answer Rate
P95 Latency
Average Token Cost
```

---

# 27. 推荐改造顺序

## Phase 1 — P0 Retrieval Foundation

先做：

```text
1. 删除 single knowledge lock
2. Retrieval Scope
3. BM25 + Dense 双路
4. Wider TopK
5. RRF
6. Semantic Reranker
7. BM25-only fallback
```

此阶段先不要增加纠正检索。

目的：

> 先证明“一次检索”本身足够强。

---

## Phase 2 — Query Understanding

增加：

```text
Contextual Query Rewrite
Query Need Router
Tool Decision 前移
```

目的：

> 解决多轮指代和无效 RAG 调用。

---

## Phase 3 — Bounded Adaptive Retrieval

增加：

```text
Sufficiency Check
+
最多1次 Corrective Retrieval
```

目的：

> 只给难题增加额外成本。

---

## Phase 4 — Evidence Quality

增加：

```text
Multi-Knowledge
Parent Expansion
Evidence Diversity
Evidence Provenance
```

---

## Phase 5 — Claim Grounding & Observability

增加：

```text
Claim → Evidence Mapping
Latency Metrics
A/B Dashboard
Retrieval Eval
```

---

# 28. Codex 实施要求

Codex 在修改项目时必须遵守：

1. **先阅读当前 Step 9.1、9.5、9.6、9.7、9.8 的完整实现。**
2. 不允许凭本文档假设当前目录结构。
3. 优先复用现有接口和测试。
4. 不允许一次性重写整个 RAG。
5. 每个 Phase 独立提交。
6. 每个 Phase 必须有 rollback path。
7. 默认关闭 V2，通过实验 header 开启。
8. 当前生产流量不受影响。
9. 不允许删除现有审计字段，除非增加兼容迁移。
10. 不允许扩大 Tool 权限。
11. 不允许增加写工具。
12. 不允许把工具决策交给 GLM-5.2。
13. 不允许增加无限循环。
14. Corrective Retrieval 最大次数固定为 1。
15. 生成模型调用仍最多 1 次。
16. 所有新增阈值必须配置化。
17. 所有阈值必须能够通过 Eval 调优，不得硬编码为“行业最佳值”。
18. 新增功能必须增加单元测试 / 集成测试 / Eval Case。
19. 所有外部模型调用必须有 timeout。
20. 外部服务失败必须有显式 fallback。

---

# 29. Codex 第一阶段任务清单

Codex 首先只执行 Phase 1。

## 必做

- [ ] 找到当前 `retrievalKnowledgeId` 或同类单知识硬路由代码
- [ ] 设计 `RetrievalScope`
- [ ] 保留 intent 对默认知识的 boost
- [ ] 不再强制唯一知识
- [ ] 梳理现有关键词检索实现
- [ ] 梳理现有向量检索实现
- [ ] 将初始候选扩大到可配置 TopK
- [ ] 实现 RRF
- [ ] 将业务动作评分迁移至 fusion 后
- [ ] 接入 `Reranker` 抽象接口
- [ ] 配置 reranker timeout
- [ ] reranker 失败时回退到 fusion 结果
- [ ] embedding 失败时走 BM25-only
- [ ] BM25 也失败时安全降级
- [ ] 增加 retrieval trace
- [ ] 增加 BM25 / dense / fusion / rerank 四阶段候选审计
- [ ] 保留 V1
- [ ] 新增 V2 experiment header
- [ ] 增加 Eval 对比

---

# 30. Codex 完成 Phase 1 后必须输出

完成后不要只回复“已完成”。

必须输出：

```text
1. 修改了哪些文件
2. 新增了哪些文件
3. Retrieval V1 和 V2 的完整执行路径
4. RRF 的具体实现
5. Reranker 的具体实现
6. fallback 路径
7. 新增环境变量
8. 新增配置
9. 新增测试
10. 测试结果
11. Eval baseline
12. V1 vs V2 Retrieval 指标
13. P50/P95 延迟变化
14. 是否存在 backward compatibility 风险
15. 下一阶段建议
```

---

# 31. Codex 可直接执行的任务 Prompt

```text
你现在需要优化 ServicePilot 当前 Step 9.8 Bounded Agentic RAG。

请先完整阅读项目中与 Step 9.1、Step 9.5、Step 9.6、Step 9.7、Step 9.8 有关的源码、测试、配置、数据库 schema、知识索引、审计 trace 和实验开关。

不要立即修改代码。

第一步先输出：
1. 当前真实代码结构；
2. Step 9.8 的真实调用链；
3. 当前单知识路由具体在哪实现；
4. 当前关键词检索具体实现；
5. 当前向量检索具体实现；
6. 当前 Hybrid score 的真实公式；
7. 当前候选 TopK；
8. 当前 fallback；
9. 当前测试覆盖；
10. 当前可复用接口。

然后，仅执行本文档的 Phase 1：

【目标】
把当前 Retrieval 从：
单知识硬路由 + 手工线性 Hybrid + 过早 Top5

升级为：

Retrieval Scope
→ BM25 Wider Recall
+ Dense Wider Recall
→ RRF
→ Business Rule Boost
→ Semantic Reranker
→ TopK Evidence

【硬约束】
- 不修改 GLM-5.2 的生成职责；
- 不把 Tool Decision 交给模型；
- 不增加新写工具；
- 不增加 Agent 自由规划；
- 不增加 Corrective Retrieval；
- 不增加 Multi-Agent；
- 不删除 V1；
- 新链路只能通过 bounded-agentic-rag-step9.8-v2 实验开关启用；
- 保证 V1 兼容；
- 所有新增参数配置化；
- 外部模型调用必须 timeout；
- reranker 失败必须安全回退；
- embedding 失败走 BM25-only；
- BM25 也失败则进入现有安全 fallback，不允许默认知识强答。

【测试要求】
至少增加：
1. 单知识明确问题；
2. 父知识 + 子知识竞争；
3. 多知识潜在问题；
4. 关键词强匹配；
5. 语义改写；
6. embedding failure；
7. reranker timeout；
8. tenant filter；
9. expired knowledge；
10. wrong-category route；
11. no-result；
12. business action boost。

完成后运行全部相关测试，并输出：
- 文件变更；
- 架构差异；
- 配置；
- 测试；
- Eval；
- 延迟；
- 风险；
- 下一阶段建议。

不要直接开始 Phase 2。
```

---

# 32. P0 / P1 / P2 总表

| 优先级 | 项目 | 动作 |
|---|---|---|
| P0 | Single-KB Hard Routing | 改为 Scope + Boost |
| P0 | Hybrid Top5 | 扩大第一阶段候选 |
| P0 | Score Fusion | 优先 RRF |
| P0 | Semantic Rerank | 增加 |
| P0 | Hybrid Failure | 改 BM25-only fallback |
| P1 | Contextual Query Rewrite | 增加 |
| P1 | Tool Decision | 前移 |
| P1 | Corrective Retrieval | 最多1次 |
| P1 | Multi-Knowledge Evidence | 最大2~3来源 |
| P1 | Parent Expansion | 增加 |
| P2 | Metadata Filters | 完善 |
| P2 | Operation Budget | 替代 maxSteps 主预算 |
| P2 | Claim Evidence Mapping | 增强 |
| P2 | Observability | 增加分阶段 latency |
| 暂不做 | Multi-Agent | 不做 |
| 暂不做 | GraphRAG | 不做 |
| 暂不做 | Unlimited Reflection | 禁止 |
| 暂不做 | Free Tool Calling | 禁止 |

---

# 33. 与大厂公开方案的对应关系

## Microsoft Azure AI Search

公开主流方案：

```text
Hybrid Search
=
Keyword / BM25
+
Vector
→ RRF
→ Semantic Ranker
```

同时提供 Agentic Retrieval：

```text
LLM-assisted query planning
+
multi-query
+
multi-source
+
semantic reranking
```

ServicePilot 不需要复制 Azure 的开放式 Query Planning，但可以学习：

```text
Hybrid
RRF
Semantic Ranker
Multi-source
Conversation-aware Query
```

---

## AWS Bedrock Knowledge Bases

公开建议包括：

```text
Hybrid Search
Wider First-stage Retrieval
Rerank
Metadata Filters
Agentic Retrieval for complex queries
```

AWS Agentic Retrieval 支持：

```text
query decomposition
iterative retrieval
sufficiency evaluation
maximum iterations
```

ServicePilot 对应实现：

```text
maxRetrievalAttempts = 2
```

而不是开放式循环。

---

## Google Agent Search

公开 Retrieval / Ranking 结构：

```text
Query Understanding / Rewrite
↓
Retrieval
↓
Ranking
↓
Top Results
```

Google 明确把：

```text
Embedding similarity
```

和：

```text
Ranking relevance
```

区分。

这正是 ServicePilot 需要增加真正 Reranker 的原因。

---

## 阿里云百炼

当前公开企业知识检索链：

```text
Query Rewrite
↓
Vector + Keyword Retrieval
↓
Rerank
↓
Result
```

并支持：

```text
Multi-Knowledge Base Retrieval
Metadata / Field Filter
Multi-turn Query Rewrite
```

ServicePilot 可以采用同类思路，但保留当前更严格的工具治理与回答审查。

---

# 34. 官方参考资料

以下资料用于本优化方案的技术依据。

## Microsoft

- Azure AI Search — Relevance and Ranking Overview  
  https://learn.microsoft.com/en-us/azure/search/search-relevance-overview

- Azure AI Search — Hybrid Search Overview  
  https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview

- Azure AI Search — Hybrid Search Scoring / RRF  
  https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking

- Azure AI Search — Semantic Ranking Overview  
  https://learn.microsoft.com/en-us/azure/search/semantic-search-overview

- Azure AI Search — RAG Overview  
  https://learn.microsoft.com/en-us/azure/search/retrieval-augmented-generation-overview

- Azure AI Search — Agentic Retrieval Overview  
  https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview

## AWS

- Amazon Bedrock Knowledge Bases  
  https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html

- Amazon Bedrock Agentic Retrieval  
  https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-agentic-retrieve.html

- Amazon Bedrock Retrieval  
  https://docs.aws.amazon.com/bedrock/latest/userguide/kb-how-retrieval.html

- Amazon Bedrock Rerank  
  https://docs.aws.amazon.com/bedrock/latest/userguide/rerank.html

- AWS Agentic AI Lens — Optimize RAG Retrieval Pipelines  
  https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentperf03-bp03.html

## Google Cloud

- Agent Search — About Retrieval and Ranking  
  https://docs.cloud.google.com/generative-ai-app-builder/docs/ranking-overview

- Agent Search — Ranking API  
  https://docs.cloud.google.com/generative-ai-app-builder/docs/ranking

- Agent Search — Answers / Query Rephrasing  
  https://docs.cloud.google.com/generative-ai-app-builder/docs/answer

## 阿里云百炼

- 知识检索  
  https://help.aliyun.com/zh/model-studio/rag-knowledge-retrieval

- 知识库  
  https://help.aliyun.com/zh/model-studio/rag-knowledge-base

- RAG 效果优化  
  https://help.aliyun.com/zh/model-studio/rag-optimization/

---

# 35. 最终目标

ServicePilot 不应该被改造成：

```text
一个让 LLM 自由规划、
自由搜索、
自由调用工具、
自由循环的 Agent。
```

最终目标应该是：

> **生产级、代码编排、策略治理、严格限权、可审计、可评测、可降级的 Bounded Agentic RAG。**

推荐最终定位：

```text
Hybrid Retrieval
+
Semantic Rerank
+
Adaptive Retrieval
+
Read-only Tool
+
Unified Evidence
+
Claim Grounding
+
Bounded State Governance
+
Full Audit
```

一句话总结：

> **让 Retrieval 更聪明，但不要让 Agent 更失控。**
