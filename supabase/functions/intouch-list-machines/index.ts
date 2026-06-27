// Proxies GET /api/Machine on the iTouching API so the browser can list
// available machines without exposing the bearer token client-side.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTOUCH_URL = (Deno.env.get("INTOUCH_API_URL") ?? "").replace(/\/+$/, "");
const INTOUCH_TOKEN = Deno.env.get("INTOUCH_API_TOKEN") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authClient = createClient(SUPABASE_URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(token);
    const userId = claimsData?.claims?.sub as string | undefined;
    if (claimsErr || !userId) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const ok = (roles ?? []).some((r) => ["admin", "manager"].includes(r.role));
    if (!ok) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Try a few endpoints — iTouching deployments differ.
    const candidates = ["/api/GetMachineList", "/api/Machine"];
    let raw: any = null;
    let usedPath = "";
    const errs: string[] = [];
    for (const path of candidates) {
      try {
        const res = await fetch(`${INTOUCH_URL}${path}`, {
          headers: { Authorization: `Bearer ${INTOUCH_TOKEN}`, Accept: "application/json" },
        });
        const txt = await res.text();
        if (!res.ok) { errs.push(`${path} → ${res.status}: ${txt.slice(0, 160)}`); continue; }
        try { raw = JSON.parse(txt); usedPath = path; break; }
        catch { errs.push(`${path}: invalid JSON (${txt.slice(0, 120)})`); }
      } catch (e) {
        errs.push(`${path}: ${(e as Error).message}`);
      }
    }
    if (raw == null) throw new Error(`iTouching: no endpoint returned JSON. ${errs.join(" | ")}`);


    // The payload may be an array, or wrapped (e.g. { Machines: [...] } / { data: [...] }).
    const list: any[] = Array.isArray(raw)
      ? raw
      : (raw.Machines ?? raw.machines ?? raw.data ?? raw.Items ?? raw.items ?? raw.Result ?? raw.result ?? []);

    const pick = (o: any, keys: string[]) => {
      for (const k of keys) {
        const v = o?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
      }
      return "";
    };

    const machines = list.map((m) => ({
      guid: pick(m, ["MachineID", "MachineId", "MachineGuid", "MachineGUID", "Guid", "GUID", "Id", "ID", "id"]),
      name: pick(m, ["MachineName", "Name", "name", "Description", "description"]),
      line: pick(m, ["LineName", "Line", "line", "GroupName", "Group", "Area"]),
      raw: m,
    })).filter((m) => m.guid || m.name);

    return new Response(JSON.stringify({ machines, source: usedPath, count: machines.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
