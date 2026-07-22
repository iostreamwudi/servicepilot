import model from "../data/intent-classifier-model.json" with { type: "json" };
import type { BusinessIntent, ConversationTurn } from "./intent-router";

type ClassifierLabel = BusinessIntent | "unsupported";
const typedModel = model as {
  classes: ClassifierLabel[];
  vocabulary: Record<string, number>;
  idf: number[];
  coefficients: number[][];
  intercepts: number[];
  usesHistory: boolean;
};

function clean(value: string) {
  return value.replace(/\s+/g, "").replace(/\[\s*USERID[^\]]*\]/gi, "[账号]")
    .replace(/1[3-9]\d{9}/g, "[电话]").replace(/\d{17}[\dXx]/g, "[身份证号]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[邮箱]").replace(/京东/g, "平台").toLowerCase();
}

function formatInput(query: string, history: ConversationTurn[]) {
  const context = typedModel.usesHistory ? history.slice(-4).map((turn) => `${turn.role === "user" ? "用户" : "客服"}:${clean(turn.content)}`).join("；") : "";
  return `当前:${clean(query)}；上下文:${context}`;
}

export function classifyIntentVector(query: string, history: ConversationTurn[]) {
  const text = formatInput(query, history);
  const counts = new Map<number, number>();
  for (let size = 2; size <= 4; size += 1) for (let index = 0; index <= text.length - size; index += 1) {
    const featureIndex = typedModel.vocabulary[text.slice(index, index + size)];
    if (featureIndex !== undefined) counts.set(featureIndex, (counts.get(featureIndex) ?? 0) + 1);
  }
  const values = [...counts].map(([index, count]) => [index, (1 + Math.log(count)) * typedModel.idf[index]] as const);
  const norm = Math.sqrt(values.reduce((sum, [, value]) => sum + value * value, 0)) || 1;
  const logits = typedModel.classes.map((_, classIndex) => typedModel.intercepts[classIndex] + values.reduce((sum, [featureIndex, value]) => sum + typedModel.coefficients[classIndex][featureIndex] * value / norm, 0));
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const denominator = exponentials.reduce((sum, value) => sum + value, 0);
  const candidates = typedModel.classes.map((label, index) => ({ label, probability: exponentials[index] / denominator })).sort((left, right) => right.probability - left.probability);
  return { candidates, top: candidates[0] };
}
