// Sync Planner SKUs from iTouching Schedule Reports → Material Requirements → Machine.
// Falls back to schedule/current job endpoints when that report endpoint is not exposed.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  shift: z.enum(["DAY", "NIGHT"]).optional(),
  auto: z.enum(["morning", "evening"]).optional(),
  force: z.boolean().optional(),
}).strict();

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTOUCH_URL = (Deno.env.get("INTOUCH_API_URL") ?? "").replace(/\/+$/, "");
const INTOUCH_TOKEN = Deno.env.get("INTOUCH_API_TOKEN") ?? "";
const INTOUCH_AUTH_HEADER = /^bearer\s+/i.test(INTOUCH_TOKEN.trim())
  ? INTOUCH_TOKEN.trim()
  : `Bearer ${INTOUCH_TOKEN.trim()}`;

type MachineRef = { id: string; name: string };
type SkuRow = { code: string; description: string; qty: number; source: string };
type Agg = { qty: number; description: string; source: string };

const FETCH_TIMEOUT_MS = 10_000;

// ── iTouching quota helpers (shared state via intouch_quota_status table) ──
const __QUOTA_ADMIN = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const tomorrowUtcMidnight = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};
async function intouchQuotaBlockedUntil(): Promise<string | null> {
  try {
    const { data } = await __QUOTA_ADMIN
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
    await __QUOTA_ADMIN.from("intouch_quota_status").upsert({
      id: "singleton",
      blocked_until: tomorrowUtcMidnight(),
      updated_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}
class ItouchQuotaError extends Error {
  blocked_until: string;
  constructor(until: string) { super("iTouching daily quota exhausted"); this.blocked_until = until; }
}
class ItouchTimeoutError extends Error {
  constructor() { super("iTouching API timeout"); }
}

async function it(path: string, init?: RequestInit) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${INTOUCH_URL}${path}`, {
      ...init,
      signal: ac.signal,
      headers: {
        Authorization: INTOUCH_AUTH_HEADER,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    if ((e as any)?.name === "AbortError") throw new ItouchTimeoutError();
    throw e;
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  if (text.includes("Exceeded API Max daily egress")) {
    await intouchMarkEgressExceeded();
    throw new ItouchQuotaError(tomorrowUtcMidnight());
  }
  if (!res.ok) throw new Error(`iTouching ${path} ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function tryIt(path: string, init?: RequestInit) {
  try { return await it(path, init); } catch { return null; }
}


function londonOffsetMs(instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(instant).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - instant.getTime();
}

function shiftWindow(date: string, shift: "DAY" | "NIGHT") {
  const hour = shift === "DAY" ? 6 : 18;
  const naiveUtc = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  const offset = londonOffsetMs(naiveUtc);
  const start = new Date(naiveUtc.getTime() - offset);
  const end = new Date(start.getTime() + 12 * 3600 * 1000);
  return { start, end };
}

function londonDateString(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function currentLondonShift() {
  const now = new Date();
  const londonHour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
  }).format(now));

  if (londonHour >= 6 && londonHour < 18) return { session_date: londonDateString(now), shift: "DAY" as const };
  if (londonHour >= 18) return { session_date: londonDateString(now), shift: "NIGHT" as const };
  const previousLondonDay = new Date(now);
  previousLondonDay.setUTCDate(previousLondonDay.getUTCDate() - 1);
  return { session_date: londonDateString(previousLondonDay), shift: "NIGHT" as const };
}

function cleanCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/-B\d+$/i, "")
    .toUpperCase();
}

