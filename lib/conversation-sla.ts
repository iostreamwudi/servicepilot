export type ConversationRisk = "low" | "medium" | "high";

export const conversationSlaPolicy = {
  high: { priority: "P1", minutes: 60, id: "frontline-p1-first-response-60m" },
  medium: { priority: "P2", minutes: 240, id: "frontline-p2-first-response-4h" },
  low: { priority: "P3", minutes: 480, id: "frontline-p3-first-response-8h" },
} as const;

export function slaPolicyForRisk(risk: ConversationRisk) {
  return conversationSlaPolicy[risk] ?? conversationSlaPolicy.medium;
}
