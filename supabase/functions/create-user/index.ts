import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import bcrypt from "npm:bcryptjs@2.4.3";

const MAX_BODY_BYTES = 8 * 1024; // 8 KB is plenty for the JSON payload
const REQ_TIMEOUT_MS = 15_000;

const createPendingPinHash = async () => {
  try {
    return await bcrypt.hash(crypto.randomUUID(), 10);
  } catch {
    return "temp";
  }
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const createUserSchema = z.object({
  email: z.string().email("Invalid email format").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  name: z.string().trim().min(1, "Name is required").max(100),
  role: z.enum(["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator"], { errorMap: () => ({ message: "Invalid role" }) }),
  shift: z.string().max(50).optional(),
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

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsErr } = await supabaseUser.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const callerId = claimsData.claims.sub as string;

    // Check if caller is admin or manager
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
    const body = createUserSchema.parse(parsedBody);
    const { email, password, name, role, shift } = body;

    // Managers can only create engineer / co_engineer
    if (isManager && !isAdmin && role !== "engineer" && role !== "co_engineer") {
      return jsonResponse({ error: "Managers can only create Engineer or Co-Engineer users" }, 403);
    }

    // Only admins can create admin, manager, or maintenance_manager users
    if ((role === "admin" || role === "manager" || role === "maintenance_manager") && !isAdmin) {
      return jsonResponse({ error: "Only admins can assign Admin, Manager or Maintenance Manager roles" }, 403);
    }

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createError) {
      const msg = /already|exists|registered/i.test(createError.message)
        ? "Email already registered"
        : "Could not create user";
      return jsonResponse({ error: msg }, 400);
    }

    if (!newUser.user) {
      return jsonResponse({ error: "Could not create user" }, 500);
    }

    if (shift) {
      await supabaseAdmin
        .from("profiles")
        .update({ shift })
        .eq("id", newUser.user.id);
    }

    const { data: existingRole } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", newUser.user.id)
      .maybeSingle();

    if (existingRole) {
      await supabaseAdmin
        .from("user_roles")
        .update({ role })
        .eq("user_id", newUser.user.id);
    } else {
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: newUser.user.id, role });
    }

    if (role === "engineer" || role === "co_engineer") {
      const { data: existingEngineer, error: existingEngineerError } = await supabaseAdmin
        .from("engineers")
        .select("id")
        .eq("id", newUser.user.id)
        .maybeSingle();

      if (existingEngineerError) throw existingEngineerError;

      if (existingEngineer) {
        const { error: engineerUpdateError } = await supabaseAdmin
          .from("engineers")
          .update({ name, is_active: true })
          .eq("id", newUser.user.id);
        if (engineerUpdateError) throw engineerUpdateError;
      } else {
        const pinHash = await createPendingPinHash();
        const { error: engineerInsertError } = await supabaseAdmin
          .from("engineers")
          .insert({ id: newUser.user.id, name, pin_hash: pinHash, is_active: true });
        if (engineerInsertError) throw engineerInsertError;
      }
    } else {
      const { error: engineerDeleteError } = await supabaseAdmin
        .from("engineers")
        .delete()
        .eq("id", newUser.user.id);

      if (engineerDeleteError && engineerDeleteError.code !== "PGRST116") {
        throw engineerDeleteError;
      }
    }

    return jsonResponse({ success: true, userId: newUser.user.id }, 200);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return jsonResponse({ error: error.errors[0]?.message ?? "Invalid input" }, 400);
    }
    console.error("create-user error:", error);
    return jsonResponse({ error: "Internal error" }, 500);
  } finally {
    clearTimeout(timeoutId);
  }
});
