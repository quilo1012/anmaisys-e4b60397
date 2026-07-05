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
  name: "create_work_order",
  title: "Create work order",
  description:
    "Create a new maintenance work order as the signed-in user. Requires a description and requester name.",
  inputSchema: {
    description: z.string().trim().min(3).describe("What is broken or needs maintenance."),
    requester_name: z.string().trim().min(1).describe("Name of the person requesting."),
    priority: z
      .enum(["low", "medium", "high", "critical"])
      .default("medium")
      .describe("Priority; defaults to medium."),
    machine: z.string().trim().optional().describe("Machine name (free text)."),
    line_id: z.string().optional().describe("Production line UUID, if applicable."),
    notes: z.string().optional().describe("Extra context or notes."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("work_orders")
      .insert({
        description: input.description,
        requester_name: input.requester_name,
        priority: input.priority,
        machine: input.machine ?? null,
        line_id: input.line_id ?? null,
        notes: input.notes ?? null,
        operator_id: ctx.getUserId(),
      })
      .select("id, wo_number, status, priority, created_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Created WO #${data.wo_number}` }],
      structuredContent: { row: data },
    };
  },
});
