import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listWorkOrdersTool from "./tools/list-work-orders";
import getWorkOrderTool from "./tools/get-work-order";
import listMachinesTool from "./tools/list-machines";
import listLinesTool from "./tools/list-lines";
import createWorkOrderTool from "./tools/create-work-order";

// The OAuth issuer must be the direct Supabase host, built from the project ref
// (which Vite inlines at build time). See ai-sdk / app-mcp-server-authoring notes.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "an-maintenance-mcp",
  title: "AN Maintenance MCP",
  version: "0.1.0",
  instructions:
    "Tools for the AN Maintenance system. Use `list_work_orders` / `get_work_order` to inspect maintenance activity, `list_machines` / `list_lines` to browse assets, and `create_work_order` to log a new maintenance request as the signed-in user. All calls run under the user's row-level security.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listWorkOrdersTool, getWorkOrderTool, listMachinesTool, listLinesTool, createWorkOrderTool],
});
