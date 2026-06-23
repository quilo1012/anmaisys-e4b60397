import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const BodySchema = z.object({
  account_id: z.string().uuid(),
  password: z.string().min(1).max(200),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { account_id, password } = parsed.data;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Resolve email server-side using service role (never exposed to client)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: acc, error: accErr } = await admin
      .from("operator_line_accounts")
      .select("email")
      .eq("id", account_id)
      .maybeSingle();

    if (accErr || !acc?.email) {
      // Generic message to avoid account enumeration
      return new Response(
        JSON.stringify({ error: "Invalid credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Perform sign-in with a fresh anon client
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({
      email: acc.email,
      password,
    });

    if (signErr || !signIn.session) {
      return new Response(
        JSON.stringify({ error: "Invalid credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Return session tokens only — no email, no user object
    return new Response(
      JSON.stringify({
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
        expires_at: signIn.session.expires_at,
        expires_in: signIn.session.expires_in,
        token_type: signIn.session.token_type,
        user_id: signIn.user?.id ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("tablet-signin error", e);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
