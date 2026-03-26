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

    // Verify user is admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { data: roleData } = await userClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!roleData) throw new Error("Admin role required");

    // Use service role to delete everything
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Delete in dependency order
    await adminClient.from("wo_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await adminClient.from("wo_photos").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await adminClient.from("parts_used").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await adminClient.from("work_orders").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await adminClient.from("engineer_scores").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
