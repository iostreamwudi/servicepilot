import type { BusinessIntent, ConversationContext } from "./intent-router.ts";

export type RetrievalScope = {
  primaryCategory: BusinessIntent;
  allowedCategories: readonly string[];
  preferredKnowledgeIds: readonly string[];
  excludedKnowledgeIds: readonly string[];
  businessActions: readonly string[];
  metadataFilters: {
    organizationId: string;
    state: "active";
    effectiveFrom?: string;
    effectiveTo?: string;
    channel?: string;
    region?: string;
    version?: string;
    accessScope?: string;
  };
};

/**
 * Builds a retrieval prior, not a final answer decision. The current schema
 * stores the four business domains in `category`; repair/warranty/after-sales
 * remain governed actions inside the damage family until a future schema
 * migration adds separate categories.
 */
export function buildRetrievalScope(input: {
  organizationId: string;
  intent: BusinessIntent;
  preferredKnowledgeIds?: readonly string[];
  excludedKnowledgeIds?: readonly string[];
  businessActions?: readonly string[];
  conversationContext?: ConversationContext | null;
  channel?: string;
  region?: string;
  version?: string;
}): RetrievalScope {
  const actionSet = new Set([...(input.businessActions ?? [])]);
  if (input.intent === "damage" && input.conversationContext?.pendingQuestion) {
    const text = input.conversationContext.pendingQuestion;
    if (/寄修|返修|维修|修理/.test(text)) actionSet.add("repair");
    if (/保修|质保|联保/.test(text)) actionSet.add("warranty");
    if (/三包|包修|包换|包退/.test(text)) actionSet.add("guarantee");
  }

  return {
    primaryCategory: input.intent,
    // These aliases document the intended scope without leaking them into the
    // current DB enum. Candidate filtering maps them back to the domain below.
    allowedCategories: input.intent === "damage"
      ? ["damage", "repair", "warranty", "after_sales"]
      : input.intent === "refund"
        ? ["refund", "return", "payment", "after_sales"]
        : input.intent === "address"
          ? ["address", "logistics", "after_sales"]
          : ["invoice", "billing", "after_sales"],
    preferredKnowledgeIds: [...new Set(input.preferredKnowledgeIds ?? [])],
    excludedKnowledgeIds: [...new Set(input.excludedKnowledgeIds ?? [])],
    businessActions: [...actionSet],
    metadataFilters: {
      organizationId: input.organizationId,
      state: "active",
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.region ? { region: input.region } : {}),
      ...(input.version ? { version: input.version } : {}),
    },
  };
}

export function scopeAllowsCategory(scope: RetrievalScope, category: string) {
  if (category === scope.primaryCategory) return true;
  // The existing knowledge schema has no standalone repair/warranty table;
  // those aliases are intentionally represented by the damage domain.
  if (scope.primaryCategory === "damage" && ["repair", "warranty", "after_sales"].includes(category)) return true;
  return scope.allowedCategories.includes(category);
}

export function scopeAllowsKnowledge(scope: RetrievalScope, document: {
  id: string;
  category: string;
  organizationId?: string;
  state: string;
  validFrom?: string | null;
  validUntil?: string | null;
  version?: string;
}) {
  if (document.organizationId && document.organizationId !== scope.metadataFilters.organizationId) return false;
  if (document.state !== scope.metadataFilters.state) return false;
  if (!scopeAllowsCategory(scope, document.category)) return false;
  if (scope.excludedKnowledgeIds.includes(document.id)) return false;
  if (scope.metadataFilters.version && document.version !== scope.metadataFilters.version) return false;
  const now = Date.now();
  if (document.validFrom && Number.isFinite(new Date(document.validFrom).getTime()) && new Date(document.validFrom).getTime() > now) return false;
  if (document.validUntil && Number.isFinite(new Date(document.validUntil).getTime()) && new Date(document.validUntil).getTime() < now) return false;
  return true;
}