function num(value: unknown) {
  const cleaned = String(value ?? "")
    .replace(/[^\d,.-]/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "")
    .replace(/\s/g, "");
  const normalized = cleaned.includes(",") && !cleaned.includes(".") ? cleaned.replace(",", ".") : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function pick(o: any, keys: string[]) {
  for (const key of keys) {
    const v = o?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function walkObjects(value: unknown, visit: (obj: any) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visit);
    return;
  }
  visit(value);
  for (const item of Object.values(value)) walkObjects(item, visit);
}

function sameMachine(value: unknown, allowedIds: Set<string>, allowedNames: Set<string>) {
  const raw = String(value ?? "").trim();
  if (!raw) return true;
  return allowedIds.has(raw) || allowedNames.has(raw.toLowerCase());
}

function extractSkuRows(raw: unknown, source: string, machines: MachineRef[]): SkuRow[] {
  const allowedIds = new Set(machines.map((m) => m.id).filter(Boolean));
  const allowedNames = new Set(machines.map((m) => m.name.toLowerCase()).filter(Boolean));
  const rows: SkuRow[] = [];
  const seenJobs = new Set<any>();

  walkObjects(raw, (obj) => {
    const worksOrders = obj?.WorksOrders ?? obj?.WorkOrders ?? obj?.worksOrders ?? obj?.works_orders;
    if (!Array.isArray(worksOrders) || seenJobs.has(obj)) return;
    seenJobs.add(obj);
    const machineRef = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "Machine", "MachineName"]);
    if (!sameMachine(machineRef, allowedIds, allowedNames)) return;
    for (const wo of worksOrders) {
      const code = cleanCode(pick(wo, ["PartCode", "ProductCode", "SkuCode", "SKU", "ItemCode", "StockCode", "OrderNumber"]));
      if (!code || code === "UNKNOWN") continue;
      const description = String(pick(wo, ["LongDescription", "ProductDescription", "PartDescription", "Description", "ShortDescription", "Name"]) ?? code).trim();
      const qty = num(pick(wo, ["OrderQuantity", "RequiredQuantity", "RequiredQty", "Quantity", "Qty", "PlannedQuantity", "PlanQty", "Balance"])) || 1;
      rows.push({ code, description, qty, source });
    }
  });
  if (rows.length > 0) return rows;

  walkObjects(raw, (obj) => {
    const machineRef = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "Machine", "MachineName"]);
    if (!sameMachine(machineRef, allowedIds, allowedNames)) return;
    const code = cleanCode(pick(obj, [
      "PartCode", "ProductCode", "SkuCode", "SKU", "ItemCode", "StockCode", "FGCode", "FinishedGood",
      "MaterialCode", "Material", "Product", "Code",
    ]));
    if (!code || code.length < 3 || /^(LINE|MACHINE|DATE|SHIFT|START|END|STATUS)$/i.test(code)) return;
    const qty = num(pick(obj, [
      "OrderQuantity", "RequiredQuantity", "RequiredQty", "Required", "Quantity", "Qty", "PlannedQuantity", "PlanQty",
      "TargetQty", "ScheduledQty", "Balance", "Demand", "Units",
    ])) || 1;
    const description = String(pick(obj, [
      "LongDescription", "ProductDescription", "PartDescription", "MaterialDescription", "Description", "ShortDescription", "Name",
    ]) ?? code).trim();
    rows.push({ code, description, qty, source });
  });

  return rows;
}

// Extract { code -> scrap_qty } from any raw iTouching payload.
function extractScrapByCode(raw: unknown, machines: MachineRef[]): Map<string, number> {
  const allowedIds = new Set(machines.map((m) => m.id).filter(Boolean));
  const allowedNames = new Set(machines.map((m) => m.name.toLowerCase()).filter(Boolean));
  const out = new Map<string, number>();
  walkObjects(raw, (obj) => {
    const machineRef = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "Machine", "MachineName"]);
    if (!sameMachine(machineRef, allowedIds, allowedNames)) return;
    const code = cleanCode(pick(obj, ["PartCode", "ProductCode", "SkuCode", "SKU", "ItemCode", "StockCode", "OrderNumber"]));
    if (!code || code.length < 2) return;
    const scrap = num(pick(obj, [
      "Scrap", "ScrapQty", "ScrapQuantity", "ScrapCount", "Reject", "RejectQty", "Rejected", "Bad", "BadQty", "BadCount", "Waste",
    ]));
    if (scrap <= 0) return;
    out.set(code, Math.max(out.get(code) ?? 0, scrap));
  });
  return out;
}

