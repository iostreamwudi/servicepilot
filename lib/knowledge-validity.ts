export type KnowledgeValidity = "current" | "expiring" | "not_started" | "expired" | "unscheduled";

const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function knowledgeValidity(validFrom?: string | null, validUntil?: string | null, now = Date.now()): KnowledgeValidity {
  const from = validFrom ? new Date(validFrom).getTime() : null;
  const until = validUntil ? new Date(validUntil).getTime() : null;
  if (from !== null && Number.isFinite(from) && from > now) return "not_started";
  if (until !== null && Number.isFinite(until) && until <= now) return "expired";
  if (until !== null && Number.isFinite(until) && until - now <= EXPIRING_WINDOW_MS) return "expiring";
  if (from === null && until === null) return "unscheduled";
  return "current";
}

export const knowledgeValidityLabel: Record<KnowledgeValidity, string> = {
  current: "当前有效",
  expiring: "即将到期",
  not_started: "尚未生效",
  expired: "已过期",
  unscheduled: "未设有效期",
};

export type KnowledgeSourceFreshness = "fresh" | "aging" | "stale" | "failed" | "unavailable";

const SOURCE_FRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const SOURCE_AGING_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export function knowledgeSourceFreshness(fetchedAt?: string | null, syncStatus?: string | null, now = Date.now()): KnowledgeSourceFreshness {
  if (syncStatus === "failed") return "failed";
  if (syncStatus === "stale") return "stale";
  if (!fetchedAt) return "unavailable";
  const fetched = new Date(fetchedAt).getTime();
  if (!Number.isFinite(fetched)) return "unavailable";
  const age = Math.max(0, now - fetched);
  if (age <= SOURCE_FRESH_WINDOW_MS) return "fresh";
  if (age <= SOURCE_AGING_WINDOW_MS) return "aging";
  return "stale";
}

export const knowledgeSourceFreshnessLabel: Record<KnowledgeSourceFreshness, string> = {
  fresh: "来源新鲜",
  aging: "来源需复核",
  stale: "来源已陈旧",
  failed: "来源同步失败",
  unavailable: "无来源快照",
};
