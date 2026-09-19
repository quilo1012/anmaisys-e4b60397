import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

/**
 * Reads the factory's Production RAG workbooks through the external SharePoint
 * reader API and hands the normalized per-line records back to the browser.
 *
 * The tunnel address changes whenever the reader restarts, so it lives in
 * `system_settings.rag_api_base_url` and an admin can edit it. The API key
 * never leaves the server.
 */

const BodySchema = z.object({
  mode: z.enum(["week", "health", "weeks"]).default("week"),
  // Monday of the week to pull, yyyy-MM-dd.
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const ALLOWED = ["admin", "manager", "planner", "production_office_admin", "supervisor"];

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const p = (v: number) => String(v).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims, error: claimsErr } = await authClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claims?.claims?.sub) return json({ error: "unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    const { data: owner } = await admin.rpc("is_owner", { _uid: userId }).maybeSingle?.() ?? { data: null };
    if (!roles.some((r) => ALLOWED.includes(r)) && owner !== true) {
      return json({ error: "forbidden" }, 403);
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return json({ error: "invalid_body", details: parsed.error.flatten().fieldErrors }, 400);
    }
    const { mode } = parsed.data;

    // Tolerate a value pasted as "RAG_API_KEY=..." or with stray quotes/whitespace.
    const apiKey = (Deno.env.get("RAG_API_KEY") ?? "")
      .trim()
      .replace(/^RAG_API_KEY\s*=\s*/i, "")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (!apiKey) return json({ error: "RAG_API_KEY is not configured" }, 400);

    const { data: settings } = await admin
      .from("system_settings")
      .select("rag_api_base_url")
      .limit(1)
      .maybeSingle();
    const base = String(settings?.rag_api_base_url ?? "").trim().replace(/\/+$/, "");
    if (!base) {
      return json({
        error: "not_configured",
        message: "The SharePoint RAG service address is not set. An admin can set it in Settings.",
      }, 400);
    }

    // Hosts that sleep when idle (Render free tier, for one) take the best part of a
    // minute to wake, and the first request pays for the whole cold start. A 25s
    // budget reported that as "unreachable" on a service that was merely asleep, so
    // the first attempt is given room and a second one follows once it is awake.
    const callOnce = async (path: string, timeoutMs: number) => {
      const res = await fetch(`${base}${path}`, {
        headers: { "x-api-key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`RAG service replied ${res.status}: ${body.slice(0, 200)}`);
      }
      return await res.json();
    };

    const call = async (path: string) => {
      try {
        return await callOnce(path, 70_000);
      } catch (e) {
        const msg = (e as Error).message ?? "";
        // Only a wake-up timeout is worth repeating; a 4xx/5xx answer is a real reply.
        if (!/timed out|timeout/i.test(msg)) throw e;
        return await callOnce(path, 40_000);
      }
    };

    // An unavailable reader is an operational state the board knows how to display,
    // not a crash in this function. Return a structured 200 response so the preview
    // runtime does not turn an expected downstream outage into a blank-screen 502.
    if (mode === "health" || mode === "weeks") {
      try {
        const payload = await call(mode === "health" ? "/health" : "/weeks");
        return json(mode === "health" ? { ok: true, base, health: payload } : { ok: true, base, ...payload });
      } catch (e) {
        return json({
          error: "unreachable",
          message: `Could not reach the SharePoint RAG service at ${base}. The address may have changed — update it in Settings.`,
          details: (e as Error).message,
        });
      }
    }

    const weekStart = parsed.data.week_start;
    if (!weekStart) return json({ error: "week_start is required" }, 400);

    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const records: unknown[] = [];
    const errors: { date: string; error: string }[] = [];

    for (const day of days) {
      try {
        const payload = await call(`/performance?date=${day}`);
        for (const r of (payload?.records ?? [])) records.push(r);
      } catch (e) {
        errors.push({ date: day, error: (e as Error).message });
      }
    }

    if (!records.length && errors.length === days.length) {
      return json({
        error: "unreachable",
        message: `Could not reach the SharePoint RAG service at ${base}. The address may have changed — update it in Settings.`,
        details: errors.slice(0, 3),
      });
    }

    return json({ ok: true, week_start: weekStart, count: records.length, records, errors });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