// Extract aggregate run/down/oee per machine from any iTouching shift payload.
function extractShiftMetrics(raw: unknown, machines: MachineRef[]) {
  const allowedIds = new Set(machines.map((m) => m.id).filter(Boolean));
  const allowedNames = new Set(machines.map((m) => m.name.toLowerCase()).filter(Boolean));
  let runMin = 0, downMin = 0, oeeSum = 0, oeeN = 0;
  walkObjects(raw, (obj) => {
    const machineRef = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "Machine", "MachineName"]);
    if (!sameMachine(machineRef, allowedIds, allowedNames)) return;
    const r = num(pick(obj, ["RunTime", "RunTimeMin", "RunTimeMinutes", "Running", "RunningMin", "UpTime", "UpTimeMin"]));
    const d = num(pick(obj, ["DownTime", "DownTimeMin", "DownTimeMinutes", "Downtime", "DowntimeMin", "StoppedTime", "StoppedMin"]));
    const o = num(pick(obj, ["OEE", "Oee", "OEEPct", "OeePct", "OEE_Percent", "OverallEquipmentEffectiveness"]));
    if (r > 0) runMin += r;
    if (d > 0) downMin += d;
    if (o > 0) { oeeSum += o; oeeN += 1; }
  });
  // Normalise OEE to a 0-100 scale when iTouching returns 0-1.
  let oee: number | null = null;
  if (oeeN > 0) {
    const avg = oeeSum / oeeN;
    oee = avg <= 1 ? Math.round(avg * 1000) / 10 : Math.round(avg * 10) / 10;
  }
  return { runMin, downMin, oee };
}

function extractActualsByCode(raw: unknown, machines: MachineRef[]): Map<string, number> {
  const allowedIds = new Set(machines.map((m) => m.id).filter(Boolean));
  const allowedNames = new Set(machines.map((m) => m.name.toLowerCase()).filter(Boolean));
  const out = new Map<string, number>();
  walkObjects(raw, (obj) => {
    const machineRef = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "Machine", "MachineName"]);
    if (!sameMachine(machineRef, allowedIds, allowedNames)) return;
    const code = cleanCode(pick(obj, [
      "PartCode", "ProductCode", "SkuCode", "SKU", "ItemCode", "StockCode", "OrderNumber",
    ]));
    if (!code || code.length < 2) return;
    const produced = num(pick(obj, [
      "Good", "GoodQty", "GoodQuantity", "GoodCount",
      "Produced", "ProducedQty", "ProducedQuantity", "ProducedCount",
      "ActualQty", "ActualQuantity", "Actual", "Output", "OutputQty",
      "TotalProduced", "QuantityProduced",
    ]));
    if (produced <= 0) return;
    out.set(code, Math.max(out.get(code) ?? 0, produced));
  });
  return out;
}

// Sum any "Good / Produced" values for the allowed machines regardless of SKU
// code matching. Fallback used when iTouching SKU codes don't line up with
// our local sku_products.code so the operator UI always shows a live Actual.
function extractLineGoodTotal(raw: unknown, machines: MachineRef[]): number {
  const allowedIds = new Set(machines.map((m) => m.id).filter(Boolean));
  const allowedNames = new Set(machines.map((m) => m.name.toLowerCase()).filter(Boolean));
  const perMachine = new Map<string, number>();
  walkObjects(raw, (obj) => {
    const machineRef = pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid", "Machine", "MachineName"]);
    if (!sameMachine(machineRef, allowedIds, allowedNames)) return;
    const produced = num(pick(obj, [
      "Good", "GoodQty", "GoodQuantity", "GoodCount",
      "Produced", "ProducedQty", "ProducedQuantity", "ProducedCount",
      "ActualQty", "ActualQuantity", "Actual", "Output", "OutputQty",
      "TotalProduced", "QuantityProduced",
    ]));
    if (produced <= 0) return;
    const key = String(machineRef ?? "_").trim().toLowerCase();
    // Counts are cumulative within the shift — keep the highest reading per machine.
    perMachine.set(key, Math.max(perMachine.get(key) ?? 0, produced));
  });
  let total = 0;
  for (const v of perMachine.values()) total += v;
  return total;
}

