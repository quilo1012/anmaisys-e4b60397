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
  id: z.string().uuid(),
  email: z.string().email().max(255),
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
    if (!isAdmin && !isManager) throw new Error("Only admins or managers may update operator emails");

    const { id, email } = bodySchema.parse(await req.json());
    const newEmail = email.trim().toLowerCase();

    // Lookup current operator account
    const { data: acc, error: accErr } = await admin
      .from("operator_line_accounts")
      .select("id, user_id, email")
      .eq("id", id)
      .maybeSingle();
    if (accErr) throw accErr;
    if (!acc) throw new Error("Operator account not found");

    if (acc.email.toLowerCase() === newEmail) {
      return new Response(
        JSON.stringify({ success: true, unchanged: true, email: acc.email }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Ensure no other operator account uses this email
    const { data: clash } = await admin
      .from("operator_line_accounts")
      .select("id")
      .eq("email", newEmail)
      .neq("id", id)
      .maybeSingle();
    if (clash) throw new Error("Another operator account already uses this email");

    // Update auth user (this changes the login email)
    const { error: authErr } = await admin.auth.admin.updateUserById(acc.user_id, {
      email: newEmail,
      email_confirm: true,
    });
    if (authErr) throw authErr;

    // Update operator_line_accounts + profile email
    const { error: olaErr } = await admin
      .from("operator_line_accounts")
      .update({ email: newEmail })
      .eq("id", id);
    if (olaErr) throw olaErr;

    await admin.from("profiles").update({ email: newEmail }).eq("id", acc.user_id);

    return new Response(
      JSON.stringify({ success: true, email: newEmail }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: error.errors[0].message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Robust message extraction — Supabase errors (PostgrestError, AuthError)
    // are plain objects, not Error instances, so error.message alone or
    // JSON.stringify on a non-enumerable Error yields "{}".
    const anyErr = error as any;
    const message =
      (typeof anyErr?.message === "string" && anyErr.message) ||
      (typeof anyErr?.error_description === "string" && anyErr.error_description) ||
      (typeof anyErr?.error === "string" && anyErr.error) ||
      (typeof anyErr?.hint === "string" && anyErr.hint) ||
      (typeof error === "string" ? error : null) ||
      "Unknown error";
    console.error("[update-operator-email] failed:", message, anyErr);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
