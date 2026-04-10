import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const createUserSchema = z.object({
  email: z.string().email("Invalid email format").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  name: z.string().trim().min(1, "Name is required").max(100),
  role: z.enum(["admin", "manager", "engineer", "operator"], { errorMap: () => ({ message: "Invalid role" }) }),
  shift: z.string().max(50).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

    // Only admins can create admin users
    if (role === "admin" && !isAdmin) throw new Error("Only admins can assign the Admin role");

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createError) throw createError;

    if (shift && newUser.user) {
      await supabaseAdmin
        .from("profiles")
        .update({ shift })
        .eq("id", newUser.user.id);
    }

    const { data: existingRole } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", newUser.user!.id)
      .single();

    if (existingRole) {
      await supabaseAdmin
        .from("user_roles")
        .update({ role })
        .eq("user_id", newUser.user!.id);
    } else {
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: newUser.user!.id, role });
    }

    return new Response(JSON.stringify({ success: true, userId: newUser.user!.id }), {
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