async function fetchActualsForLine(machines: MachineRef[], startISO: string, endISO: string) {
  const ids = machines.map((m) => m.id);
  const merged = new Map<string, number>();
  const scrap = new Map<string, number>();
  let runMin = 0, downMin = 0, oeeSum = 0, oeeN = 0;
  let lineGood = 0;
  const merge = (m: Map<string, number>) => {
    for (const [k, v] of m) merged.set(k, Math.max(merged.get(k) ?? 0, v));
  };
  const mergeScrap = (m: Map<string, number>) => {
    for (const [k, v] of m) scrap.set(k, Math.max(scrap.get(k) ?? 0, v));
  };
  const mergeMetrics = (raw: unknown) => {
    const m = extractShiftMetrics(raw, machines);
    runMin += m.runMin;
    downMin += m.downMin;
    if (m.oee !== null) { oeeSum += m.oee; oeeN += 1; }
  };
  const mergeLineGood = (raw: unknown) => {
    const t = extractLineGoodTotal(raw, machines);
    if (t > lineGood) lineGood = t;
  };

  // Running jobs (current SKU + live counts)
  const running = await tryIt("/api/GetRunningJobs", { method: "GET" });
  merge(extractActualsByCode(running, machines));
  mergeScrap(extractScrapByCode(running, machines));
  mergeMetrics(running);
  mergeLineGood(running);
  // Hydrate full job records if running returns only IDs
  const jobIds = new Set<string>();
  walkObjects(running, (obj) => {
    const mid = String(pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid"]) ?? "").trim();
    const jid = String(pick(obj, ["JobID", "JobId", "JobGUID", "JobGuid", "ID", "Id"]) ?? "").trim();
    if (mid && jid && ids.includes(mid)) jobIds.add(jid);
  });
  if (jobIds.size > 0) {
    const jobs = await tryIt("/api/GetJobs", { method: "POST", body: JSON.stringify(Array.from(jobIds)) });
    merge(extractActualsByCode(jobs, machines));
    mergeScrap(extractScrapByCode(jobs, machines));
    mergeMetrics(jobs);
    mergeLineGood(jobs);
  }

  // Jobs ran during the shift window (historical actuals)
  const ranAttempts = [
    () => tryIt(`/api/GetJobsRan?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }),
    () => tryIt("/api/GetJobsRan", { method: "POST", body: JSON.stringify({ MachineGUIDs: ids, StartTime: startISO, EndTime: endISO }) }),
    () => tryIt(`/api/GetJobsRanDuringPeriod?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }),
  ];
  for (const attempt of ranAttempts) {
    const raw = await attempt();
    if (raw) {
      merge(extractActualsByCode(raw, machines));
      mergeScrap(extractScrapByCode(raw, machines));
      mergeMetrics(raw);
      mergeLineGood(raw);
    }
  }

  // Aggregate shift-level OEE / run / down explicitly when iTouching exposes them.
  const shiftStatsAttempts = [
    () => tryIt(`/api/GetShiftReport?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }),
    () => tryIt(`/api/GetMachineKPIs?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }),
    () => tryIt(`/api/GetOEE?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }),
  ];
  for (const attempt of shiftStatsAttempts) {
    const raw = await attempt();
    if (raw) { mergeMetrics(raw); mergeLineGood(raw); }
  }

  const oee = oeeN > 0 ? Math.round((oeeSum / oeeN) * 10) / 10 : null;
  return { actuals: merged, scrap, lineGood, metrics: { runMin, downMin, oee } };
}

function aggregateRows(rows: SkuRow[]) {
  const skuAgg = new Map<string, Agg>();
  for (const row of rows) {
    const cur = skuAgg.get(row.code) ?? { qty: 0, description: row.description, source: row.source };
    cur.qty += Math.max(1, row.qty || 0);
    if (!cur.description || cur.description === row.code) cur.description = row.description;
    cur.source = cur.source === row.source ? cur.source : `${cur.source}+${row.source}`;
    skuAgg.set(row.code, cur);
  }
  return skuAgg;
}

async function discoverMaterialPaths() {
  // Fixed shortlist — skip /swagger discovery (slow + large payloads, often 400 egress).
  return [
    "/api/ScheduleReports/MaterialRequirements/Machine",
    "/api/GetMaterialRequirementsByMachine",
    "/api/MaterialRequirements/Machine",
  ];
}

function fillPath(path: string, machineId: string) {
  return path.replace(/\{\s*(MachineGUID|MachineGuid|MachineID|MachineId|machineId|id|ID)\s*\}/g, encodeURIComponent(machineId));
}

async function fetchMaterialRows(machines: MachineRef[], startISO: string, endISO: string) {
  const paths = await discoverMaterialPaths();
  const ids = machines.map((m) => m.id);
  for (const path of paths) {
    const allRows: SkuRow[] = [];
    for (const m of machines) {
      const base = fillPath(path, m.id);
      // Single canonical variant per machine — keeps egress + latency bounded.
      const raw = await tryIt(
        `${base}?MachineGUID=${encodeURIComponent(m.id)}&StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`,
        { method: "GET" },
      );
      const rows = extractSkuRows(raw, "material_requirements", [m]);
      if (rows.length) allRows.push(...rows);
    }
    if (allRows.length === 0) {
      const raw = await tryIt(path, {
        method: "POST",
        body: JSON.stringify({ MachineGUIDs: ids, StartTime: startISO, EndTime: endISO }),
      });
      allRows.push(...extractSkuRows(raw, "material_requirements", machines));
    }
    if (allRows.length) return { rows: allRows, sourcePath: path };
  }
  return { rows: [] as SkuRow[], sourcePath: "" };
}


async function fetchJobChangeRows(machines: MachineRef[], startISO: string, endISO: string) {
  const ids = machines.map((m) => m.id);
  const attempts = [
    () => tryIt(`/api/JobChange?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }),
    () => tryIt("/api/JobChange", { method: "POST", body: JSON.stringify({ MachineGUIDs: ids, StartTime: startISO, EndTime: endISO }) }),
    () => tryIt("/api/JobChange", { method: "POST", body: JSON.stringify({ MachineIDs: ids, StartTime: startISO, EndTime: endISO }) }),
  ];
  for (const attempt of attempts) {
    const raw = await attempt();
    const rows = extractSkuRows(raw, "job_change", machines);
    if (rows.length) return rows;
  }
  return [];
}

