import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const updateUserSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["admin", "manager", "engineer", "operator"]).optional(),
  shift: z.string().max(50).optional(),
  active: z.boolean().optional(),
  email: z.string().email("Invalid email format").max(255).optional(),
  password: z.string().min(6, "Password must be at least 6 characters").max(128).optional(),
  labor_rate: z.number().min(0).optional(),
});

const getReadableErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";

  if (message.toLowerCase().includes("known to be weak and easy to guess")) {
    return "This password was rejected by the backend security policy. Please choose a different password.";
  }

  return message;
};

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

    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: caller.id, _role: "admin" });
    const { data: isManager } = await supabaseAdmin.rpc("has_role", { _user_id: caller.id, _role: "manager" });

    if (!isAdmin && !isManager) throw new Error("Only managers and admins can update users");

    const body = updateUserSchema.parse(await req.json());
    const { userId, name, role, shift, active, email, password, labor_rate } = body;

    if (role === "admin" && !isAdmin) throw new Error("Only admins can assign the Admin role");
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

    if (role) {
      const { data: existingRole } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", userId)
        .single();

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
    }

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

    return new Response(JSON.stringify({ error: getReadableErrorMessage(error) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
