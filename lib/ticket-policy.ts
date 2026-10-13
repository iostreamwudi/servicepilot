export const ticketStates = ["unassigned", "in_progress", "waiting_customer", "resolved", "closed"] as const;
export const ticketPriorities = ["P1", "P2", "P3"] as const;
export type TicketState = typeof ticketStates[number];
export type TicketPriority = typeof ticketPriorities[number];
export type TicketSlaState = "on_track" | "due_soon" | "overdue" | "completed" | "unknown";

const transitionMap: Record<TicketState, readonly TicketState[]> = {
  unassigned: ["in_progress"],
  in_progress: ["waiting_customer", "resolved"],
  waiting_customer: ["in_progress", "resolved"],
  resolved: ["closed", "in_progress"],
  closed: ["in_progress"],
};

export function canTransition(from: TicketState, to: TicketState) {
  return from === to || transitionMap[from].includes(to);
}

export function nextTicketStates(state: TicketState) {
  return transitionMap[state];
}

export function slaMinutesFor(priority: TicketPriority) {
  return priority === "P1" ? 60 : priority === "P2" ? 240 : 1440;
}

export function slaDueAt(priority: TicketPriority, startedAt = Date.now()) {
  return new Date(startedAt + slaMinutesFor(priority) * 60_000).toISOString();
}

export function ticketSlaPolicy(priority: TicketPriority) {
  return {
    id: `ticket-priority-${priority.toLowerCase()}-v1`,
    label: `${priority} 优先级默认 SLA v1`,
    minutes: slaMinutesFor(priority),
    source: "policy-derived" as const,
  };
}

export function isTerminalState(state: TicketState) {
  return state === "resolved" || state === "closed";
}

export function slaStatus(dueAt: string | null | undefined, state: TicketState, now = Date.now()): TicketSlaState {
  const dueAtMs = dueAt ? new Date(dueAt).getTime() : Number.NaN;
  if (!Number.isFinite(dueAtMs)) return "unknown";
  if (isTerminalState(state)) return "completed" as const;
  const remainingMinutes = Math.ceil((dueAtMs - now) / 60_000);
  if (remainingMinutes < 0) return "overdue" as const;
  if (remainingMinutes <= 30) return "due_soon" as const;
  return "on_track" as const;
}
