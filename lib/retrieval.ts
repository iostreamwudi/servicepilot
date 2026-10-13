import { scopeAllowsKnowledge, type RetrievalScope } from "./retrieval-scope.ts";

export type RetrievalDocument = {
  id: string;
  title: string;
  content: string;
  category: string;
  keywords: string[];
  state: "draft" | "review" | "active" | "archived";
  risk: "low" | "medium" | "high";
  handoff: boolean;
  coverage: number;
  validFrom?: string | null;
  validUntil?: string | null;
  version?: string;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  organizationId?: string;
};

export type RetrievalCandidate = {
  document: RetrievalDocument;
  lexicalScore: number;
  vectorScore: number;
  fusedScore: number;
  matchedKeywords: string[];
  filterReasons: string[];
};

export type KnowledgeBusinessMetadata = {
  parentId: string | null;
  relation: "parent" | "child";
  businessActions: string[];
  evidenceSlots: string[];
  conditionSignals: string[];
};

export type RetrievalGuardResult = RetrievalCandidate & { guardReason?: string; actionReason?: string; actionMatched?: boolean };

export type WideRetrievalCandidate = RetrievalCandidate & {
  chunkId: string;
  parentId: string | null;
  bm25Rank: number | null;
  denseRank: number | null;
  rrfScore: number;
  businessBoost: number;
  businessBoostReason: string | null;
  rerankScore?: number;
  rerankRank?: number;
};

export type Bm25RetrievalCandidate = RetrievalCandidate & {
  bm25Score: number;
  matchedTerms: string[];
  documentLength: number;
};

export type ContextualKnowledgeChunk = {
  id: string;
  documentId: string;
  parentDocumentId: string | null;
  position: number;
  sectionType: "condition" | "timing" | "evidence" | "action" | "rule";
  content: string;
  contextualText: string;
};

export type ContextualBm25Candidate = Bm25RetrievalCandidate & {
  parentDocumentId: string | null;
  bestChunk: ContextualKnowledgeChunk;
  chunkScores: Array<{ chunkId: string; score: number }>;
};

export type MultiQueryRrfOptions = Bm25RetrievalOptions & { rrfK?: number; queryWeights?: readonly number[] };

export type RetrievalOptions = {
  category?: string;
  defaultDocumentId?: string;
  /** Optional scores produced by a future embedding provider, keyed by document id. */
  vectorScores?: ReadonlyMap<string, number>;
  now?: Date;
  limit?: number;
  vectorWeight?: number;
  coverageWeight?: number;
};

export type Bm25RetrievalOptions = Pick<RetrievalOptions, "category" | "defaultDocumentId" | "now" | "limit"> & {
  k1?: number;
  b?: number;
};

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[，。！？、,.!?；;：:]/g, "");
}

function isDateValid(document: RetrievalDocument, now: Date) {
  const timestamp = now.getTime();
  const from = document.validFrom ? new Date(document.validFrom).getTime() : Number.NEGATIVE_INFINITY;
  const until = document.validUntil ? new Date(document.validUntil).getTime() : Number.POSITIVE_INFINITY;
  return timestamp >= from && timestamp <= until;
}

function lexicalMatch(document: RetrievalDocument, query: string, defaultDocumentId?: string) {
  const normalized = normalize(query);
  const matchedKeywords = document.keywords.filter((keyword) => normalized.includes(normalize(keyword)));
  const lexicalScore = matchedKeywords.reduce((score, keyword) => score + 1 + Math.min(normalize(keyword).length, 8), 0)
    + (document.id === defaultDocumentId ? 2 : 0);
  return { lexicalScore, matchedKeywords };
}

function normalizedBm25Text(value: string) {
  // Dataset and production redaction placeholders describe data types, not
  // customer intent. Indexing “[数字]” as the term “数字” caused false matches
  // with articles about digital goods, so remove placeholders before tokenizing.
  return value.normalize("NFKC").toLowerCase().replace(/\[[^\]]+\]/g, " ");
}

/**
 * Produces deterministic terms without an external Chinese tokenizer.
 * Two/three-character Han grams preserve business phrases such as “税号” and
 * “原路退”, while Latin words and order-like identifiers remain whole tokens.
 */
