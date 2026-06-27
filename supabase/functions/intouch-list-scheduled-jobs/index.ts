// Returns iTouching scheduled jobs grouped per line for a given date+shift,
// shaped exactly like the IntouchImportDialog sections so the Production
// Planner can be filled without uploading a spreadsheet.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTOUCH_URL = (Deno.env.get("INTOUCH_API_URL") ?? "").replace(/\/+$/, "");
const INTOUCH_TOKEN = Deno.env.get("INTOUCH_API_TOKEN") ?? "";

const Body = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift: z.enum(["DAY", "NIGHT"]),
}).strict();

function londonOffsetMs(d: Date) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(d).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime();
}
function shiftWindow(date: string, shift: "DAY" | "NIGHT") {
  const h = shift === "DAY" ? 6 : 18;
  const naive = new Date(`${date}T${String(h).padStart(2, "0")}:00:00Z`);
  const start = new Date(naive.getTime() - londonOffsetMs(naive));
  const end = new Date(start.getTime() + 12 * 3600 * 1000);
  return { start, end };
}

const cleanCode = (v: unknown) => String(v ?? "").trim()
  .replace(/^['"]+|['"]+$/g, "").replace(/-B\d+$/i, "").toUpperCase();
const num = (v: unknown) => {
  const c = String(v ?? "").replace(/[^\d,.-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  const n = Number(c.includes(",") && !c.includes(".") ? c.replace(",", ".") : c);
  return Number.isFinite(n) ? n : 0;
};
const pick = (o: any, ks: string[]) => {
  for (const k of ks) { const v = o?.[k]; if (v != null && String(v).trim() !== "") return v; }
  return undefined;
};
function walk(v: unknown, cb: (o: any) => void) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const x of v) walk(x, cb); return; }
  cb(v);
  for (const x of Object.values(v)) walk(x, cb);
}
async function itFetch(path: string, init?: RequestInit): Promise<{ data: unknown; status: number; ok: boolean; bytes: number; err?: string }> {
  try {
    const r = await fetch(`${INTOUCH_URL}${path}`, {
      ...(init ?? {}),
      headers: {
        Authorization: `Bearer ${INTOUCH_TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const t = await r.text();
    if (!r.ok) return { data: null, status: r.status, ok: false, bytes: t.length, err: t.slice(0, 160) };
    try { return { data: JSON.parse(t), status: r.status, ok: true, bytes: t.length }; }
    catch { return { data: null, status: r.status, ok: false, bytes: t.length, err: "invalid_json" }; }
  } catch (e) { return { data: null, status: 0, ok: false, bytes: 0, err: (e as Error).message }; }
}

type Row = { code: string; description: string; qty: number };
function extractRowsForMachine(raw: unknown, allowedIds: Set<string>, allowedNames: Set<string>): Row[] {
  const out: Row[] = [];
  const same = (v: unknown) => {
    const s = String(v ?? "").trim();
    if (!s) return true;
    return allowedIds.has(s) || allowedNames.has(s.toLowerCase());
  };
  walk(raw, (obj) => {
    const wos = obj?.WorksOrders ?? obj?.WorkOrders ?? obj?.worksOrders;
    const mref = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "Machine", "MachineName"]);
    if (!Array.isArray(wos)) return;
    if (!same(mref)) return;
    for (const wo of wos) {
      const code = cleanCode(pick(wo, ["PartCode", "ProductCode", "SkuCode", "SKU", "ItemCode", "StockCode", "OrderNumber"]));
      if (!code || code.length < 2) continue;
      const description = String(pick(wo, ["LongDescription", "ProductDescription", "PartDescription", "Description", "Name"]) ?? code).trim();
      const qty = num(pick(wo, ["OrderQuantity", "RequiredQuantity", "RequiredQty", "Quantity", "Qty", "PlannedQuantity", "PlanQty", "Balance"])) || 1;
      out.push({ code, description, qty });
    }
  });
  if (out.length === 0) {
    walk(raw, (obj) => {
      const mref = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "Machine", "MachineName"]);
      if (!same(mref)) return;
      const code = cleanCode(pick(obj, ["PartCode", "ProductCode", "SkuCode", "SKU", "ItemCode", "StockCode", "FGCode", "MaterialCode", "Product", "Code"]));
      if (!code || code.length < 3 || /^(LINE|MACHINE|DATE|SHIFT|START|END|STATUS)$/i.test(code)) return;
      const qty = num(pick(obj, ["OrderQuantity", "RequiredQuantity", "Required", "Quantity", "Qty", "PlannedQuantity", "PlanQty", "TargetQty", "ScheduledQty", "Balance", "Demand"])) || 1;
      const description = String(pick(obj, ["LongDescription", "ProductDescription", "PartDescription", "MaterialDescription", "Description", "Name"]) ?? code).trim();
      out.push({ code, description, qty });
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const authClient = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: claims, error: cErr } = await authClient.auth.getClaims(token);
    const uid = claims?.claims?.sub as string | undefined;
    if (cErr || !uid) return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
    if (!(roles ?? []).some((r) => ["admin", "manager"].includes(r.role))) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { session_date, shift } = parsed.data;
    const { start, end } = shiftWindow(session_date, shift);
    const startISO = start.toISOString();
    const endISO = end.toISOString();

    const { data: maps } = await admin
      .from("intouch_machine_map")
      .select("intouch_machine_id, intouch_machine_name, line_id")
      .eq("active", true)
      .not("line_id", "is", null);
    const { data: lineRows } = await admin.from("lines").select("id, name");
    const lineName = new Map((lineRows ?? []).map((l: any) => [l.id, l.name]));
    const byLine = new Map<string, { id: string; name: string }[]>();
    for (const m of maps ?? []) {
      const arr = byLine.get(m.line_id!) ?? [];
      arr.push({ id: m.intouch_machine_id, name: m.intouch_machine_name ?? "" });
      byLine.set(m.line_id!, arr);
    }

    // Build list of mapped machine GUIDs — iTouching period endpoints
    // expect this array in the POST body (not an empty array).
    const ids = (maps ?? []).map((m: any) => m.intouch_machine_id).filter(Boolean);
    const idsBody = JSON.stringify(ids);

    // Try every known scheduled-jobs / material-requirements endpoint.
    const payloads: unknown[] = [];
    const debug: Array<{ path: string; method: string; status: number; ok: boolean; bytes: number; sample: unknown; err?: string }> = [];
    const attempts: Array<{ path: string; method: "GET" | "POST"; body?: string }> = [
      { path: `/api/GetRunningJobs`, method: "GET" },
      { path: `/api/GetJobsRan?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, method: "POST", body: idsBody },
      { path: `/api/GetJobsRanDuringPeriod?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, method: "POST", body: idsBody },
      { path: `/api/GetJobsScheduledDuringPeriod?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, method: "POST", body: idsBody },
      { path: `/api/JobChange?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, method: "POST", body: idsBody },
      { path: `/api/ScheduleReports/MaterialRequirements/Machine?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, method: "GET" },
      { path: `/api/ScheduleReports/MaterialRequirementsByMachine?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, method: "GET" },
      { path: `/api/GetScheduledJobs?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, method: "GET" },
      { path: `/api/GetJobSchedule?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, method: "GET" },
      { path: `/api/GetWorkToList?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, method: "GET" },
    ];
    for (const a of attempts) {
      const init: RequestInit = a.method === "GET" ? { method: "GET" } : { method: "POST", body: a.body ?? idsBody };
      const r = await itFetch(a.path, init);
      let sample: unknown = null;
      if (r.data) { try { sample = JSON.parse(JSON.stringify(r.data).slice(0, 800)); } catch { sample = null; } }
      debug.push({ path: a.path.split("?")[0], method: a.method, status: r.status, ok: r.ok, bytes: r.bytes, sample, err: r.err });
      if (r.data) payloads.push(r.data);
    }

    // Per-machine GET for Material Requirements (this is the variant that works in intouch-sync-production).
    for (const m of ids) {
      const path = `/api/ScheduleReports/MaterialRequirements/Machine?MachineGUID=${encodeURIComponent(m)}&StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`;
      const r = await itFetch(path, { method: "GET" });
      if (r.data) payloads.push(r.data);
      if (!r.ok && debug.length < 60) {
        debug.push({ path: "/api/ScheduleReports/MaterialRequirements/Machine?MachineGUID=…", method: "GET", status: r.status, ok: r.ok, bytes: r.bytes, sample: null, err: r.err });
      }
    }

    // Hydrate: if any running-jobs payload contains JobIDs, POST them to /api/GetJobs for full records.
    const jobIds = new Set<string>();
    for (const p of payloads) {
      walk(p, (o) => {
        const jid = String(pick(o, ["JobID", "JobId", "JobGUID", "JobGuid"]) ?? "").trim();
        if (jid && jid.length >= 8) jobIds.add(jid);
      });
    }
    if (jobIds.size > 0) {
      const r = await itFetch(`/api/GetJobs`, { method: "POST", body: JSON.stringify(Array.from(jobIds)) });
      let sample: unknown = null;
      if (r.data) { try { sample = JSON.parse(JSON.stringify(r.data).slice(0, 800)); } catch { sample = null; } }
      debug.push({ path: "/api/GetJobs (hydrated)", method: "POST", status: r.status, ok: r.ok, bytes: r.bytes, sample, err: r.err });
      if (r.data) payloads.push(r.data);
    }

    // Collect all machine identifier keys seen in payloads (for GUID mismatch diagnostics).
    const machineKeysSeen = new Set<string>();
    for (const p of payloads) {
      walk(p, (obj) => {
        const v = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "Machine", "MachineName"]);
        if (v != null) {
          const s = String(v).trim();
          if (s) machineKeysSeen.add(s);
        }
      });
    }

    const sections: Array<{ line: string; items: any[] }> = [];
    for (const [line_id, machines] of byLine) {
      const line = lineName.get(line_id);
      if (!line) continue;
      const allowedIds = new Set(machines.map((m) => m.id).filter(Boolean));
      const allowedNames = new Set(machines.map((m) => (m.name ?? "").toLowerCase()).filter(Boolean));
      const merged = new Map<string, Row>();
      for (const p of payloads) {
        for (const r of extractRowsForMachine(p, allowedIds, allowedNames)) {
          const cur = merged.get(r.code);
          if (!cur) merged.set(r.code, r);
          else merged.set(r.code, { code: r.code, description: cur.description || r.description, qty: Math.max(cur.qty, r.qty) });
        }
      }
      if (merged.size > 0) {
        sections.push({
          line,
          items: Array.from(merged.values()).map((r) => ({ sku_code: r.code, description: r.description, qty: r.qty })),
        });
      }
    }

    const debugBlock = {
      endpoints: debug,
      mapped_machines: (maps ?? []).length,
      machine_keys_seen: Array.from(machineKeysSeen).slice(0, 200),
    };

    return new Response(JSON.stringify({
      sections, count: sections.length,
      total_skus: sections.reduce((a, s) => a + s.items.length, 0),
      window: { start: startISO, end: endISO },
      mapped_machines: (maps ?? []).length,
      endpoints: debug,
      debug: debugBlock,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
