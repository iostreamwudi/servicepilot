export type KnowledgeConflict = { kind: "duplicate" | "conflict"; severity: "high" | "medium"; documentId: string; title: string; reason: string };

type Candidate = { id?: string; title: string; content: string; category: string };

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function timingClaims(value: string) {
  return value.match(/\d+\s*(?:-|至|到)\s*\d+\s*(?:个)?\s*(?:工作日|日|小时|天)/gu) ?? [];
}

export function detectKnowledgeConflicts(candidate: Candidate, existing: Candidate[]): KnowledgeConflict[] {
  const title = normalize(candidate.title);
  const content = normalize(candidate.content);
  const candidateTiming = new Set(timingClaims(candidate.content).map(normalize));
  return existing.flatMap((item) => {
    if (item.id && item.id === candidate.id) return [];
    if (item.category !== candidate.category) return [];
    const itemTitle = normalize(item.title);
    const itemContent = normalize(item.content);
    if (title && title === itemTitle || content && content === itemContent) return [{ kind: "duplicate", severity: "high", documentId: item.id ?? "", title: item.title, reason: "标题或正文与现有知识完全重复" }];
    const itemTiming = new Set(timingClaims(item.content).map(normalize));
    const timingDiffers = candidateTiming.size > 0 && itemTiming.size > 0 && [...candidateTiming].some((claim) => !itemTiming.has(claim));
    const sharedWords = ["退款", "到账", "工作日", "时效", "处理", "审核", "出库", "发票"].filter((word) => candidate.content.includes(word) && item.content.includes(word));
    return timingDiffers && sharedWords.length >= 2 ? [{ kind: "conflict", severity: "medium", documentId: item.id ?? "", title: item.title, reason: `时效表述可能不一致：${[...candidateTiming].join("、")} vs ${[...itemTiming].join("、")}` }] : [];
  });
}
