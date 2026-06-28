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

// Preserve batch suffix like "-B2" — iTouching shows it on the Part Code.
const cleanCode = (v: unknown) => String(v ?? "").trim()
  .replace(/^['"]+|['"]+$/g, "").toUpperCase();
const num = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let c = String(v ?? "").replace(/[^\d,.-]/g, "");
  // European thousands separator: "6.666" or "1.234.567" → strip dots.
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(c)) c = c.replace(/\./g, "").replace(",", ".");
  // US thousands separator: "6,666" or "1,234,567(.xx)" → strip commas.
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(c)) c = c.replace(/,/g, "");
  // Lone comma decimal: "6,5" → "6.5".
  else if (c.includes(",") && !c.includes(".")) c = c.replace(",", ".");
  const n = Number(c);
  return Number.isFinite(n) ? n : 0;
};
const pick = (o: any, ks: string[]) => {
  if (!o || typeof o !== "object") return undefined;
  for (const k of ks) { const v = o?.[k]; if (v != null && String(v).trim() !== "") return v; }
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const k of ks) {
    const real = lower.get(k.toLowerCase());
    const v = real ? o[real] : undefined;
    if (v != null && String(v).trim() !== "") return v;
  }
  return undefined;
};
const machineKey = (v: unknown) => String(v ?? "").trim().replace(/[{}]/g, "").toLowerCase();
const authValue = INTOUCH_TOKEN.trim().match(/^bearer\s+/i) ? INTOUCH_TOKEN.trim() : `Bearer ${INTOUCH_TOKEN.trim()}`;
function walk(v: unknown, cb: (o: any) => void) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const x of v) walk(x, cb); return; }
  cb(v);
  for (const x of Object.values(v)) walk(x, cb);
}
const ITOUCH_TIMEOUT_MS = 10_000;
const __QUOTA_ADMIN_SCH = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const tomorrowUtcMidnight = () => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};
async function intouchQuotaBlockedUntil(): Promise<string | null> {
  try {
    const { data } = await __QUOTA_ADMIN_SCH
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
    await __QUOTA_ADMIN_SCH.from("intouch_quota_status").upsert({
      id: "singleton", blocked_until: tomorrowUtcMidnight(), updated_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}

async function itFetch(path: string, init?: RequestInit): Promise<{ data: unknown; status: number; ok: boolean; bytes: number; err?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ITOUCH_TIMEOUT_MS);
  try {
    const r = await fetch(`${INTOUCH_URL}${path}`, {
      ...(init ?? {}),
      signal: controller.signal,
      headers: {
        Authorization: authValue,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const t = await r.text();
    if (t.includes("Exceeded API Max daily egress")) {
      await intouchMarkEgressExceeded();
      return { data: null, status: r.status, ok: false, bytes: t.length, err: "iTouching daily quota exhausted" };
    }
    if (!r.ok) return { data: null, status: r.status, ok: false, bytes: t.length, err: t.slice(0, 160) };
    try { return { data: JSON.parse(t), status: r.status, ok: true, bytes: t.length }; }
    catch { return { data: null, status: r.status, ok: false, bytes: t.length, err: "invalid_json" }; }
  } catch (e) {
    if ((e as any)?.name === "AbortError") return { data: null, status: 504, ok: false, bytes: 0, err: "iTouching API timeout" };
    return { data: null, status: 0, ok: false, bytes: 0, err: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

async function discoverSchedulePaths() {
  // STRICT: only schedule-oriented endpoints. We deliberately exclude
  // RunningJobs / JobsRan / historical job endpoints — they expose what was
  // produced, not what is currently scheduled in iTouching, and were the root
  // cause of the planner showing SKUs that did not match the live schedule.
  const defaults = [
    // This is the real endpoint exposed by the current iTouching Swagger.
    // It accepts ONLY MachineID; date filtering is done locally from the job
    // PlannedStart/EarliestStart fields when iTouching includes them.
    "/api/appapi/getscheduledjobs",
    "/api/ScheduleReports/ScheduleJobs/Machine",
    "/api/ScheduleReports/ScheduledJobs/Machine",
    "/api/ScheduleReports/JobSchedule/Machine",
    "/api/ScheduleReports/ProductionSchedule/Machine",
    "/api/ScheduleReports/WorkToList/Machine",
    "/api/Reports/ScheduleJobs/Machine",
    "/api/Reports/ScheduledJobs/Machine",
    "/api/Reports/ProductionSchedule/Machine",
    "/api/GetScheduledJobs",
    "/api/GetJobSchedule",
    "/api/GetWorkToList",
    "/api/GetJobsScheduledDuringPeriod",
  ];
  const docs1 = await itFetch("/swagger/docs/v1", { method: "GET" });
  const docs2 = docs1.data ? docs1 : await itFetch("/swagger/v1/swagger.json", { method: "GET" });
  const docs3 = docs2.data ? docs2 : await itFetch("/swagger.json", { method: "GET" });
  const discovered = (docs3.data as any)?.paths && typeof (docs3.data as any).paths === "object"
    ? Object.keys((docs3.data as any).paths).filter((p) => {
      const n = p.toLowerCase();
      // Only paths that explicitly mention "schedule" or "worktolist".
      // Reject ran/running/history/material/stop/login.
      if (!(n.includes("schedule") || n.includes("worktolist"))) return false;
      if (n.includes("ran") || n.includes("running") || n.includes("history")) return false;
      if (n.includes("stop") || n.includes("login") || n.includes("material")) return false;
      return true;
    })
    : [];
  return Array.from(new Set([...discovered, ...defaults])).slice(0, 30);
}

function fillPath(path: string, machineId: string) {
  return path.replace(/\{\s*(MachineGUID|MachineGuid|MachineID|MachineId|machineId|id|ID)\s*\}/g, encodeURIComponent(machineId));
}

function queryVariants(path: string, machineId: string | null, startISO: string, endISO: string) {
  const base = machineId ? fillPath(path, machineId) : path;
  if (machineId && /\/api\/appapi\/getscheduledjobs$/i.test(base)) {
    return [`${base}?MachineID=${encodeURIComponent(machineId)}`];
  }
  const machineParams = machineId
    ? [`MachineGUID=${encodeURIComponent(machineId)}`, `MachineID=${encodeURIComponent(machineId)}`, `MachineGuid=${encodeURIComponent(machineId)}`, `machineId=${encodeURIComponent(machineId)}`]
    : [""];
  const dateParams = [
    `StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`,
    `startTime=${encodeURIComponent(startISO)}&endTime=${encodeURIComponent(endISO)}`,
    `From=${encodeURIComponent(startISO)}&To=${encodeURIComponent(endISO)}`,
    `FromDate=${encodeURIComponent(startISO)}&ToDate=${encodeURIComponent(endISO)}`,
    `StartDate=${encodeURIComponent(startISO)}&EndDate=${encodeURIComponent(endISO)}`,
  ];
  const out: string[] = [];
  for (const mp of machineParams) for (const dp of dateParams) out.push(`${base}?${[mp, dp].filter(Boolean).join("&")}`);
  return Array.from(new Set(out));
}

type Row = { code: string; description: string; qty: number; status: "Running" | "Scheduled"; seq: number };
function parseDateMs(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function objectOverlapsWindow(obj: any, startMs: number, endMs: number) {
  const starts = ["PlannedStart", "EarliestStart", "StartTime", "StartDate", "ScheduledStart", "From", "FromDate"];
  const ends = ["PlannedFinish", "LatestFinish", "EndTime", "EndDate", "ScheduledFinish", "To", "ToDate", "DueDate"];
  const s = parseDateMs(pick(obj, starts));
  const e = parseDateMs(pick(obj, ends));
  if (s == null && e == null) return true;
  const a = s ?? e!;
  const b = e ?? s!;
  return a < endMs && b >= startMs;
}

function readStatus(o: any): "Running" | "Scheduled" {
  const raw = String(pick(o, ["Status", "JobStatus", "State", "RunStatus", "CurrentStatus"]) ?? "").toLowerCase();
  if (/run|active|in.?progress|started/.test(raw)) return "Running";
  const isRunning = pick(o, ["IsRunning", "Running", "IsActive"]);
  if (isRunning === true || String(isRunning).toLowerCase() === "true") return "Running";
  return "Scheduled";
}
function readSeq(o: any): number {
  const v = pick(o, ["Sequence", "Seq", "QueuePosition", "Position", "SequenceNumber", "JobOrder", "PriorityOrder", "RowNumber"]);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function extractRowsForMachine(raw: unknown, allowedIds: Set<string>, allowedNames: Set<string>, startMs: number, endMs: number, opts?: { skipMatch?: boolean; skipWindow?: boolean }): Row[] {
  const out: Row[] = [];
  const skipMatch = !!opts?.skipMatch;
  const skipWindow = !!opts?.skipWindow;
  const same = (v: unknown) => {
    if (skipMatch) return true;
    const s = String(v ?? "").trim();
    if (!s) return true;
    return allowedIds.has(machineKey(s)) || allowedNames.has(s.toLowerCase());
  };
  const inWin = (o: any) => skipWindow ? true : objectOverlapsWindow(o, startMs, endMs);
  let autoSeq = 0;
  walk(raw, (obj) => {
    const wos = obj?.WorksOrders ?? obj?.WorkOrders ?? obj?.worksOrders;
    const mref = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "MachineGuidID", "Machine", "MachineName", "Line", "LineName"]);
    if (!Array.isArray(wos)) return;
    if (!same(mref)) return;
    if (!inWin(obj)) return;
    for (const wo of wos) {
      if (!inWin(wo)) continue;
      const code = cleanCode(pick(wo, ["PartCode", "Part Code", "ProductCode", "SkuCode", "SKUCode", "SKU", "ItemCode", "ItemNo", "StockCode", "JobProductCode", "ProductID", "ProductId", "Code"]));
      if (!code || code.length < 2) continue;
      const description = String(pick(wo, ["Description", "LongDescription", "ProductDescription", "PartDescription", "MaterialDescription", "ShortDescription", "Name", "ProductName", "ItemName"]) ?? code).trim();
      const qty = num(pick(wo, ["OrderQty", "Order Qty", "JobOrderQuantity", "Job Order Quantity", "OrderQuantity", "RequiredQuantity", "RequiredQty", "Quantity", "Qty", "PlannedQuantity", "PlanQty", "ScheduledQty", "TargetQty", "Balance", "Demand", "Units"])) || 1;
      out.push({ code, description, qty, status: readStatus(wo), seq: readSeq(wo) || ++autoSeq });
    }
  });
  if (out.length === 0) {
    walk(raw, (obj) => {
      const mref = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "MachineGuidID", "Machine", "MachineName", "Line", "LineName"]);
      if (!same(mref)) return;
      if (!inWin(obj)) return;
      const code = cleanCode(pick(obj, ["PartCode", "Part Code", "ProductCode", "SkuCode", "SKUCode", "SKU", "ItemCode", "ItemNo", "StockCode", "FGCode", "FinishedGood", "MaterialCode", "Product", "ProductID", "ProductId", "JobProductCode", "Code"]));
      if (!code || code.length < 3 || /^(LINE|MACHINE|DATE|SHIFT|START|END|STATUS)$/i.test(code)) return;
      const qty = num(pick(obj, ["OrderQty", "Order Qty", "JobOrderQuantity", "Job Order Quantity", "OrderQuantity", "RequiredQuantity", "RequiredQty", "Required", "Quantity", "Qty", "PlannedQuantity", "PlanQty", "TargetQty", "ScheduledQty", "Balance", "Demand", "Units"])) || 1;
      const description = String(pick(obj, ["Description", "LongDescription", "ProductDescription", "PartDescription", "MaterialDescription", "ShortDescription", "Name", "ProductName", "ItemName"]) ?? code).trim();
      out.push({ code, description, qty, status: readStatus(obj), seq: readSeq(obj) || ++autoSeq });
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

    // Build list of mapped machine GUIDs — iTouching period endpoints expect
    // mapped machines in the request, and deployments vary between array body,
    // object body, query string, and per-machine report endpoints.
    const ids = (maps ?? []).map((m: any) => m.intouch_machine_id).filter(Boolean);
    const idsBody = JSON.stringify(ids);
    const objectBodies = [
      { Idents: ids },
      { MachineGUIDs: ids, StartTime: startISO, EndTime: endISO },
      { MachineIDs: ids, StartTime: startISO, EndTime: endISO },
      { machines: ids, startTime: startISO, endTime: endISO },
    ];

    const payloads: Array<{ source: string; data: unknown; forMachineId?: string }> = [];
    const debug: Array<{ path: string; method: string; status: number; ok: boolean; bytes: number; sample: unknown; err?: string }> = [];
    const pushDebug = (path: string, method: string, r: { data: unknown; status: number; ok: boolean; bytes: number; err?: string }, forMachineId?: string) => {
      let sample: unknown = null;
      if (r.data) { try { sample = JSON.stringify(r.data).slice(0, 4000); } catch { sample = null; } }
      if (debug.length < 120) debug.push({ path: path.split("?")[0], method, status: r.status, ok: r.ok, bytes: r.bytes, sample, err: r.err });
      if (r.data) payloads.push({ source: `${method} ${path.split("?")[0]}`, data: r.data, forMachineId });
    };

    // NOTE: /api/GetRunningJobs and /api/GetJobs hydration removed — they
    // return current/historical production, not the live schedule, which made
    // the planner show SKUs that did not match iTouching.

    const paths = await discoverSchedulePaths();
    for (const path of paths) {
      const hasMachinePlaceholder = /\{\s*(MachineGUID|MachineGuid|MachineID|MachineId|machineId|id|ID)\s*\}/.test(path);
      const perMachineOnly = hasMachinePlaceholder || /\/Machine\b/i.test(path) || /getscheduledjobs/i.test(path);
      if (perMachineOnly) {
        const firstId = ids[0];
        if (!firstId) continue;
        let winningTemplate: string | null = null;
        for (const q of queryVariants(path, firstId, startISO, endISO)) {
          const r = await itFetch(q, { method: "GET" });
          pushDebug(q.replace(firstId, "…"), "GET", r, firstId);
          if (r.ok && r.bytes > 2) { winningTemplate = q; break; }
        }
        if (!winningTemplate) continue;
        for (const machineId of ids.slice(1)) {
          const q = winningTemplate.replace(firstId, machineId);
          const r = await itFetch(q, { method: "GET" });
          pushDebug(q.replace(machineId, "…"), "GET", r, machineId);
        }
      } else {
        const getPath = `${path}?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`;
        pushDebug(getPath, "GET", await itFetch(getPath, { method: "GET" }));
        pushDebug(path, "POST[]", await itFetch(path, { method: "POST", body: idsBody }));
        for (const body of objectBodies) {
          const r = await itFetch(path, { method: "POST", body: JSON.stringify(body) });
          pushDebug(path, "POST{}", r);
          if (r.ok && r.bytes > 2) break;
        }
      }
    }

    const machineKeysSeen = new Set<string>();
    for (const p of payloads) {
      walk(p.data, (obj) => {
        const v = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "MachineGuidID", "Machine", "MachineName", "Line", "LineName"]);
        if (v != null) {
          const s = String(v).trim();
          if (s) machineKeysSeen.add(s);
        }
      });
    }

    // Pull SKU catalog once (Code → name/category) for enrichment.
    const { data: skuRows } = await admin
      .from("sku_products")
      .select("code, name, category")
      .eq("active", true);
    const skuByCode = new Map<string, { name: string; category: string | null }>(
      (skuRows ?? []).map((s: any) => [String(s.code).toUpperCase(), { name: s.name, category: s.category ?? null }]),
    );

    const sections: Array<{ line: string; items: any[] }> = [];
    for (const [line_id, machines] of byLine) {
      const line = lineName.get(line_id);
      if (!line) continue;
      const allowedIds = new Set(machines.map((m) => machineKey(m.id)).filter(Boolean));
      const allowedNames = new Set(machines.map((m) => (m.name ?? "").toLowerCase()).filter(Boolean));
      const merged = new Map<string, Row & { sources: Set<string> }>();
      for (const p of payloads) {
        const scoped = p.forMachineId ? allowedIds.has(machineKey(p.forMachineId)) : true;
        if (!scoped) continue;
        const opts = p.forMachineId ? { skipMatch: true, skipWindow: true } : undefined;
        for (const r of extractRowsForMachine(p.data, allowedIds, allowedNames, start.getTime(), end.getTime(), opts)) {
          // Composite key preserves multiple batches of the same SKU in the queue.
          const key = `${r.code}#${r.seq}`;
          const cur = merged.get(key);
          if (!cur) merged.set(key, { ...r, sources: new Set([p.source]) });
          else {
            cur.description = cur.description || r.description;
            cur.qty = Math.max(cur.qty, r.qty);
            if (r.status === "Running") cur.status = "Running";
            cur.sources.add(p.source);
          }
        }
      }
      if (merged.size > 0) {
        // Order: Running first, then by queue sequence.
        const ordered = Array.from(merged.values()).sort((a, b) => {
          if (a.status !== b.status) return a.status === "Running" ? -1 : 1;
          return a.seq - b.seq;
        });
        sections.push({
          line,
          items: ordered.map((r) => {
            const cat = skuByCode.get(r.code.toUpperCase());
            return {
              sku_code: r.code,
              description: cat?.name || r.description,
              qty: r.qty,
              status: r.status,
              seq: r.seq,
              catalog_match: !!cat,
              category: cat?.category ?? null,
              sources: Array.from(r.sources),
            };
          }),
        });
      }

    }

    const debugBlock = {
      endpoints: debug,
      mapped_machines: (maps ?? []).length,
      mapped_machine_ids: ids,
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
