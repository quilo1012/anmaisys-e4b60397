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
  role: z.enum(["admin", "manager", "maintenance_manager", "engineer", "operator"], { errorMap: () => ({ message: "Invalid role" }) }),
  shift: z.string().max(50).optional(),
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

    // Check if caller is admin or manager
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: caller.id, _role: "admin" });
    const { data: isManager } = await supabaseAdmin.rpc("has_role", { _user_id: caller.id, _role: "manager" });

    if (!isAdmin && !isManager) throw new Error("Only managers and admins can create users");

    const body = createUserSchema.parse(await req.json());
    const { email, password, name, role, shift } = body;

    // Managers can only create engineers
    if (isManager && !isAdmin && role !== "engineer") {
      throw new Error("Managers can only create Engineer users");
    }

    // Only admins can create admin, manager, or maintenance_manager users
    if ((role === "admin" || role === "manager" || role === "maintenance_manager") && !isAdmin) {
      throw new Error("Only admins can assign Admin, Manager or Maintenance Manager roles");
    }

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createError) throw createError;

    if (!newUser.user) {
      throw new Error("Failed to create user record");
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

    if (role === "engineer") {
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

    return new Response(JSON.stringify({ success: true, userId: newUser.user.id }), {
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
