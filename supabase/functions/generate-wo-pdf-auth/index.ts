import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  reportType: z.string().min(1).max(100).optional(),
  entityId: z.string().min(1).max(200).optional(),
}).strict();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Server-side gate for PDF / report generation.
 * Verifies caller is admin or manager, then logs the event to audit_logs.
 * Returns { ok: true } on success — caller proceeds with client-side rendering.
 */
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

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabaseUser.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Role check: admin OR manager
    const [{ data: isAdmin }, { data: isManager }] = await Promise.all([
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "manager" }),
    ]);

    if (!isAdmin && !isManager) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse optional context (report scope / wo id)
    let rawBody: unknown = {};
    try { rawBody = await req.json(); } catch { rawBody = {}; }
    const parsedBody = BodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return new Response(JSON.stringify({ error: parsedBody.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const reportType = parsedBody.data.reportType ?? "wo_report";
    const entityId = parsedBody.data.entityId ?? null;

    // Audit log via the user-scoped client so auth.uid() resolves inside the SECURITY DEFINER function.
    const { error: auditErr } = await supabaseUser.rpc("log_audit_event", {
      _action: "pdf.generated",
      _entity_type: reportType,
      _entity_id: entityId,
      _details: { role: isAdmin ? "admin" : "manager" },
    });

    if (auditErr) {
      console.error("Audit log failed:", auditErr.message);
      // Non-fatal: still allow generation, but inform client
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-wo-pdf-auth error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
