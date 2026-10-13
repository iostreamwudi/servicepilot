export type AgenticStage = "retrieval" | "corrective-retrieval" | "query-rewrite" | "tool-decision" | "tool" | "evidence" | "generation" | "review" | "complete" | "fallback";

export type AgenticBudgetSnapshot = {
  maxSteps: number;
  maxToolCalls: number;
  maxModelCalls: number;
  timeoutMs: number;
  steps: AgenticStage[];
  toolCalls: number;
  modelCalls: number;
  exhaustedReason: "deadline" | "step_limit" | "tool_limit" | "model_limit" | null;
};

/**
 * Runtime governor for Step 9.8. It grants capabilities before side effects,
 * never retries a denied operation, and exposes a compact audit snapshot.
 */
export class BoundedAgenticRun {
  readonly #startedAt: number;
  readonly #maxSteps: number;
  readonly #maxToolCalls: number;
  readonly #maxModelCalls: number;
  readonly #timeoutMs: number;
  readonly #steps: AgenticStage[] = [];
  #toolCalls = 0;
  #modelCalls = 0;
  #exhaustedReason: AgenticBudgetSnapshot["exhaustedReason"] = null;

  constructor(input: { startedAt?: number; maxSteps?: number; maxToolCalls?: number; maxModelCalls?: number; timeoutMs?: number } = {}) {
    this.#startedAt = input.startedAt ?? Date.now();
    this.#maxSteps = input.maxSteps ?? 7;
    this.#maxToolCalls = input.maxToolCalls ?? 1;
    this.#maxModelCalls = input.maxModelCalls ?? 1;
    this.#timeoutMs = input.timeoutMs ?? 25_000;
  }

  enter(stage: AgenticStage, capability?: "tool" | "model", now = Date.now()) {
    if (this.#exhaustedReason) return false;
    if (now - this.#startedAt >= this.#timeoutMs) return this.#deny("deadline");
    if (this.#steps.length >= this.#maxSteps) return this.#deny("step_limit");
    if (capability === "tool" && this.#toolCalls >= this.#maxToolCalls) return this.#deny("tool_limit");
    if (capability === "model" && this.#modelCalls >= this.#maxModelCalls) return this.#deny("model_limit");
    this.#steps.push(stage);
    if (capability === "tool") this.#toolCalls += 1;
    if (capability === "model") this.#modelCalls += 1;
    return true;
  }

  withinDeadline(now = Date.now()) {
    if (this.#exhaustedReason) return false;
    if (now - this.#startedAt < this.#timeoutMs) return true;
    return this.#deny("deadline");
  }

  snapshot(): AgenticBudgetSnapshot {
    return {
      maxSteps: this.#maxSteps,
      maxToolCalls: this.#maxToolCalls,
      maxModelCalls: this.#maxModelCalls,
      timeoutMs: this.#timeoutMs,
      steps: [...this.#steps],
      toolCalls: this.#toolCalls,
      modelCalls: this.#modelCalls,
      exhaustedReason: this.#exhaustedReason,
    };
  }

  #deny(reason: NonNullable<AgenticBudgetSnapshot["exhaustedReason"]>) {
    this.#exhaustedReason = reason;
    return false;
  }
}
