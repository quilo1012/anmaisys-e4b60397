import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_work_orders",
  title: "List work orders",
  description:
    "List recent maintenance work orders visible to the signed-in user. Optionally filter by status or priority.",
  inputSchema: {
    status: z
      .enum(["OPEN", "IN_PROGRESS", "PAUSED", "FINISHED", "CANCELLED", "PENDING", "COMPLETED"])
      .optional()
      .describe("Filter by work order status."),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Filter by priority."),
    limit: z.number().int().min(1).max(100).default(25).describe("Max rows to return (1–100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, priority, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let query = supabaseForUser(ctx)
      .from("work_orders")
      .select(
        "id, wo_number, description, status, priority, machine, requester_name, engineer_name, created_at, started_at, finished_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status as any);
    if (priority) query = query.eq("priority", priority);
    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { rows: data ?? [] },
    };
  },
});
