// Proxies GET /api/Machine on the iTouching API so the browser can list
// available machines without exposing the bearer token client-side.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTOUCH_URL = (Deno.env.get("INTOUCH_API_URL") ?? "").replace(/\/+$/, "");
const INTOUCH_TOKEN = Deno.env.get("INTOUCH_API_TOKEN") ?? "";
const INTOUCH_AUTH_HEADER = /^bearer\s+/i.test(INTOUCH_TOKEN.trim())
  ? INTOUCH_TOKEN.trim()
  : `Bearer ${INTOUCH_TOKEN.trim()}`;

const ITOUCH_TIMEOUT_MS = 10_000;
const __QUOTA_ADMIN_MACH = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const tomorrowUtcMidnight = () => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};
async function intouchQuotaBlockedUntil(): Promise<string | null> {
  try {
    const { data } = await __QUOTA_ADMIN_MACH
      .from("intouch_quota_status").select("blocked_until")
      .eq("id", "singleton").maybeSingle();
    if (data?.blocked_until && new Date(data.blocked_until).getTime() > Date.now()) {
      return data.blocked_until as string;
    }
  } catch { /* best-effort */ }
  return null;
}
async function intouchMarkEgressExceeded() {
  try {
    await __QUOTA_ADMIN_MACH.from("intouch_quota_status").upsert({
      id: "singleton", blocked_until: tomorrowUtcMidnight(), updated_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}

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

    const blockedUntil = await intouchQuotaBlockedUntil();
    if (blockedUntil) {
      const { data: cached } = await admin
        .from("intouch_machine_map")
        .select("intouch_machine_id, intouch_machine_name, machine_name, line_id, updated_at")
        .order("updated_at", { ascending: false });
      const machines = (cached ?? []).map((c) => ({
        guid: c.intouch_machine_id ?? "",
        name: c.intouch_machine_name ?? c.machine_name ?? "",
        line: "",
        raw: c,
      }));
      return new Response(JSON.stringify({
        machines,
        source: "cache",
        count: machines.length,
        cached: true,
        skipped: true,
        reason: "quota_exhausted",
        retry_after: blockedUntil,
        error: "iTouching daily quota exhausted",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Try a few endpoints — iTouching deployments differ.
    const candidates = ["/api/GetMachineList", "/api/Machine"];
    let raw: any = null;
    let usedPath = "";
    const errs: string[] = [];
    for (const path of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ITOUCH_TIMEOUT_MS);
      try {
        const res = await fetch(`${INTOUCH_URL}${path}`, {
          signal: controller.signal,
          headers: { Authorization: INTOUCH_AUTH_HEADER, Accept: "application/json" },
        });
        const txt = await res.text();
        if (txt.includes("Exceeded API Max daily egress")) {
          await intouchMarkEgressExceeded();
          errs.push(`${path}: iTouching daily quota exhausted`);
          break;
        }
        if (!res.ok) { errs.push(`${path} → ${res.status}: ${txt.slice(0, 160)}`); continue; }
        try { raw = JSON.parse(txt); usedPath = path; break; }
        catch { errs.push(`${path}: invalid JSON (${txt.slice(0, 120)})`); }
      } catch (e) {
        if ((e as any)?.name === "AbortError") errs.push(`${path}: iTouching API timeout`);
        else errs.push(`${path}: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    }
    const egressHit = errs.some((e) => /egress|quota/i.test(e));

    if (raw == null) {
      const { data: cached } = await admin
        .from("intouch_machine_map")
        .select("intouch_machine_id, intouch_machine_name, machine_name, line_id, updated_at")
        .order("updated_at", { ascending: false });

      if (cached && cached.length > 0) {
        const machines = cached.map((c) => ({
          guid: c.intouch_machine_id ?? "",
          name: c.intouch_machine_name ?? c.machine_name ?? "",
          line: "",
          raw: c,
        }));
        return new Response(
          JSON.stringify({
            machines,
            source: "cache",
            count: machines.length,
            cached: true,
            cached_at: cached[0]?.updated_at ?? null,
            reason: egressHit ? "itouching_egress_exceeded" : "itouching_unavailable",
            upstream_errors: errs,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`iTouching: no endpoint returned JSON. ${errs.join(" | ")}`);
    }


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

    return new Response(JSON.stringify({ machines, source: usedPath, count: machines.length, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
