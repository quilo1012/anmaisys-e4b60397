import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  pin: z.string().min(4).max(10).regex(/^\d+$/, "PIN must be digits"),
}).strict();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Two different failures used to leave by the same door, both as a bare 401:
    // no token at all, and a token GoTrue refused. The screen turns 401 into "your
    // session has expired", which was wrong at least once — on 07/08 the browser
    // sent a token good enough for PostgREST to accept an insert 100ms later, and
    // this call still came back 401. Nothing was written down about why, because
    // userError was discarded. So each case now says which one it was, in the body
    // and in the function's own log.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ") || authHeader === "Bearer undefined") {
      console.error("No bearer token on the request");
      return new Response(JSON.stringify({ error: "Unauthorized", message: "verify-admin-pin: no bearer token on the request" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // getUser() asks GoTrue, which looks the session up in auth.sessions — so a token
    // whose signature and expiry are both fine is still refused here once its session
    // row is gone (signed out elsewhere, refresh-token reuse). PostgREST never checks
    // that, which is how the same token can be good enough to write a row and not good
    // enough to open this door. If that is what happened, the reason says so.
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      const reason = userError?.message ?? "no user for this token";
      console.error("Token rejected by getUser:", reason);
      return new Response(JSON.stringify({ error: "Unauthorized", message: `verify-admin-pin: token rejected — ${reason}` }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    // Verify caller is admin
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawBody = await req.json().catch(() => ({}));
    const parsedBody = BodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return new Response(JSON.stringify({ error: parsedBody.error.flatten().fieldErrors }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const pin = parsedBody.data.pin;

    // Verify PIN using pgcrypto crypt() comparison.
    // Must use the user-scoped client so auth.uid() resolves inside the SECURITY DEFINER function.
    const { data: match, error: matchError } = await supabaseUser.rpc("verify_admin_pin", {
      _pin: pin,
    });

    if (matchError) {
      console.error("PIN verification error:", matchError.message);
      return new Response(JSON.stringify({ error: "Verification failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!match) {
      return new Response(JSON.stringify({ valid: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ valid: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
