import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { agentConversationStates, conversations, messages } from "../../../db/schema";

const ORG_ID = "org-qingyu";

function authenticatedEmail(request: Request) {
  const host = new URL(request.url).hostname;
  return request.headers.get("oai-authenticated-user-email") ?? (host === "localhost" || host === "127.0.0.1" ? "local-demo@servicepilot.local" : null);
}

function statusLabel(status: string) {
  return status === "needs_human" ? "待接管" : status === "human_active" || status === "ai_active" ? "处理中" : status === "ticketed" ? "等待内部" : status === "resolved" ? "已解决" : "处理中";
}

function riskLabel(risk: string) {
  return risk === "high" ? "高" : risk === "medium" ? "中" : "低";
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export async function GET(request: Request) {
  if (!authenticatedEmail(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const db = getDb();
  const rows = await db.select().from(conversations).where(eq(conversations.organizationId, ORG_ID)).orderBy(desc(conversations.updatedAt)).limit(100);
  if (!rows.length) return Response.json({ conversations: [] });
  const ids = rows.map((row) => row.id);
  const [turns, states] = await Promise.all([
    db.select().from(messages).where(inArray(messages.conversationId, ids)).orderBy(messages.createdAt),
    db.select().from(agentConversationStates).where(inArray(agentConversationStates.conversationId, ids)),
  ]);
  const turnMap = new Map<string, typeof turns>();
  for (const turn of turns) turnMap.set(turn.conversationId, [...(turnMap.get(turn.conversationId) ?? []), turn]);
  const stateMap = new Map(states.map((state) => [state.conversationId, state]));
  return Response.json({ conversations: rows.map((row) => {
    const rowTurns = turnMap.get(row.id) ?? [];
    const latestCustomer = [...rowTurns].reverse().find((turn) => turn.senderType === "customer");
    const latestAi = [...rowTurns].reverse().find((turn) => turn.senderType === "ai");
    const citations = parseJson<Array<{ id?: string; title?: string; version?: string }>>(latestAi?.citationsJson, []);
    const trace = parseJson<Array<Record<string, unknown>>>(latestAi?.toolTraceJson, []);
    const state = stateMap.get(row.id);
    const order = latestAi ? trace.find((item) => typeof item.label === "string" && /OR-\d{6}/.test(item.label)) : null;
    return {
      id: row.id,
      name: row.customerName,
      topic: row.topic,
      channel: row.channel,
      status: statusLabel(row.status),
      risk: riskLabel(row.risk),
      time: row.updatedAt,
      sla: row.status === "needs_human" ? "待响应" : row.status === "resolved" ? "已完成" : "处理中",
      sentiment: row.sentiment === "dissatisfied" ? "强烈不满" : row.sentiment === "anxious" ? "焦虑" : "中性",
      handoff: row.status === "needs_human" ? "Agent 判断需要人工确认，已将完整上下文交给客服" : "当前会话由 Agent 自动处理",
      customerMessage: latestCustomer?.content ?? "等待用户输入",
      aiReply: latestAi?.content ?? "Agent 尚未生成回复",
      summary: state?.summary ?? latestCustomer?.content ?? "暂无会话摘要",
      draft: row.status === "needs_human" ? latestAi?.content ?? "" : "",
      order: typeof order?.label === "string" ? order.label.match(/OR-\d{6}/)?.[0] ?? "无关联订单" : "无关联订单",
      member: "未关联会员信息",
      orderHistory: "等待业务系统接入",
      facts: citations.map((citation) => ({ label: "回答依据", value: `${citation.title ?? citation.id ?? "知识"} ${citation.version ?? ""}`.trim(), source: "Agent 引用" })),
      suggestedAction: row.status === "needs_human" ? "核验用户问题" : "查看会话记录",
      persisted: true,
    };
  }) });
}
