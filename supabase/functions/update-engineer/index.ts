import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

const schema = z.object({
  engineerId: z.string().uuid("Invalid engineer ID"),
  name: z.string().trim().min(1).max(100).optional(),
  active: z.boolean().optional(),
  pin: z.string().regex(/^\d{4}$/).optional(),
  laborRate: z.number().min(0).max(10000).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsError } = await supabaseAdmin.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) throw new Error("Not authenticated");

    const callerId = claimsData.claims.sub as string;
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: callerId, _role: "admin" });
    const { data: isManager } = await supabaseAdmin.rpc("has_role", { _user_id: callerId, _role: "manager" });
    if (!isAdmin && !isManager) throw new Error("Only managers and admins can update engineers");

    const { engineerId, name, active, pin, laborRate } = schema.parse(await req.json());
    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (active !== undefined) update.is_active = active;
    if (laborRate !== undefined) update.labor_rate = laborRate;

    if (Object.keys(update).length > 0) {
      const { error } = await supabaseAdmin.from("engineers").update(update).eq("id", engineerId);
      if (error) throw error;
    }

    if (pin) {
      const { error } = await supabaseAdmin.rpc("set_engineer_pin_standalone", { _engineer_id: engineerId, _new_pin: pin });
      if (error) throw error;
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

    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});