// Edge Function: log-audit-event
// Server-side audit logger so the real client IP is captured (the client cannot
// send a trustworthy ip_address from the browser). The function authenticates
// the caller via their JWT, derives the actor name from `profiles`, reads the
// IP from forwarded headers, and writes the row with the service-role key.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  action: z.string().min(1).max(100),
  entity_type: z.string().min(1).max(100),
  entity_id: z.string().min(1).max(200).optional().nullable(),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function extractIp(req: Request): string | null {
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Authenticate the caller via their JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "missing_authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ error: "invalid_token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userData.user.id;

  // Parse + validate body.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const parsedBody = BodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return new Response(JSON.stringify({ error: parsedBody.error.flatten().fieldErrors }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const action = parsedBody.data.action;
  const entityType = parsedBody.data.entity_type;
  const entityId = parsedBody.data.entity_id ?? null;
  const details = parsedBody.data.details ?? {};

  if (JSON.stringify(details).length > 10000) {
    return new Response(JSON.stringify({ error: "details_too_large" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve actor name.
  const { data: profile } = await admin
    .from("profiles")
    .select("name, email")
    .eq("id", userId)
    .maybeSingle();
  const userName = profile?.name || profile?.email || "Unknown";

  const ip = extractIp(req);

  const { error: insertErr } = await admin.from("audit_logs").insert({
    user_id: userId,
    user_name: userName,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    ip_address: ip,
  });

  if (insertErr) {
    return new Response(JSON.stringify({ error: insertErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
