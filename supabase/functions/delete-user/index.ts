import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

const deleteUserSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
});

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

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller } } = await supabaseUser.auth.getUser();
    if (!caller) throw new Error("Not authenticated");

    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: caller.id, _role: "admin" });
    const { data: isManager } = await supabaseAdmin.rpc("has_role", { _user_id: caller.id, _role: "manager" });

    if (!isAdmin && !isManager) throw new Error("Only managers and admins can delete users");

    const body = deleteUserSchema.parse(await req.json());
    const { userId } = body;

    if (userId === caller.id) throw new Error("You cannot delete your own account");

    // Check target user's role — managers can only delete operators and engineers
    const { data: targetRole } = await supabaseAdmin.rpc("get_user_role", { _user_id: userId });
    if (isManager && !isAdmin && ["manager", "admin", "maintenance_manager"].includes(targetRole ?? "")) {
      throw new Error("Managers cannot delete Manager, Maintenance Manager or Admin users");
    }

    // Nullify FK references in work_orders and parts_used before deleting
    await supabaseAdmin.from("work_orders").update({ operator_id: null }).eq("operator_id", userId);
    await supabaseAdmin.from("work_orders").update({ engineer_id: null }).eq("engineer_id", userId);
    await supabaseAdmin.from("work_orders").update({ closed_by: null }).eq("closed_by", userId);
    await supabaseAdmin.from("parts_used").delete().eq("engineer_id", userId);
    await supabaseAdmin.from("engineers").delete().eq("id", userId);

    // Delete user from auth (cascades to profiles and user_roles via FK)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: error.errors[0].message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
