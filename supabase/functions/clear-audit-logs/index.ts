import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { data: roleData } = await userClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!roleData) throw new Error("Admin role required");

    const userName = user.email ?? "Unknown admin";

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { error: delError } = await adminClient
      .from("audit_logs")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delError) throw delError;

    // Re-insert one record so the action itself is audited.
    await adminClient.from("audit_logs").insert({
      user_id: user.id,
      user_name: userName,
      action: "audit_logs_cleared",
      entity_type: "system",
      details: { cleared_at: new Date().toISOString() },
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
