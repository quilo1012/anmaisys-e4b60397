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
  name: "get_work_order",
  title: "Get work order",
  description: "Fetch a single work order by its UUID or numeric wo_number.",
  inputSchema: {
    id: z.string().optional().describe("Work order UUID."),
    wo_number: z.number().int().optional().describe("Numeric wo_number (e.g. 1234)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, wo_number }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    if (!id && !wo_number) {
      return { content: [{ type: "text", text: "Provide id or wo_number." }], isError: true };
    }
    let query = supabaseForUser(ctx).from("work_orders").select("*").limit(1);
    if (id) query = query.eq("id", id);
    else if (wo_number) query = query.eq("wo_number", wo_number);
    const { data, error } = await query.maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Not found" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { row: data },
    };
  },
});
