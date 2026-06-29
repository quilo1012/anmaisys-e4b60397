import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const MAX_BODY_BYTES = 4 * 1024;
const REQ_TIMEOUT_MS = 15_000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const deleteUserSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const timeoutCtl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtl.abort(), REQ_TIMEOUT_MS);

  try {
    const cl = Number(req.headers.get("content-length") ?? "0");
    if (cl && cl > MAX_BODY_BYTES) {
      return jsonResponse({ error: "Payload too large" }, 413);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsErr } = await supabaseAdmin.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const callerId = claimsData.claims.sub as string;

    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: callerId, _role: "admin" });
    const { data: isManager } = await supabaseAdmin.rpc("has_role", { _user_id: callerId, _role: "manager" });
    if (!isAdmin && !isManager) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: "Payload too large" }, 413);
    }
    let parsedBody: unknown;
    try { parsedBody = JSON.parse(raw); } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }
    const { userId } = deleteUserSchema.parse(parsedBody);

    if (userId === callerId) {
      return jsonResponse({ error: "You cannot delete your own account" }, 400);
    }

    const { data: targetRole } = await supabaseAdmin.rpc("get_user_role", { _user_id: userId });
    if (isManager && !isAdmin && ["manager", "admin", "maintenance_manager"].includes(targetRole ?? "")) {
      return jsonResponse({ error: "Managers cannot delete Manager, Maintenance Manager or Admin users" }, 403);
    }

    await supabaseAdmin.from("work_orders").update({ operator_id: null }).eq("operator_id", userId);
    await supabaseAdmin.from("work_orders").update({ engineer_id: null }).eq("engineer_id", userId);
    await supabaseAdmin.from("work_orders").update({ closed_by: null }).eq("closed_by", userId);
    await supabaseAdmin.from("parts_used").delete().eq("engineer_id", userId);
    await supabaseAdmin.from("engineers").delete().eq("id", userId);

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("delete-user auth error:", deleteError);
      return jsonResponse({ error: "Could not delete user" }, 400);
    }

    return jsonResponse({ success: true }, 200);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return jsonResponse({ error: error.errors[0]?.message ?? "Invalid input" }, 400);
    }
    console.error("delete-user error:", error);
    return jsonResponse({ error: "Internal error" }, 500);
  } finally {
    clearTimeout(timeoutId);
  }
});