async function fetchRunningJobRows(machines: MachineRef[]) {
  const running = await tryIt("/api/GetRunningJobs", { method: "GET" });
  const allowedIds = new Set(machines.map((m) => m.id));
  const jobIds = new Set<string>();
  walkObjects(running, (obj) => {
    const machineId = String(pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid"]) ?? "").trim();
    const jobId = String(pick(obj, ["JobID", "JobId", "JobGUID", "JobGuid", "ID", "Id"]) ?? "").trim();
    if (machineId && allowedIds.has(machineId) && jobId) jobIds.add(jobId);
  });
  if (jobIds.size === 0) return [];
  const raw = await tryIt("/api/GetJobs", { method: "POST", body: JSON.stringify(Array.from(jobIds)) });
  return extractSkuRows(raw, "running_jobs", machines);
}

async function fetchJobsRanRows(machines: MachineRef[], startISO: string, endISO: string) {
  const ids = machines.map((m) => m.id);
  const attempts = [
    () => tryIt(`/api/GetJobsRan?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }),
    () => tryIt("/api/GetJobsRan", { method: "POST", body: JSON.stringify({ MachineGUIDs: ids, StartTime: startISO, EndTime: endISO }) }),
    () => tryIt(`/api/GetJobsRanDuringPeriod?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }),
  ];
  for (const attempt of attempts) {
    const raw = await attempt();
    const rows = extractSkuRows(raw, "jobs_ran", machines);
    if (rows.length) return rows;
  }
  return [];
}