export function tokenizeBm25Text(value: string) {
  const segments = normalizedBm25Text(value).match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? [];
  const terms: string[] = [];
  for (const segment of segments) {
    if (!/^[\p{Script=Han}]+$/u.test(segment)) {
      terms.push(segment);
      continue;
    }
    if (segment.length === 1) {
      terms.push(segment);
      continue;
    }
    for (const size of [2, 3]) {
      if (segment.length < size) continue;
      for (let index = 0; index <= segment.length - size; index += 1) terms.push(segment.slice(index, index + size));
    }
  }
  return terms;
}

function bm25KeywordTerm(keyword: string) {
  return `kw:${normalize(keyword)}`;
}

function bm25DocumentTerms(document: RetrievalDocument) {
  return [
    ...tokenizeBm25Text(document.title),
    ...tokenizeBm25Text(document.content),
    ...document.keywords.flatMap((keyword) => tokenizeBm25Text(keyword)),
    ...document.keywords.map(bm25KeywordTerm),
  ];
}

/**
 * Side-effect-free sparse retrieval for Step 8.1 experiments. It intentionally
 * does not change the production selector until the frozen evaluation proves
 * an improvement over the current lexical strategy.
 */
export function retrieveBm25Candidates(
  documents: readonly RetrievalDocument[],
  query: string,
  options: Bm25RetrievalOptions = {},
): Bm25RetrievalCandidate[] {
  const now = options.now ?? new Date();
  const eligible = documents.filter((document) => document.state === "active"
    && (!options.category || document.category === options.category)
    && isDateValid(document, now));
  if (!eligible.length) return [];

  const indexed = eligible.map((document) => ({ document, terms: bm25DocumentTerms(document) }));
  const averageLength = indexed.reduce((total, item) => total + item.terms.length, 0) / indexed.length || 1;
  const allKeywords = [...new Set(eligible.flatMap((document) => document.keywords))];
  const normalizedQuery = normalize(query);
  const queryTerms = [...new Set([
    ...tokenizeBm25Text(query),
    ...allKeywords.filter((keyword) => normalizedQuery.includes(normalize(keyword))).map(bm25KeywordTerm),
  ])];
  const documentFrequency = new Map<string, number>();
  for (const item of indexed) {
    for (const term of new Set(item.terms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const candidates = indexed.map(({ document, terms }) => {
    const frequencies = new Map<string, number>();
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    const matchedTerms = queryTerms.filter((term) => frequencies.has(term));
    const bm25Score = matchedTerms.reduce((total, term) => {
      const frequency = frequencies.get(term) ?? 0;
      const frequencyInDocuments = documentFrequency.get(term) ?? 0;
      const inverseDocumentFrequency = Math.log(1 + (indexed.length - frequencyInDocuments + 0.5) / (frequencyInDocuments + 0.5));
      const denominator = frequency + k1 * (1 - b + b * terms.length / averageLength);
      return total + inverseDocumentFrequency * frequency * (k1 + 1) / denominator;
    }, 0);
    const matchedKeywords = document.keywords.filter((keyword) => normalizedQuery.includes(normalize(keyword)));
    return {
      document,
      lexicalScore: bm25Score,
      bm25Score,
      vectorScore: 0,
      fusedScore: bm25Score,
      matchedKeywords,
      matchedTerms,
      documentLength: terms.length,
      filterReasons: [],
    };
  });
  return candidates
    .sort((left, right) => right.bm25Score - left.bm25Score
      || Number(right.document.id === options.defaultDocumentId) - Number(left.document.id === options.defaultDocumentId)
      || right.document.coverage - left.document.coverage)
    .slice(0, options.limit ?? 5);
}

export function selectBm25Candidate(candidates: readonly Bm25RetrievalCandidate[], defaultDocumentId?: string) {
  if (!candidates.length) return null;
  if (candidates[0].bm25Score > 0) return candidates[0];
  return candidates.find((candidate) => candidate.document.id === defaultDocumentId) ?? candidates[0];
}

/**
 * Shared retrieval contract for lexical, vector and future agentic retrieval.
 * This is intentionally side-effect free so it can be used by shadow evaluation
 * without changing the production answer path.
 */
export function retrieveCandidates(
  documents: readonly RetrievalDocument[],
  query: string,
  options: RetrievalOptions = {},
): RetrievalCandidate[] {
  const now = options.now ?? new Date();
  const vectorScores = options.vectorScores ?? new Map<string, number>();
  const candidates = documents.flatMap((document) => {
    const filterReasons: string[] = [];
    if (document.state !== "active") filterReasons.push("inactive");
    if (options.category && document.category !== options.category) filterReasons.push("category-mismatch");
    if (!isDateValid(document, now)) filterReasons.push("outside-validity");
    if (filterReasons.length) return [];
    const { lexicalScore, matchedKeywords } = lexicalMatch(document, query, options.defaultDocumentId);
    const vectorScore = Math.max(0, Math.min(1, vectorScores.get(document.id) ?? 0));
    // The weights are a baseline only. They will be calibrated against the
    // frozen evaluation set before any production traffic is switched.
    const fusedScore = lexicalScore + vectorScore * (options.vectorWeight ?? 10) + document.coverage * (options.coverageWeight ?? 1);
    return [{ document, lexicalScore, vectorScore, fusedScore, matchedKeywords, filterReasons }];
  });
  return candidates
    .sort((left, right) => right.fusedScore - left.fusedScore || right.document.coverage - left.document.coverage)
    .slice(0, options.limit ?? 5);
}

export function selectRetrievalCandidate(candidates: readonly RetrievalCandidate[], defaultDocumentId?: string) {
  if (!candidates.length) return null;
  const top = candidates[0];
  if (top.lexicalScore > 0 || top.vectorScore >= 0.55) return top;
  return candidates.find((candidate) => candidate.document.id === defaultDocumentId) ?? top;
}

const parentByChild: Record<string, string> = {
  "KB-117": "KB-114", "KB-118": "KB-114", "KB-119": "KB-114", "KB-120": "KB-114",
  "KB-209": "KB-208", "KB-210": "KB-208", "KB-211": "KB-208", "KB-212": "KB-208", "KB-213": "KB-208", "KB-214": "KB-208", "KB-215": "KB-208", "KB-216": "KB-208",
  "KB-302": "KB-301", "KB-303": "KB-301", "KB-304": "KB-301",
  "KB-402": "KB-401", "KB-403": "KB-401", "KB-404": "KB-401", "KB-405": "KB-401",
};

export function parentKnowledgeId(documentId: string) {
  return parentByChild[documentId] ?? null;
}

export function sameKnowledgeFamily(leftId: string, rightId: string) {
  if (leftId === rightId) return true;
  const leftRoot = parentByChild[leftId] ?? leftId;
  const rightRoot = parentByChild[rightId] ?? rightId;
  return leftRoot === rightRoot;
}

const actionByChild: Record<string, { terms: RegExp; label: string }> = {
  "KB-117": { terms: /拆封|包装|说明书|商品完好|二次销售|试用/, label: "商品完好与拆封" },
  "KB-118": { terms: /赠品|组合商品|一起退|配件一起退/, label: "赠品随退" },
  "KB-119": { terms: /运费|邮费|谁承担|到付/, label: "退货运费" },
  "KB-120": { terms: /退款期限|退回商品|收到退货|法定期限/, label: "退款法定节点" },
  "KB-209": { terms: /质量|故障|不能用|用不了|不合格|瑕疵|描述不一致/, label: "质量认定" },
  "KB-210": { terms: /快递破损|运输破损|保价|快递赔偿/, label: "快件损毁" },
  "KB-211": { terms: /签收|验货|当面验收|外包装|拍照|留证|证据|拒收/, label: "签收验货与留证" },
  "KB-212": { terms: /少件|缺件|短少|漏发|缺少配件/, label: "少件补发" },
  "KB-213": { terms: /丢件|丢失|遗失|找不到|未收到/, label: "丢件处理" },
  "KB-214": { terms: /维修|返修|修理|维修点|寄修|上门维修/, label: "维修" },
  "KB-215": { terms: /保修|质保|保修期|质保期|联保|保修凭证/, label: "保修" },
  "KB-216": { terms: /三包|包修|包换|包退|七天退|十五天换/, label: "三包" },
  "KB-302": { terms: /手机号|电话|收件人|姓名|联系人/, label: "收件人信息" },
  "KB-303": { terms: /无法投递|拒收|拦截|退回|派送失败|联系不上/, label: "投递失败" },
  "KB-304": { terms: /物流查询|快递客服|处理时限|物流延误|物流投诉/, label: "物流查询" },
  "KB-402": { terms: /抬头|税号|公司名称|开错|修改发票|重开/, label: "发票信息更正" },
  "KB-403": { terms: /红冲|红字发票|入账确认|用途确认/, label: "发票红冲" },
  "KB-404": { terms: /退货发票|退款发票|销售折让|服务中止|退货后发票/, label: "退货后的发票" },
  "KB-405": { terms: /查发票|下载发票|打印发票|发票查验/, label: "发票查验" },
};

const actionKeyByChild: Record<string, string> = {
  "KB-117": "return_condition", "KB-118": "return_bundle", "KB-119": "return_shipping", "KB-120": "refund_timing",
  "KB-209": "quality_claim", "KB-210": "carrier_damage", "KB-211": "inspection_evidence", "KB-212": "missing_item",
  "KB-213": "lost_parcel", "KB-214": "repair", "KB-215": "warranty", "KB-216": "three_guarantees",
  "KB-302": "recipient_change", "KB-303": "delivery_failure", "KB-304": "logistics_query",
  "KB-402": "invoice_correction", "KB-403": "invoice_red_notice", "KB-404": "return_invoice", "KB-405": "invoice_lookup",
};

/** Derives governed metadata without mutating the knowledge source. */
export function deriveKnowledgeBusinessMetadata(document: Pick<RetrievalDocument, "id" | "title" | "content" | "category">): KnowledgeBusinessMetadata {
  const text = `${document.title}；${document.content}`;
  const parentId = parentByChild[document.id] ?? null;
  const evidenceSlots = [
    /订单|订单号|核验/.test(text) && "order_reference",
    /照片|面单|外包装|证据|凭证|拍照/.test(text) && "customer_evidence",
    /工作日|小时|期限|时效|日内/.test(text) && "timing",
    /金额|价款|支付|银行卡|到账/.test(text) && "payment_fact",
    /地址|收件人|手机号|电话/.test(text) && "fulfilment_target",
    /发票|税号|抬头|开票/.test(text) && "invoice_fact",
    /快递|承运|物流|投递/.test(text) && "logistics_fact",
    /申请|提交|联系|处理|修改|退回|维修|换货|退货/.test(text) && "business_action",
  ].filter((value): value is string => Boolean(value));
  const conditionSignals = text.match(/(?:如|若|当|未|已|不适用|适用|前提)[^。！？；]{0,28}/g) ?? [];
  return {
    parentId,
    relation: parentId ? "child" : "parent",
    businessActions: actionKeyByChild[document.id] ? [actionKeyByChild[document.id]] : ["general_policy"],
    evidenceSlots: [...new Set(evidenceSlots)],
    conditionSignals: [...new Set(conditionSignals)].slice(0, 8),
  };
}

const categoryLabels: Record<string, string> = {
  refund: "退款与退货",
  damage: "商品破损与售后",
  address: "地址与物流",
  invoice: "发票",
};

function splitKnowledgeSentences(content: string) {
  const sentences = content.split(/(?<=[。！？!?；;])/u).map((item) => item.trim()).filter(Boolean);
  return sentences.length ? sentences : [content.trim()].filter(Boolean);
}

function sectionTypeFor(content: string): ContextualKnowledgeChunk["sectionType"] {
  if (/工作日|小时|日内|期限|时效|超过\d|72小时/.test(content)) return "timing";
  if (/凭证|证据|拍照|核验|订单归属|身份/.test(content)) return "evidence";
  if (/如|若|当|未|已|发生|不适用|适用|除外|前提/.test(content)) return "condition";
  if (/应|可以|建议|申请|提交|联系|处理|转人工|修改|退回/.test(content)) return "action";
  return "rule";
}

export function buildContextualKnowledgeChunks(documents: readonly RetrievalDocument[]): ContextualKnowledgeChunk[] {
  const documentById = new Map(documents.map((document) => [document.id, document]));
  return documents.flatMap((document) => {
    const parentDocumentId = parentByChild[document.id] ?? null;
    const parent = parentDocumentId ? documentById.get(parentDocumentId) : null;
    return splitKnowledgeSentences(document.content).map((content, position) => {
      const sectionType = sectionTypeFor(content);
      const contextualText = [
        `业务类目：${categoryLabels[document.category] ?? document.category}`,
        parent ? `父知识：${parent.title}` : null,
        `知识主题：${document.title}`,
        `段落类型：${sectionType}`,
        `关键词：${document.keywords.join("、")}`,
        `正文：${content}`,
      ].filter(Boolean).join("；");
      return { id: `${document.id}#${position + 1}`, documentId: document.id, parentDocumentId, position, sectionType, content, contextualText };
    });
  });
}

/**
 * Retrieves sentence-level evidence with parent/title context, then aggregates
 * the strongest chunk back to its governed knowledge document. This preserves
 * citation/version boundaries while preventing long documents from diluting a
 * relevant condition or timing sentence.
 */
export function retrieveContextualBm25Candidates(
  documents: readonly RetrievalDocument[],
  query: string,
  options: Bm25RetrievalOptions = {},
): ContextualBm25Candidate[] {
  const now = options.now ?? new Date();
  const eligible = documents.filter((document) => document.state === "active"
    && (!options.category || document.category === options.category)
    && isDateValid(document, now));
  if (!eligible.length) return [];
  const documentById = new Map(eligible.map((document) => [document.id, document]));
  const chunks = buildContextualKnowledgeChunks(eligible);
  const allKeywords = [...new Set(eligible.flatMap((document) => document.keywords))];
  const normalizedQuery = normalize(query);
  const queryTerms = [...new Set([
    ...tokenizeBm25Text(query),
    ...allKeywords.filter((keyword) => normalizedQuery.includes(normalize(keyword))).map(bm25KeywordTerm),
  ])];
  const indexed = chunks.map((chunk) => {
    const document = documentById.get(chunk.documentId)!;
    return { chunk, terms: [...tokenizeBm25Text(chunk.contextualText), ...document.keywords.map(bm25KeywordTerm)] };
  });
  const averageLength = indexed.reduce((total, item) => total + item.terms.length, 0) / indexed.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const item of indexed) for (const term of new Set(item.terms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const scoredChunks = indexed.map(({ chunk, terms }) => {
    const frequencies = new Map<string, number>();
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    const matchedTerms = queryTerms.filter((term) => frequencies.has(term));
    const score = matchedTerms.reduce((total, term) => {
      const frequency = frequencies.get(term) ?? 0;
      const frequencyInDocuments = documentFrequency.get(term) ?? 0;
      const inverseDocumentFrequency = Math.log(1 + (indexed.length - frequencyInDocuments + 0.5) / (frequencyInDocuments + 0.5));
      const denominator = frequency + k1 * (1 - b + b * terms.length / averageLength);
      return total + inverseDocumentFrequency * frequency * (k1 + 1) / denominator;
    }, 0);
    return { chunk, terms, matchedTerms, score };
  });
  const candidates = eligible.map((document) => {
    const documentChunks = scoredChunks.filter((item) => item.chunk.documentId === document.id).sort((left, right) => right.score - left.score);
    const best = documentChunks[0];
    const bm25Score = best?.score ?? 0;
    return {
      document,
      lexicalScore: bm25Score,
      bm25Score,
      vectorScore: 0,
      fusedScore: bm25Score,
      matchedKeywords: document.keywords.filter((keyword) => normalizedQuery.includes(normalize(keyword))),
      matchedTerms: best?.matchedTerms ?? [],
      documentLength: best?.terms.length ?? 0,
      filterReasons: [],
      parentDocumentId: best?.chunk.parentDocumentId ?? parentByChild[document.id] ?? null,
      bestChunk: best?.chunk ?? buildContextualKnowledgeChunks([document])[0],
      chunkScores: documentChunks.map((item) => ({ chunkId: item.chunk.id, score: item.score })),
    };
  });
  return candidates.sort((left, right) => right.bm25Score - left.bm25Score
    || Number(right.document.id === options.defaultDocumentId) - Number(left.document.id === options.defaultDocumentId)
    || right.document.coverage - left.document.coverage).slice(0, options.limit ?? 5);
}

/**
 * Fuses several independently phrased contextual retrieval lists by rank.
 * Query scores are deliberately not added directly: each query has its own
 * BM25 scale, while reciprocal rank gives the same bounded unit to every
 * verified query variant.
 */
export function retrieveMultiQueryRrfCandidates(
  documents: readonly RetrievalDocument[],
  queries: readonly string[],
  options: MultiQueryRrfOptions = {},
): ContextualBm25Candidate[] {
  const uniqueQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
  if (!uniqueQueries.length) return [];
  const rrfK = options.rrfK ?? 60;
  const merged = new Map<string, ContextualBm25Candidate & { rrfScore: number; queryHits: number }>();
  for (const [queryIndex, query] of uniqueQueries.entries()) {
    const ranked = retrieveContextualBm25Candidates(documents, query, { ...options, limit: documents.length });
    const queryWeight = options.queryWeights?.[queryIndex] ?? 1;
    ranked.forEach((candidate, index) => {
      const rankContribution = queryWeight / (rrfK + index + 1);
      const existing = merged.get(candidate.document.id);
      if (!existing) {
        merged.set(candidate.document.id, { ...candidate, fusedScore: rankContribution, rrfScore: rankContribution, queryHits: 1 });
        return;
      }
      const strongerChunk = candidate.bm25Score > existing.bm25Score ? candidate : existing;
      merged.set(candidate.document.id, {
        ...strongerChunk,
        lexicalScore: Math.max(existing.lexicalScore, candidate.lexicalScore),
        bm25Score: Math.max(existing.bm25Score, candidate.bm25Score),
        fusedScore: existing.rrfScore + rankContribution,
        rrfScore: existing.rrfScore + rankContribution,
        queryHits: existing.queryHits + 1,
        matchedKeywords: [...new Set([...existing.matchedKeywords, ...candidate.matchedKeywords])],
        matchedTerms: [...new Set([...existing.matchedTerms, ...candidate.matchedTerms])],
      });
    });
  }
  return [...merged.values()]
    .sort((left, right) => right.rrfScore - left.rrfScore
      || right.queryHits - left.queryHits
      || Number(right.document.id === options.defaultDocumentId) - Number(left.document.id === options.defaultDocumentId)
      || right.document.coverage - left.document.coverage)
    .slice(0, options.limit ?? 5);
}

/**
 * Prevents a semantically similar child article from replacing its parent
 * unless the query explicitly contains that child's operational terms.
 */
export function applyKnowledgeHierarchyGuard(candidates: readonly RetrievalCandidate[], query: string): RetrievalGuardResult[] {
  const guarded = candidates.map((candidate) => {
    const parentId = parentByChild[candidate.document.id];
    if (!parentId) return { ...candidate };
    const parent = candidates.find((item) => item.document.id === parentId);
    if (!parent || candidate.matchedKeywords.length > 0) return { ...candidate };
    return { ...candidate, fusedScore: candidate.fusedScore - 1.5, guardReason: `子知识 ${candidate.document.id} 缺少明确关键词，保留父知识 ${parentId}` };
  });
  return guarded.sort((left, right) => right.fusedScore - left.fusedScore || right.document.coverage - left.document.coverage);
}

/**
 * Reranks a parent/child knowledge family with explicit business-action evidence.
 * Vector similarity may recall a child, but it cannot promote that child unless
 * the current user turn names the child's operation. When no child operation is
 * present, the default parent remains the conservative answer source.
 */
export function applyActionAwareRerank(
  candidates: readonly RetrievalCandidate[],
  query: string,
  defaultDocumentId?: string,
): RetrievalGuardResult[] {
  const text = normalize(query);
  const matchedChildIds = new Set(Object.entries(actionByChild)
    .filter(([, rule]) => rule.terms.test(text))
    .map(([id]) => id));
  const reranked = candidates.map((candidate) => {
    const childRule = actionByChild[candidate.document.id];
    if (childRule) {
      const matched = matchedChildIds.has(candidate.document.id);
      return {
        ...candidate,
        fusedScore: candidate.fusedScore + (matched ? 3 : -3),
        actionMatched: matched,
        actionReason: matched
          ? `当前问题明确包含“${childRule.label}”动作，允许子知识 ${candidate.document.id} 参与竞争`
          : `当前问题未包含“${childRule.label}”动作，抑制子知识 ${candidate.document.id}`,
      };
    }
    const isParent = Object.values(parentByChild).includes(candidate.document.id);
    const hasMatchedChild = [...matchedChildIds].some((childId) => parentByChild[childId] === candidate.document.id);
    if (!isParent) return { ...candidate };
    return {
      ...candidate,
      fusedScore: candidate.fusedScore + (hasMatchedChild ? 0 : candidate.document.id === defaultDocumentId ? 2 : 1),
      actionMatched: false,
      actionReason: hasMatchedChild ? "检测到明确子流程动作，父知识不额外加分" : "未检测到明确子流程动作，保留父知识作为稳健来源",
    };
  });
  return reranked.sort((left, right) => right.fusedScore - left.fusedScore || right.lexicalScore - left.lexicalScore || right.document.coverage - left.document.coverage);
}

/**
 * V1 business-relevance ranking. This is intentionally a small, local
 * policy layer on top of lexical candidates: explicit child actions may break
 * a close tie, while an unqualified query keeps the governed parent ahead of
 * semantically adjacent children. Coverage is only a deterministic tie-break;
 * it cannot rescue a candidate with no lexical evidence.
 */
export function rankBusinessRelevantCandidates(
  candidates: readonly RetrievalCandidate[],
  query: string,
  defaultDocumentId?: string,
  options: { businessAction?: string } = {},
): RetrievalGuardResult[] {
  const text = normalize(query);
  const matchedChildIds = new Set(Object.entries(actionByChild)
    .filter(([, rule]) => rule.terms.test(text))
    .map(([id]) => id));
  return candidates.map((candidate) => {
    const childRule = actionByChild[candidate.document.id];
    const isParent = Object.values(parentByChild).includes(candidate.document.id);
    const metadata = deriveKnowledgeBusinessMetadata(candidate.document);
    const hasEvidence = candidate.lexicalScore > 0 || candidate.vectorScore > 0;
    let businessScore = 0;
    let actionReason: string | undefined;
    if (childRule) {
      const matched = matchedChildIds.has(candidate.document.id);
      businessScore += matched ? 0.75 : -0.75;
      actionReason = matched ? `V1业务动作匹配：${childRule.label}` : `V1未出现子流程动作：抑制${childRule.label}`;
    } else if (isParent) {
      const hasMatchedChild = [...matchedChildIds].some((childId) => parentByChild[childId] === candidate.document.id);
      businessScore += hasMatchedChild ? 0 : 0.2;
      actionReason = hasMatchedChild ? "V1检测到子流程动作，父知识不额外加分" : "V1无明确子流程动作，保留父知识先验";
    }
    // The router's selected child is already an audited sub-intent. Preserve
    // that preference unless another candidate has materially stronger lexical
    // evidence; this prevents a generic parent prior from undoing routing.
    if (candidate.document.id === defaultDocumentId) businessScore += 0.8;
    if (options.businessAction) {
      const action = options.businessAction;
      const actionSlot = action === "address_change" ? "fulfilment_target"
        : action === "invoice" ? "invoice_fact"
          : action === "refund" ? "payment_fact"
            : action === "after_sales" ? "business_action" : null;
      if (actionSlot && metadata.evidenceSlots.includes(actionSlot)) {
        businessScore += 0.25;
        actionReason = `${actionReason ? `${actionReason}；` : ""}元数据证据槽位匹配：${actionSlot}`;
      }
    }
    if (hasEvidence) businessScore += Math.min(0.1, Math.max(0, candidate.document.coverage) * 0.1);
    return {
      ...candidate,
      fusedScore: candidate.lexicalScore + businessScore,
      actionReason,
      actionMatched: Boolean(childRule && matchedChildIds.has(candidate.document.id)),
    };
  }).sort((left, right) => right.fusedScore - left.fusedScore
    || right.lexicalScore - left.lexicalScore
    || right.document.coverage - left.document.coverage
    || Number(right.document.id === defaultDocumentId) - Number(left.document.id === defaultDocumentId));
}

/**
 * Phase 1 wide recall. Scope filtering happens before BM25 candidate
 * generation, while the final limit is deliberately wider than the old Top5.
 */
export function retrieveScopedBm25Candidates(
  documents: readonly RetrievalDocument[],
  query: string,
  scope: RetrievalScope,
  options: Bm25RetrievalOptions = {},
) {
  const scoped = documents.filter((document) => scopeAllowsKnowledge(scope, document));
  // Keep the complete scoped ranking long enough to inspect the preferred
  // parent. A zero-score preferred document is not evidence by itself, so it
  // is only retained when another scoped document has positive BM25 evidence;
  // a fully empty query still returns [] and follows Safe Fallback.
  const ranked = retrieveBm25Candidates(scoped, query, { ...options, category: undefined, limit: scoped.length });
  const positive = ranked.filter((candidate) => candidate.bm25Score > 0);
  if (!positive.length) return [];
  const preferred = ranked.find((candidate) => scope.preferredKnowledgeIds.includes(candidate.document.id) && candidate.bm25Score <= 0);
  const withAuditablePrior = preferred
    ? [...positive, { ...preferred, filterReasons: ["scope-preferred-prior-no-direct-bm25-match"] }]
    : positive;
  return withAuditablePrior.slice(0, options.limit ?? 30);
}

/** Dense recall is ranked independently so its cosine score never shares a
 * numeric score space with BM25. */
export function retrieveScopedDenseCandidates(
  documents: readonly RetrievalDocument[],
  vectorScores: ReadonlyMap<string, number>,
  scope: RetrievalScope,
  limit = 30,
) {
  return documents.filter((document) => scopeAllowsKnowledge(scope, document) && vectorScores.has(document.id))
    .map((document) => ({
      document,
      lexicalScore: 0,
      vectorScore: Math.max(0, Math.min(1, vectorScores.get(document.id) ?? 0)),
      fusedScore: Math.max(0, Math.min(1, vectorScores.get(document.id) ?? 0)),
      matchedKeywords: [],
      filterReasons: [],
    }))
    .sort((left, right) => right.vectorScore - left.vectorScore || right.document.coverage - left.document.coverage)
    .slice(0, limit);
}

export function businessRuleBoostForDocument(input: {
  documentId: string;
  query: string;
  preferredKnowledgeIds?: readonly string[];
  maxBoost?: number;
}) {
  // RRF scores are typically around 0.01–0.03. Keep the rule contribution in
  // that same order of magnitude so a business prior can break close ties but
  // cannot rescue an otherwise irrelevant candidate by itself.
  const maxBoost = Math.max(0, Math.min(0.05, input.maxBoost ?? 0.01));
  const text = normalize(input.query);
  const childRule = actionByChild[input.documentId];
  if (childRule) {
    const matched = childRule.terms.test(text);
    return {
      boost: matched ? maxBoost : -maxBoost,
      matched,
      reason: matched ? `明确业务动作：${childRule.label}` : `未出现子流程动作：抑制${childRule.label}`,
    };
  }
  if (input.preferredKnowledgeIds?.includes(input.documentId)) return { boost: maxBoost * (2 / 3), matched: false, reason: "路由偏好知识保留有限先验加分" };
  const isParent = Object.values(parentByChild).includes(input.documentId);
  return isParent ? { boost: maxBoost / 3, matched: false, reason: "父知识保留稳健性加分" } : { boost: 0, matched: false, reason: null };
}

export function parentIdForDocument(documentId: string) {
  return parentByChild[documentId] ?? null;
}
