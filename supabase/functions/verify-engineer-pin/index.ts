import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  pin: z.string().min(4).max(6).regex(/^\d+$/, "PIN must contain only digits"),
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // User-scoped client: so auth.uid() resolves inside the SECURITY DEFINER verifier,
    // which is the key the lockout counts against — same contract as verify-admin-pin.
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
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

    // Throttled verification through verify_engineer_pin_with_lockout. Unlike the old
    // verify_pin_by_code, this counts failures per caller (auth.uid()) and locks out
    // after 5 tries on a ladder of 30/60/120/300s — the same gate the admin PIN has —
    // so the 4-6 digit engineer PIN space can no longer be brute-forced by an
    // authenticated account. Must use the user-scoped client so auth.uid() resolves.
    const { data: verdict, error: matchError } = await supabaseUser.rpc(
      "verify_engineer_pin_with_lockout",
      { _pin: pin },
    );

    if (matchError) {
      console.error("PIN verification error:", matchError.message);
      return new Response(JSON.stringify({ error: "Verification failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = (verdict ?? {}) as {
      success?: boolean;
      error?: string;
      locked_seconds?: number;
      remaining?: number;
      engineer_id?: string;
      engineer_name?: string;
    };

    if (result.error === "locked") {
      // 429 so a client that never learns about lockouts still fails loudly instead of
      // reading an empty { valid: false } as a wrong PIN.
      const wait = Math.max(1, Number(result.locked_seconds ?? 0));
      return new Response(
        JSON.stringify({ valid: false, locked: true, locked_seconds: wait }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(wait) },
        },
      );
    }

    if (!result.success) {
      return new Response(
        JSON.stringify({ valid: false, remaining: result.remaining ?? null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Return the matched engineer's identity
    return new Response(JSON.stringify({
      valid: true,
      engineer_id: result.engineer_id,
      engineer_name: result.engineer_name,
    }), {
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