async function fetchSkuRowsForLine(machines: MachineRef[], startISO: string, endISO: string) {
  // Per-line time budget — never let the schedule probe stall the whole sync.
  const BUDGET_MS = 12_000;
  const run = (async () => {
    const material = await fetchMaterialRows(machines, startISO, endISO);
    if (material.rows.length) return { rows: material.rows, source: material.sourcePath || "material_requirements" };

    const jobChange = await fetchJobChangeRows(machines, startISO, endISO);
    if (jobChange.length) return { rows: jobChange, source: "job_change" };

    const running = await fetchRunningJobRows(machines);
    if (running.length) return { rows: running, source: "running_jobs" };

    const ran = await fetchJobsRanRows(machines, startISO, endISO);
    if (ran.length) return { rows: ran, source: "jobs_ran" };

    return { rows: [] as SkuRow[], source: "none" };
  })();
  const timeout = new Promise<{ rows: SkuRow[]; source: string }>((resolve) =>
    setTimeout(() => resolve({ rows: [], source: "timeout" }), BUDGET_MS),
  );
  return await Promise.race([run, timeout]);
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  let runId: string | null = null;
  let triggerSource = "manual";
  try {
    if (!INTOUCH_URL || !INTOUCH_TOKEN) throw new Error("Missing INTOUCH_API_URL/TOKEN");

    const CRON_SECRET = Deno.env.get("CRON_TRIGGER_TOKEN") ?? Deno.env.get("CRON_SECRET") ?? "";
    const providedCron = req.headers.get("x-cron-secret") ?? "";
    const isCron = !!CRON_SECRET && providedCron === CRON_SECRET;
    if (isCron) triggerSource = "cron";

    if (!isCron) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const anonClient = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
      const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(token);
      const userId = claimsData?.claims?.sub as string | undefined;
      if (claimsErr || !userId) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
      const ok = (roles ?? []).some((r) => ["admin", "manager"].includes(r.role));
      if (!ok) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Log run start AFTER auth so failed-auth invocations don't leave "running" rows behind.
    try {
      const { data: runRow } = await admin
        .from("intouch_sync_runs")
        .insert({ function_name: "intouch-sync-production", status: "running", trigger_source: triggerSource })
        .select("id")
        .maybeSingle();
      runId = runRow?.id ?? null;
    } catch { /* ignore */ }


    const rawBody = await req.json().catch(() => ({}));
    const parsedBody = BodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return new Response(JSON.stringify({ error: parsedBody.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsedBody.data;

    const explicitPlannerSync = !!body.session_date && !!body.shift;
    const { data: settings } = await admin
      .from("system_settings")
      .select("intouch_sync_enabled")
      .limit(1)
      .maybeSingle();
    if (settings && settings.intouch_sync_enabled === false && !explicitPlannerSync) {
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "intouch_current_shift_sync_disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let session_date: string | undefined = body.session_date;
    let shift: "DAY" | "NIGHT" | undefined = body.shift;
    if (isCron && (!session_date || !shift)) {
      const auto = body.auto;
      const londonNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" }));
      if (auto === "morning") {
        const y = new Date(londonNow); y.setDate(y.getDate() - 1);
        session_date = y.toISOString().slice(0, 10);
        shift = "NIGHT";
      } else {
        session_date = londonNow.toISOString().slice(0, 10);
        shift = "DAY";
      }
    }
    if (!isCron && body.force === true && (!session_date || !shift)) {
      const current = currentLondonShift();
      session_date = current.session_date;
      shift = current.shift;
    }
    if (!session_date || !shift) {
      return new Response(JSON.stringify({ error: "session_date and shift (DAY|NIGHT) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { start, end } = shiftWindow(session_date, shift);
    const nowDate = new Date();
    const effectiveEnd = nowDate < end ? nowDate : end;
    const startISO = start.toISOString();
    const endISO = effectiveEnd.toISOString();

    const { data: maps } = await admin
      .from("intouch_machine_map")
      .select("intouch_machine_id, intouch_machine_name, line_id")
      .eq("active", true)
      .not("line_id", "is", null);

    const { data: lines } = await admin.from("lines").select("id, name");
    const lineName = new Map((lines ?? []).map((l: any) => [l.id, l.name]));

    const byLine = new Map<string, MachineRef[]>();
    for (const m of maps ?? []) {
      const arr = byLine.get(m.line_id!) ?? [];
      arr.push({ id: m.intouch_machine_id, name: m.intouch_machine_name ?? "" });
      byLine.set(m.line_id!, arr);
    }

    const { data: ragRows } = await admin
      .from("rag_weekly_entries")
      .select("line, plan_qty")
      .eq("entry_date", session_date)
      .eq("shift", shift)
      .gt("plan_qty", 0);
    const ragPlanByLine = new Map((ragRows ?? []).map((r: any) => [String(r.line ?? "").trim(), Number(r.plan_qty ?? 0)]));

    const results: any[] = [];
    for (const [line_id, machines] of byLine) {
      const line = lineName.get(line_id);
      if (!line) continue;

      const ragPlan = Number(ragPlanByLine.get(line) ?? 0);
      if (ragPlan <= 0) {
        results.push({ line, skipped: "no RAG Weekly plan" });
        continue;
      }

      const { rows: skuRows, source } = await fetchSkuRowsForLine(machines, startISO, endISO);
      const skuAgg = aggregateRows(skuRows);

      // Fallback path: no SKU schedule from iTouching, but the machines are
      // reporting live "Good" production. Create/keep a single synthetic
      // "Live Production" row so the operator screen still shows Actual.
      if (skuAgg.size === 0) {
        const live = await fetchActualsForLine(machines, startISO, endISO);
        if (!(live.lineGood > 0)) {
          results.push({ line, skipped: "no Material Requirements / schedule SKUs found" });
          continue;
        }
        const liveCode = `LIVE-${line}`.toUpperCase().replace(/\s+/g, "-").slice(0, 60);
        await admin.from("sku_products").upsert(
          [{ code: liveCode, name: `Live Production — ${line}`, active: true }],
          { onConflict: "code", ignoreDuplicates: true },
        );
        const { data: liveSku } = await admin
          .from("sku_products").select("id").eq("code", liveCode).maybeSingle();
        if (!liveSku?.id) {
          results.push({ line, skipped: "live sku upsert failed" });
          continue;
        }
        const { data: session, error: sErr } = await admin
          .from("production_sessions")
          .upsert(
            { session_date, line, shift, notes: `[Auto-synced from iTouching — live_good]` },
            { onConflict: "session_date,line,shift" },
          )
          .select("id, locked").single();
        if (sErr) throw sErr;
        if (session.locked) { results.push({ line, skipped: "session locked" }); continue; }

        const { data: prevItem } = await admin
          .from("production_items").select("actual_qty")
          .eq("session_id", session.id).eq("sku_id", liveSku.id).maybeSingle();
        const prevQty = Number(prevItem?.actual_qty ?? 0);
        const actual = Math.max(prevQty, Math.round(live.lineGood));

        await admin.from("production_items").delete().eq("session_id", session.id);
        await admin.from("production_items").insert([{
          session_id: session.id,
          sku_id: liveSku.id,
          target_qty: ragPlan,
          planned_qty: ragPlan,
          actual_qty: actual,
          scrap_qty: 0,
          notes: `itouching:live_good`,
        }]);

        results.push({ line, skus: 1, rag_plan: ragPlan, source: "live_good", actual_preserved: actual });
        continue;
      }

      const codes = Array.from(skuAgg.keys());
      const { data: existingSkus } = await admin
        .from("sku_products").select("id, code").in("code", codes);
      const have = new Set((existingSkus ?? []).map((s: any) => s.code));
      const toInsert = codes
        .filter((c) => !have.has(c))
        .map((c) => ({ code: c, name: skuAgg.get(c)!.description.slice(0, 200), active: true }));
      if (toInsert.length) {
        await admin.from("sku_products")
          .upsert(toInsert, { onConflict: "code", ignoreDuplicates: true });
      }
      const { data: allSkus } = await admin
        .from("sku_products").select("id, code").in("code", codes);
      const idByCode = new Map((allSkus ?? []).map((s: any) => [s.code, s.id]));

      const { data: session, error: sErr } = await admin
        .from("production_sessions")
        .upsert(
          { session_date, line, shift, notes: `[Auto-synced from iTouching — ${source}]` },
          { onConflict: "session_date,line,shift" },
        )
        .select("id, locked").single();
      if (sErr) throw sErr;
      if (session.locked) {
        results.push({ line, skipped: "session locked" });
        continue;
      }

      const { data: existingItems } = await admin
        .from("production_items")
        .select("sku_id, actual_qty, target_qty, target_manual_at")
        .eq("session_id", session.id);
      const actualBySku = new Map(
        (existingItems ?? []).map((r: any) => [r.sku_id, Number(r.actual_qty) || 0]),
      );
      // Preserve manually-edited targets so sync never overwrites them.
      const manualTargetBySku = new Map(
        (existingItems ?? [])
          .filter((r: any) => r.target_manual_at)
          .map((r: any) => [r.sku_id, Number(r.target_qty) || 0]),
      );

      await admin.from("production_items").delete().eq("session_id", session.id);

      // Pull live actuals + scrap + shift metrics (run/down/OEE) per SKU from iTouching.
      const { actuals: actualsByCode, scrap: scrapByCode, lineGood, metrics } = await fetchActualsForLine(machines, startISO, endISO);

      const entries = Array.from(skuAgg.entries());
      const totalQty = entries.reduce((sum, [, a]) => sum + Math.max(1, Number(a.qty) || 0), 0) || 1;
      // Sum of per-SKU iTouching actuals matched by code.
      const matchedActualTotal = entries.reduce(
        (s, [code]) => s + Math.round(actualsByCode.get(code) ?? 0), 0,
      );
      // When SKU-code matching produces nothing but iTouching reports a
      // line-level Good total, split it proportionally to the plan so the
      // operator always sees a live Actual under Target.
      const useLineFallback = matchedActualTotal === 0 && lineGood > 0;
      const rows = entries
        .map(([code, a]) => {
          const weight = Math.max(1, Number(a.qty) || 0) / totalQty;
          const planAuto = Math.round(ragPlan * weight);
          const sku_id = idByCode.get(code);
          const itouchActual = useLineFallback
            ? Math.round(lineGood * weight)
            : Math.round(actualsByCode.get(code) ?? 0);
          const prev = sku_id ? (actualBySku.get(sku_id) ?? 0) : 0;
          // Never let an automatic sync drive the actual backwards (covers
          // manual edits + cumulative iTouching counts that may dip).
          const actual = Math.max(prev, itouchActual);
          const manualTarget = sku_id ? manualTargetBySku.get(sku_id) : undefined;
          const plan = manualTarget != null ? manualTarget : planAuto;
          const scrap_qty = Math.round(scrapByCode.get(code) ?? 0);
          return {
            session_id: session.id,
            sku_id,
            target_qty: plan,
            planned_qty: plan,
            actual_qty: actual,
            scrap_qty,
            target_manual_at: manualTarget != null ? new Date().toISOString() : null,
            notes: `itouching:${source}${useLineFallback ? "+line_good" : ""}${manualTarget != null ? "+manual_target" : ""}`,
          };
        })
        .filter((r) => r.sku_id);
      if (rows.length) await admin.from("production_items").insert(rows);

      // Persist shift-level OEE / run / down to the session row.
      const hasAnyMetric = metrics.runMin > 0 || metrics.downMin > 0 || metrics.oee !== null;
      if (hasAnyMetric) {
        await admin.from("production_sessions").update({
          run_time_min: metrics.runMin > 0 ? Math.round(metrics.runMin) : null,
          down_time_min: metrics.downMin > 0 ? Math.round(metrics.downMin) : null,
          oee_pct: metrics.oee,
          metrics_synced_at: new Date().toISOString(),
        }).eq("id", session.id);
      }

      results.push({
        line,
        skus: rows.length,
        rag_plan: ragPlan,
        source,
        actual_preserved: rows.reduce((s, r) => s + r.actual_qty, 0),
        scrap_total: rows.reduce((s, r) => s + r.scrap_qty, 0),
        run_min: metrics.runMin || null,
        down_min: metrics.downMin || null,
        oee: metrics.oee,
      });
    }

    const syncedLines = results.filter((r) => !r.skipped).length;
    const syncedSkus = results.reduce((sum, r) => sum + Number(r.skus ?? 0), 0);

    if (runId) {
      try {
        await admin.from("intouch_sync_runs").update({
          status: "success",
          finished_at: new Date().toISOString(),
          details: { synced_lines: syncedLines, synced_skus: syncedSkus, session_date, shift },
        }).eq("id", runId);
      } catch { /* ignore */ }
    }

    return new Response(JSON.stringify({ ok: true, session_date, shift,
      summary: `${syncedLines} lines · ${syncedSkus} SKUs`,
      window: { start: startISO, end: endISO }, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (runId) {
      try {
        await admin.from("intouch_sync_runs").update({
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: msg.slice(0, 2000),
        }).eq("id", runId);
      } catch { /* ignore */ }
    }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
