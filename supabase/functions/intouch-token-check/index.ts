// Admin-only: probes the iTouching API with the configured token and
// returns the raw response so we can tell test/sandbox vs production.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTOUCH_URL = (Deno.env.get("INTOUCH_API_URL") ?? "").replace(/\/+$/, "");
const INTOUCH_TOKEN = Deno.env.get("INTOUCH_API_TOKEN") ?? "";

function maskToken(t: string) {
  if (!t) return "(empty)";
  if (t.length <= 10) return `${t.slice(0, 2)}…${t.slice(-2)} (len=${t.length})`;
  return `${t.slice(0, 4)}…${t.slice(-4)} (len=${t.length})`;
}

function detectMode(text: string, url: string) {
  const hay = (text + " " + url).toLowerCase();
  const hits: string[] = [];
  for (const k of ["sandbox", "test", "demo", "staging", "dev", "trial", "mock"]) {
    if (hay.includes(k)) hits.push(k);
  }
  if (hits.length) return { mode: "test/sandbox (suspected)", hits };
  return { mode: "production (likely)", hits: [] };
}

async function probe(path: string) {
  const url = `${INTOUCH_URL}${path}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${INTOUCH_TOKEN}`, Accept: "application/json" },
    });
    const text = await res.text();
    return {
      path,
      url,
      status: res.status,
      ok: res.ok,
      ms: Date.now() - started,
      headers: Object.fromEntries(res.headers.entries()),
      body_preview: text.slice(0, 2000),
      body_length: text.length,
    };
  } catch (e) {
    return { path, url, status: 0, ok: false, ms: Date.now() - started, error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const ok = (roles ?? []).some((r) => ["admin", "manager"].includes(r.role));
    if (!ok) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!INTOUCH_URL || !INTOUCH_TOKEN) {
      return new Response(JSON.stringify({
        error: "missing_config",
        intouch_url: INTOUCH_URL || null,
        token: maskToken(INTOUCH_TOKEN),
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const probes = await Promise.all([
      probe("/api/Machine"),
      probe("/api/Account"),
      probe("/api/Company"),
    ]);

    const combined = probes.map((p) => `${p.url} ${p.status} ${p.body_preview ?? ""}`).join("\n");
    const detection = detectMode(combined, INTOUCH_URL);

    return new Response(JSON.stringify({
      intouch_url: INTOUCH_URL,
      token: maskToken(INTOUCH_TOKEN),
      detection,
      probes,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
