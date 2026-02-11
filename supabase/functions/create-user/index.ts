import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    // Create admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify calling user is admin
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller } } = await supabaseUser.auth.getUser();
    if (!caller) throw new Error("Not authenticated");

    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });

    if (!isAdmin) throw new Error("Only managers can create users");

    const { email, password, name, role, shift } = await req.json();

    // Create auth user (this triggers handle_new_user which creates profile)
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createError) throw createError;

    // Update shift if engineer
    if (shift && newUser.user) {
      await supabaseAdmin
        .from("profiles")
        .update({ shift })
        .eq("id", newUser.user.id);
    }

    // The trigger assigns admin role for first user only.
    // For subsequent users, we need to assign the requested role.
    // First check if role was already assigned by trigger
    const { data: existingRole } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", newUser.user!.id)
      .single();

    if (existingRole) {
      // Update existing role
      await supabaseAdmin
        .from("user_roles")
        .update({ role })
        .eq("user_id", newUser.user!.id);
    } else {
      // Insert new role
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: newUser.user!.id, role });
    }

    return new Response(JSON.stringify({ success: true, userId: newUser.user!.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
