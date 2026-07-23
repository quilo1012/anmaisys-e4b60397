import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const MAX_BODY_BYTES = 8 * 1024;
const REQ_TIMEOUT_MS = 15_000;

const createPendingPinHash = async () => {
  return "temp";
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const updateUserSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["admin", "manager", "supervisor", "quality_supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer", "warehouse"]).optional(),
  shift: z.string().max(50).optional(),
  active: z.boolean().optional(),
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.union([z.literal(""), z.string().email("Invalid email format").max(255)]).optional()
  ).transform((v) => (v === "" ? undefined : v)),
  password: z.preprocess(
    (v) => (typeof v === "string" ? v : v),
    z.union([z.literal(""), z.string().min(6, "Password must be at least 6 characters").max(128)]).optional()
  ).transform((v) => (v === "" ? undefined : v)),
  labor_rate: z.number().min(0).optional(),
});

const getReadableErrorMessage = (error: unknown) => {
  const anyErr = error as any;
  let message =
    (typeof anyErr?.message === "string" && anyErr.message) ||
    (typeof anyErr?.error_description === "string" && anyErr.error_description) ||
    (typeof anyErr?.error === "string" && anyErr.error) ||
    (typeof anyErr?.hint === "string" && anyErr.hint) ||
    (typeof anyErr?.details === "string" && anyErr.details) ||
    (typeof error === "string" ? error : "") ||
    "Unknown error";

  // Some Supabase Auth errors surface as JSON-stringified payloads or "{}".
  if (message === "{}" || message === "") {
    try { message = JSON.stringify(anyErr) || "Unknown error"; } catch { /* noop */ }
  }

  const lower = message.toLowerCase();

  if (lower.includes("users_email_partial_key") || lower.includes("duplicate key") || lower.includes("already been registered") || lower.includes("already registered")) {
    return "This email is already in use by another account. Choose a different email.";
  }
  if (
    lower.includes("known to be weak and easy to guess") ||
    lower.includes("pwned") ||
    lower.includes("compromised") ||
    lower.includes("leaked")
  ) {
    return "This password has appeared in a known data breach and was rejected. Please choose a different, stronger password (e.g. mix of letters, numbers, and symbols not used elsewhere).";
  }
  if (lower.includes("weak password") || lower.includes("should be at least")) {
    return message;
  }

  return message;
};

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
    const { data: claimsData, error: claimsError } = await supabaseAdmin.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
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
    const body = updateUserSchema.parse(parsedBody);
    const { userId, name, role, shift, active, email, password, labor_rate } = body;

    const { data: targetRole } = await supabaseAdmin.rpc("get_user_role", { _user_id: userId });

    if (isManager && !isAdmin && (targetRole === "admin" || targetRole === "manager" || targetRole === "supervisor" || targetRole === "maintenance_manager" || targetRole === "planner")) {
      throw new Error("Managers cannot modify Admin, Manager, Supervisor, Maintenance Manager or Planner users");
    }

    if (isManager && !isAdmin && role && role !== "engineer" && role !== "co_engineer" && role !== "operator") {
      throw new Error("Managers can only assign Engineer, Co-Engineer or Operator roles");
    }

    if ((role === "admin" || role === "manager" || role === "supervisor" || role === "quality_supervisor" || role === "maintenance_manager" || role === "planner" || role === "viewer") && !isAdmin) throw new Error("Only admins can assign Admin, Manager, Supervisor, QC Supervisor, Maintenance Manager, Planner or Viewer roles");
    if (labor_rate !== undefined && !isAdmin) {
      throw new Error("Only admins can modify labor rates");
    }

    if (email) {
      const { error: emailError } = await supabaseAdmin.auth.admin.updateUserById(userId, { email });
      if (emailError) throw new Error(getReadableErrorMessage(emailError));
      await supabaseAdmin.from("profiles").update({ email }).eq("id", userId);
    }

    if (password) {
      const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
      if (pwError) throw new Error(getReadableErrorMessage(pwError));
    }

    const profileUpdate: Record<string, unknown> = {};
    if (name !== undefined) profileUpdate.name = name;
    if (shift !== undefined) profileUpdate.shift = shift;
    if (active !== undefined) profileUpdate.active = active;
    if (labor_rate !== undefined) profileUpdate.labor_rate = labor_rate;

    if (Object.keys(profileUpdate).length > 0) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update(profileUpdate)
        .eq("id", userId);
      if (profileError) throw profileError;
    }

    // If user was deactivated, revoke ALL existing sessions/refresh tokens server-side.
    // This forces the user out of the system on the next request, even if their tablet is offline now.
    if (active === false) {
      try {
        await supabaseAdmin.auth.admin.signOut(userId, "global");
      } catch (signOutErr) {
        // Non-fatal: profile is already marked inactive; client-side guard will catch it.
        console.error("Failed to revoke sessions for deactivated user:", signOutErr);
      }
    }

    if (role) {
      const { data: existingRole } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existingRole) {
        const { error: roleError } = await supabaseAdmin
          .from("user_roles")
          .update({ role })
          .eq("user_id", userId);
        if (roleError) throw roleError;
      } else {
        const { error: roleError } = await supabaseAdmin
          .from("user_roles")
          .insert({ user_id: userId, role });
        if (roleError) throw roleError;
      }

      if (role === "engineer" || role === "co_engineer") {
        const { data: existingEngineer, error: existingEngineerError } = await supabaseAdmin
          .from("engineers")
          .select("id")
          .eq("id", userId)
          .maybeSingle();
        if (existingEngineerError) throw existingEngineerError;

        const engineerName = name ?? editFallbackName(profileUpdate) ?? undefined;

        if (existingEngineer) {
          const engineerUpdate: Record<string, unknown> = { is_active: active ?? true };
          if (engineerName) engineerUpdate.name = engineerName;

          const { error: engineerUpdateError } = await supabaseAdmin
            .from("engineers")
            .update(engineerUpdate)
            .eq("id", userId);
          if (engineerUpdateError) throw engineerUpdateError;
        } else {
          const pinHash = await createPendingPinHash();
          const { data: profileRow, error: profileLookupError } = await supabaseAdmin
            .from("profiles")
            .select("name")
            .eq("id", userId)
            .single();
          if (profileLookupError) throw profileLookupError;

          const { error: engineerInsertError } = await supabaseAdmin
            .from("engineers")
            .insert({
              id: userId,
              name: engineerName ?? profileRow.name,
              pin_hash: pinHash,
              is_active: active ?? true,
            });
          if (engineerInsertError) throw engineerInsertError;
        }
      } else {
        const { error: engineerDeleteError } = await supabaseAdmin
          .from("engineers")
          .delete()
          .eq("id", userId);
        if (engineerDeleteError) throw engineerDeleteError;
      }
    } else if (name !== undefined || active !== undefined) {
      const { data: existingEngineer, error: existingEngineerError } = await supabaseAdmin
        .from("engineers")
        .select("id")
        .eq("id", userId)
        .maybeSingle();
      if (existingEngineerError) throw existingEngineerError;

      if (existingEngineer) {
        const engineerUpdate: Record<string, unknown> = {};
        if (name !== undefined) engineerUpdate.name = name;
        if (active !== undefined) engineerUpdate.is_active = active;

        if (Object.keys(engineerUpdate).length > 0) {
          const { error: engineerUpdateError } = await supabaseAdmin
            .from("engineers")
            .update(engineerUpdate)
            .eq("id", userId);
          if (engineerUpdateError) throw engineerUpdateError;
        }
      }
    }

    return jsonResponse({ success: true }, 200);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return jsonResponse({ error: error.errors[0]?.message ?? "Invalid input" }, 400);
    }
    console.error("update-user error:", error);
    return jsonResponse({ error: getReadableErrorMessage(error) }, 400);
  } finally {
    clearTimeout(timeoutId);
  }
});

function editFallbackName(profileUpdate: Record<string, unknown>) {
  const candidate = profileUpdate.name;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
}
