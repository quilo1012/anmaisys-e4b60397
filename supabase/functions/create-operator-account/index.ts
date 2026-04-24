import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

const bodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(128),
  label: z.string().trim().min(1).max(100),
  line_ids: z.array(z.string().uuid()).min(1).max(50),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user: caller } } = await userClient.auth.getUser();
    if (!caller) throw new Error("Not authenticated");

    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: caller.id, _role: "admin" });
    const { data: isManager } = await admin.rpc("has_role", { _user_id: caller.id, _role: "manager" });
    if (!isAdmin && !isManager) throw new Error("Only admins or managers may create operator accounts");

    const { email, password, label, line_ids } = bodySchema.parse(await req.json());

    // Create auth user
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: label },
    });
    if (createErr) throw createErr;
    if (!created.user) throw new Error("Failed to create user");

    const newUserId = created.user.id;

    // Profile may already be created by handle_new_user trigger; ensure name
    await admin.from("profiles").update({ name: label }).eq("id", newUserId);

    // Assign operator role (replace if any)
    await admin.from("user_roles").delete().eq("user_id", newUserId);
    const { error: roleErr } = await admin
      .from("user_roles")
      .insert({ user_id: newUserId, role: "operator" });
    if (roleErr) throw roleErr;

    // Register operator_line_accounts
    const { error: olaErr } = await admin.from("operator_line_accounts").insert({
      user_id: newUserId,
      email,
      label,
      line_ids,
      created_by: caller.id,
    });
    if (olaErr) throw olaErr;

    return new Response(
      JSON.stringify({ success: true, user_id: newUserId, email, label }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
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
