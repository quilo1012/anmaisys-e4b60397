import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsError } = await supabaseAdmin.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) throw new Error("Not authenticated");

    const callerId = claimsData.claims.sub as string;
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: callerId, _role: "admin" });
    const { data: isManager } = await supabaseAdmin.rpc("has_role", { _user_id: callerId, _role: "manager" });
    const { data: isMaintMgr } = await supabaseAdmin.rpc("has_role", { _user_id: callerId, _role: "maintenance_manager" });

    if (!isAdmin && !isManager && !isMaintMgr) {
      const role = (await supabaseAdmin.rpc("get_user_role", { _user_id: callerId })).data ?? "none";
      await supabaseAdmin.from("audit_logs").insert({
        user_id: callerId,
        user_name: (claimsData.claims as { email?: string }).email ?? "Unknown",
        action: "list_engineers_denied",
        entity_type: "edge_function",
        entity_id: "list-engineers",
        details: { role, reason: "insufficient_role" },
      });
      throw new Error("Only managers and admins can view engineers");
    }

    const { data, error } = await supabaseAdmin
      .from("engineers_safe")
      .select("id, name, is_active, created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return new Response(JSON.stringify(data ?? []), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});