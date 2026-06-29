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
  line: z.string().trim().min(1).max(120).optional(),
  debug_discover: z.boolean().optional(),
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
type SkuRow = { code: string; description: string; qty: number; source: string; batch: string; actual: number };
type Agg = { qty: number; description: string; source: string; batch: string; actual: number };

const FETCH_TIMEOUT_MS = 10_000;
const MACHINE_REF_KEYS = [
  "MachineID", "MachineId", "MachineGUID", "MachineGuid", "MachineGuidID", "Machine Guid", "Machine ID",
  "Machine", "MachineName", "Line", "LineName",
];
const GOOD_QTY_KEYS = [
  "Good", "GoodQty", "Good Qty", "GoodQuantity", "Good Count", "GoodCount", "GoodUnits", "GoodUnitsProduced",
  "GoodProduct", "GoodProductCount", "GoodQuantityProduced", "QtyGood", "QuantityGood", "TotalGood", "TotalGoodQty",
  "TotalGoodQuantity", "ProducedGood", "ProducedGoodQty", "Produced Good", "Produced Good Qty", "GoodPacks",
  "CurrentShift", "CurrentShiftQty", "CurrentShiftQuantity", "CurrentShiftGood", "ShiftGood", "ShiftGoodQty",
  "CurrentShiftProduced", "CurrentShiftOutput", "CurrentShiftCount", "CurrentShiftTotal", "TotalCurrentShift",
  "Produced", "ProducedQty", "ProducedQuantity", "ProducedCount", "QuantityProduced",
  "ActualQty", "ActualQuantity", "Actual", "Output", "OutputQty", "TotalProduced", "CompletedQuantity",
  "CompletedQty", "AlreadyMade", "QuantityMade", "MadeQuantity", "Made", "MadeQty", "Done", "DoneQty",
  "Completed", "CompletedCount", "QtyCompleted", "QuantityCompleted", "TotalCompleted", "QtyComplete",
  "Production", "ProductionQty", "ProductionQuantity", "ProductionCount", "ProductionTotal",
  "NetProduction", "NetProductionQty", "NetQuantity", "NetQty", "Accepted", "AcceptedQty",
  "AcceptedQuantity", "Packed", "PackedQty", "PackCount", "UnitCount", "UnitsMade", "UnitsProduced", "CountGood",
  "Counter", "CounterValue", "GoodCounter", "CurrentCount", "ShiftCounter", "ShiftOutput", "ShiftTotal", "ShiftCount",
];

function logSync(event: string, details: Record<string, unknown>) {
  try {
    console.log(`[intouch-sync-production] ${event}`, JSON.stringify(details).slice(0, 3000));
  } catch {
    console.log(`[intouch-sync-production] ${event}`);
  }
}

function logSyncChunks(event: string, details: Record<string, unknown>, maxChars = 16_000) {
  let payload = "";
  try {
    payload = JSON.stringify(details).slice(0, maxChars);
  } catch {
    payload = String(details).slice(0, maxChars);
  }
  const chunkSize = 2800;
  const total = Math.max(1, Math.ceil(payload.length / chunkSize));
  for (let i = 0; i < total; i += 1) {
    console.log(`[intouch-sync-production] ${event}`, JSON.stringify({
      chunk: i + 1,
      chunks: total,
      data: payload.slice(i * chunkSize, (i + 1) * chunkSize),
    }));
  }
}

function sanitizedIntouchBaseUrl() {
  try {
    const u = new URL(INTOUCH_URL);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return INTOUCH_URL.replace(/\/\/[^/@]+@/, "//***@").split(/[?#]/)[0].replace(/\/+$/, "");
  }
}

function warnSync(event: string, details: Record<string, unknown>) {
  try {
    console.warn(`[intouch-sync-production] ${event}`, JSON.stringify(details).slice(0, 3000));
  } catch {
    console.warn(`[intouch-sync-production] ${event}`);
  }
}

function pathOnly(path: string) {
  return path.split("?")[0];
}

function safeStageName(path: string) {
  return pathOnly(path).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "unknown";
}

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

async function tryIt(path: string, init?: RequestInit, debug?: { stage: string; line?: string; machines?: MachineRef[]; raw?: boolean }) {
  try {
    const raw = await it(path, init);
    if (debug) {
      logSync("itouch_response", {
        stage: debug.stage,
        line: debug.line ?? null,
        path: pathOnly(path),
        method: init?.method ?? "GET",
        stats: inspectPayload(raw, debug.machines),
      });
      if (debug.raw) {
        logSyncChunks("itouch_response_raw", {
          stage: debug.stage,
          line: debug.line ?? null,
          path: pathOnly(path),
          method: init?.method ?? "GET",
          raw,
        });
      }
    }
    return raw;
  } catch (e) {
    if (debug) {
      warnSync("itouch_request_failed", {
        stage: debug.stage,
        line: debug.line ?? null,
        path: pathOnly(path),
        method: init?.method ?? "GET",
        error: (e as Error).message,
      });
    }
    return null;
  }
}

async function discoverLiveProductionPaths() {
  const defaults = [
    "/api/appapi/getproduction",
    "/api/appapi/getproductioncounts",
    "/api/appapi/getmachineproduction",
    "/api/GetProduction",
    "/api/GetProductionCounts",
    "/api/GetMachineProduction",
    "/api/GetProductionReport",
    "/api/GetMachineProductionReport",
    "/api/GetImpressions",
    "/api/GetMachineImpressions",
    "/api/Production",
    "/api/ProductionReport",
  ];
  let discovered: string[] = [];
  try {
    const docs = await it("/swagger/docs/v1", { method: "GET" });
    const paths = (docs as any)?.paths;
    if (paths && typeof paths === "object") {
      discovered = Object.keys(paths).filter((p) => {
        const n = p.toLowerCase();
        if (!(n.includes("production") || n.includes("impression") || n.includes("count") || n.includes("actual") || n.includes("good"))) return false;
        if (n.includes("product") && !n.includes("production")) return false;
        if (n.includes("schedule") || n.includes("material") || n.includes("downtime") || n.includes("login")) return false;
        return true;
      });
    }
  } catch (e) {
    warnSync("live_path_discovery_failed", { error: (e as Error).message });
  }
  return Array.from(new Set([...discovered, ...defaults])).slice(0, 12);
}

function liveProductionRequests(path: string, ids: string[], startISO: string, endISO: string) {
  const firstId = ids[0];
  const base = firstId ? fillPath(path, firstId) : path;
  const requests: Array<{ path: string; init: RequestInit }> = [];
  if (firstId) {
    const queryPairs = [
      ["MachineID", firstId],
      ["MachineId", firstId],
      ["machineId", firstId],
      ["MachineGUID", firstId],
      ["MachineGuid", firstId],
      ["machineGuid", firstId],
      ["machine", firstId],
    ];
    for (const [key, value] of queryPairs) {
      requests.push({
        path: `${base}?${key}=${encodeURIComponent(value)}&StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`,
        init: { method: "GET" },
      });
    }
    requests.push({
      path: `${base}?MachineID=${encodeURIComponent(firstId)}&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`,
      init: { method: "GET" },
    });
    requests.push({
      path: `${base}?MachineID=${encodeURIComponent(firstId)}`,
      init: { method: "GET" },
    });
    requests.push({ path: base, init: { method: "POST", body: JSON.stringify({ MachineID: firstId, StartTime: startISO, EndTime: endISO }) } });
    requests.push({ path: base, init: { method: "POST", body: JSON.stringify({ MachineId: firstId, StartTime: startISO, EndTime: endISO }) } });
    requests.push({ path: base, init: { method: "POST", body: JSON.stringify({ machineId: firstId, startTime: startISO, endTime: endISO }) } });
    requests.push({ path: base, init: { method: "POST", body: JSON.stringify({ MachineGUID: firstId, StartTime: startISO, EndTime: endISO }) } });
    requests.push({ path: base, init: { method: "POST", body: JSON.stringify({ MachineGuid: firstId, StartTime: startISO, EndTime: endISO }) } });
  }
  requests.push({ path: base, init: { method: "POST", body: JSON.stringify(ids) } });
  requests.push({ path: base, init: { method: "POST", body: JSON.stringify({ MachineGUIDs: ids, StartTime: startISO, EndTime: endISO }) } });
  requests.push({ path: base, init: { method: "POST", body: JSON.stringify({ MachineIDs: ids, StartTime: startISO, EndTime: endISO }) } });
  return requests;
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
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) {
    return value.reduce((max, item) => Math.max(max, num(item)), 0);
  }
  if (value && typeof value === "object") {
    const nested = pick(value as any, [
      "Value", "value", "Qty", "qty", "Quantity", "quantity", "Count", "count", "Amount", "amount",
      "Total", "total", "Actual", "actual", "Good", "good", "Produced", "produced", "AlreadyMade", "alreadyMade",
    ]);
    if (nested !== undefined) return num(nested);
    return 0;
  }
  const raw = String(value ?? "").trim();
  const firstNumber = raw.match(/-?\d[\d,\.\s]*/)?.[0] ?? raw;
  const cleaned = firstNumber
    .replace(/[^\d,.-]/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "")
    .replace(/\s/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(",", ".");
  }
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

function walkObjectsWithMachine(value: unknown, inheritedMachineRef: unknown, visit: (obj: any, machineRef: unknown) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkObjectsWithMachine(item, inheritedMachineRef, visit);
    return;
  }
  const currentMachineRef = pick(value as any, MACHINE_REF_KEYS) ?? inheritedMachineRef;
  visit(value, currentMachineRef);
  for (const item of Object.values(value)) walkObjectsWithMachine(item, currentMachineRef, visit);
}

function sameMachine(value: unknown, allowedIds: Set<string>, allowedNames: Set<string>) {
  const raw = String(value ?? "").trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  return allowedIds.has(lower) || allowedNames.has(lower);
}

function inspectPayload(raw: unknown, machines?: MachineRef[]) {
  const allowedIds = new Set((machines ?? []).map((m) => (m.id || "").toLowerCase()).filter(Boolean));
  const allowedNames = new Set((machines ?? []).map((m) => m.name.toLowerCase()).filter(Boolean));
  let objects = 0;
  let machineRefs = 0;
  let matchedMachineRefs = 0;
  let goodFieldHits = 0;
  const goodFields = new Set<string>();
  const samples: Array<{ machineRef: string; matched: boolean; field: string; raw: string; parsed: number }> = [];
  const matchedNumericSamples: Array<{ machineRef: string; keys: Record<string, number | string> }> = [];
  walkObjectsWithMachine(raw, null, (obj, inheritedMachineRef) => {
    objects += 1;
    const machineRef = pick(obj, MACHINE_REF_KEYS) ?? inheritedMachineRef;
    const matched = machines ? sameMachine(machineRef, allowedIds, allowedNames) : true;
    if (machineRef != null && String(machineRef).trim() !== "") {
      machineRefs += 1;
      if (matched) matchedMachineRefs += 1;
    }
    if (matched && matchedNumericSamples.length < 6) {
      const keys: Record<string, number | string> = {};
      for (const [key, rawValue] of Object.entries(obj)) {
        if (rawValue == null || typeof rawValue === "object") continue;
        if (/id|guid|token|hash|password|pin/i.test(key)) continue;
        const parsed = num(rawValue);
        if (parsed > 0 || /qty|quant|good|made|count|total|actual|prod|complete|shift|output|units|balance|target|plan/i.test(key)) {
          keys[key] = Number.isFinite(parsed) && parsed !== 0 ? parsed : String(rawValue).slice(0, 80);
        }
        if (Object.keys(keys).length >= 20) break;
      }
      if (Object.keys(keys).length > 0) {
        matchedNumericSamples.push({ machineRef: String(machineRef ?? "").slice(0, 80), keys });
      }
    }
    for (const key of GOOD_QTY_KEYS) {
      if (obj?.[key] !== undefined && obj?.[key] !== null && String(obj[key]).trim() !== "") {
        goodFieldHits += 1;
        goodFields.add(key);
        if (samples.length < 8) {
          const rawValue = obj[key];
          samples.push({
            machineRef: String(machineRef ?? "").slice(0, 80),
            matched,
            field: key,
            raw: typeof rawValue === "object" ? JSON.stringify(rawValue).slice(0, 160) : String(rawValue).slice(0, 160),
            parsed: num(rawValue),
          });
        }
      }
    }
  });
  return {
    objects,
    machine_refs: machineRefs,
    matched_machine_refs: matchedMachineRefs,
    good_field_hits: goodFieldHits,
    good_fields: Array.from(goodFields).slice(0, 20),
    good_samples: samples,
    matched_numeric_samples: matchedNumericSamples,
    extracted_line_good: machines ? extractLineGoodTotal(raw, machines) : undefined,
    extracted_actual_codes: machines ? extractActualsByCode(raw, machines).size : undefined,
  };
}

function extractSkuRows(raw: unknown, source: string, machines: MachineRef[]): SkuRow[] {
  const allowedIds = new Set(machines.map((m) => (m.id || "").toLowerCase()).filter(Boolean));
  const allowedNames = new Set(machines.map((m) => m.name.toLowerCase()).filter(Boolean));
  const rows: SkuRow[] = [];
  const seenJobs = new Set<any>();

  walkObjects(raw, (obj) => {
    const worksOrders = obj?.WorksOrders ?? obj?.WorkOrders ?? obj?.worksOrders ?? obj?.works_orders;
    if (!Array.isArray(worksOrders) || seenJobs.has(obj)) return;
    seenJobs.add(obj);
      const machineRef = pick(obj, MACHINE_REF_KEYS);
    if (!sameMachine(machineRef, allowedIds, allowedNames)) return;
    for (const wo of worksOrders) {
      const rawCode = String(pick(wo, ["PartCode", "ProductCode", "SkuCode", "SKU", "ItemCode", "StockCode", "OrderNumber"]) ?? "").trim();
      const code = cleanCode(rawCode);
      if (!code || code === "UNKNOWN") continue;
      const bm = rawCode.match(/-([Bb]\d+)$/);
      const batch = bm?.[1] ?? "";
      const description = String(pick(wo, ["LongDescription", "ProductDescription", "PartDescription", "Description", "ShortDescription", "Name"]) ?? code).trim();
      const qty = num(pick(wo, ["OrderQuantity", "RequiredQuantity", "RequiredQty", "Quantity", "Qty", "PlannedQuantity", "PlanQty", "Balance"])) || 1;
      const actual = num(pick(wo, ["CompletedQuantity", "CompletedQty", "AlreadyMade", "ProducedQuantity", "ActualQuantity"])) || 0;
      rows.push({ code, description, qty, source, batch, actual });
    }
  });
  if (rows.length > 0) return rows;

  walkObjects(raw, (obj) => {
    const machineRef = pick(obj, MACHINE_REF_KEYS);
    if (!sameMachine(machineRef, allowedIds, allowedNames)) return;
    const rawCode = String(pick(obj, [
      "PartCode", "ProductCode", "SkuCode", "SKU", "ItemCode", "StockCode", "FGCode", "FinishedGood",
      "MaterialCode", "Material", "Product", "Code",
    ]) ?? "").trim();
    const code = cleanCode(rawCode);
    if (!code || code.length < 3 || /^(LINE|MACHINE|DATE|SHIFT|START|END|STATUS)$/i.test(code)) return;
    const bm = rawCode.match(/-([Bb]\d+)$/);
    const batch = bm?.[1] ?? "";
    const qty = num(pick(obj, [
      "OrderQuantity", "RequiredQuantity", "RequiredQty", "Required", "Quantity", "Qty", "PlannedQuantity", "PlanQty",
      "TargetQty", "ScheduledQty", "Balance", "Demand", "Units",
    ])) || 1;
    const description = String(pick(obj, [
      "LongDescription", "ProductDescription", "PartDescription", "MaterialDescription", "Description", "ShortDescription", "Name",
    ]) ?? code).trim();
    const actual = num(pick(obj, ["CompletedQuantity", "CompletedQty", "AlreadyMade", "ProducedQuantity", "ActualQuantity"])) || 0;
    rows.push({ code, description, qty, source, batch, actual });
  });

  return rows;
}

// Extract { code -> scrap_qty } from any raw iTouching payload.
function extractScrapByCode(raw: unknown, machines: MachineRef[]): Map<string, number> {
  const allowedIds = new Set(machines.map((m) => (m.id || "").toLowerCase()).filter(Boolean));
  const allowedNames = new Set(machines.map((m) => m.name.toLowerCase()).filter(Boolean));
  const out = new Map<string, number>();
  walkObjects(raw, (obj) => {
    const machineRef = pick(obj, MACHINE_REF_KEYS);
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
  const allowedIds = new Set(machines.map((m) => (m.id || "").toLowerCase()).filter(Boolean));
  const allowedNames = new Set(machines.map((m) => m.name.toLowerCase()).filter(Boolean));
  let runMin = 0, downMin = 0, oeeSum = 0, oeeN = 0;
  walkObjects(raw, (obj) => {
    const machineRef = pick(obj, MACHINE_REF_KEYS);
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
  const allowedIds = new Set(machines.map((m) => (m.id || "").toLowerCase()).filter(Boolean));
  const allowedNames = new Set(machines.map((m) => m.name.toLowerCase()).filter(Boolean));
  const out = new Map<string, number>();
  walkObjectsWithMachine(raw, null, (obj, inheritedMachineRef) => {
    const machineRef = pick(obj, MACHINE_REF_KEYS) ?? inheritedMachineRef;
    if (!sameMachine(machineRef, allowedIds, allowedNames)) return;
    const code = cleanCode(pick(obj, [
      "PartCode", "Part Code", "ProductCode", "SkuCode", "SKUCode", "SKU", "ItemCode", "ItemNo", "StockCode", "OrderNumber",
    ]));
    if (!code || code.length < 2) return;
    const produced = num(pick(obj, GOOD_QTY_KEYS));
    if (produced <= 0) return;
    out.set(code, Math.max(out.get(code) ?? 0, produced));
  });
  return out;
}

// Sum any "Good / Produced" values for the allowed machines regardless of SKU
// code matching. Fallback used when iTouching SKU codes don't line up with
// our local sku_products.code so the operator UI always shows a live Actual.
function extractLineGoodTotal(raw: unknown, machines: MachineRef[]): number {
  const allowedIds = new Set(machines.map((m) => (m.id || "").toLowerCase()).filter(Boolean));
  const allowedNames = new Set(machines.map((m) => m.name.toLowerCase()).filter(Boolean));
  const perMachine = new Map<string, number>();
  walkObjectsWithMachine(raw, null, (obj, inheritedMachineRef) => {
    const machineRef = pick(obj, MACHINE_REF_KEYS) ?? inheritedMachineRef;
    if (!sameMachine(machineRef, allowedIds, allowedNames)) return;
    const produced = num(pick(obj, GOOD_QTY_KEYS));
    if (produced <= 0) return;
    const key = String(machineRef ?? "_").trim().toLowerCase();
    // Counts are cumulative within the shift — keep the highest reading per machine.
    perMachine.set(key, Math.max(perMachine.get(key) ?? 0, produced));
  });
  let total = 0;
  for (const v of perMachine.values()) total += v;
  return total;
}

async function fetchActualsForLine(machines: MachineRef[], startISO: string, endISO: string, context?: { line?: string; discoverLivePaths?: boolean }) {
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

  // Current machine status is the fastest iTouching endpoint and, on some
  // installations, is where the live Produced Good / Current Shift counter is exposed.
  const statuses = await tryIt("/api/getmachineStatuses", { method: "POST", body: JSON.stringify(ids) }, { stage: "actuals_machine_statuses", line: context?.line, machines });
  merge(extractActualsByCode(statuses, machines));
  mergeScrap(extractScrapByCode(statuses, machines));
  mergeMetrics(statuses);
  mergeLineGood(statuses);

  // iTouching's tablet/web UI often shows the current-shift Produced Good on
  // the scheduled-jobs app endpoint, not on the historical JobsRan endpoints.
  // Query it per machine because this endpoint accepts MachineID only.
  for (const machine of machines) {
    const scheduled = await tryIt(
      `/api/appapi/getscheduledjobs?MachineID=${encodeURIComponent(machine.id)}`,
      { method: "GET" },
      { stage: "actuals_app_scheduled_jobs", line: context?.line, machines: [machine] },
    );
    merge(extractActualsByCode(scheduled, [machine]));
    mergeScrap(extractScrapByCode(scheduled, [machine]));
    mergeMetrics(scheduled);
    mergeLineGood(scheduled);
  }

  // Targeted live-production probes. Kept deliberately short and stopped as
  // soon as a positive good total is found to protect the iTouching egress quota.
  const liveProductionAttempts = [
    () => tryIt(`/api/appapi/getproduction?MachineID=${encodeURIComponent(ids[0])}`, { method: "GET" }, { stage: "actuals_live_probe_app_production", line: context?.line, machines }),
    () => tryIt(`/api/appapi/getproductioncounts?MachineID=${encodeURIComponent(ids[0])}`, { method: "GET" }, { stage: "actuals_live_probe_app_production_counts", line: context?.line, machines }),
    () => tryIt(`/api/appapi/getmachineproduction?MachineID=${encodeURIComponent(ids[0])}`, { method: "GET" }, { stage: "actuals_live_probe_app_machine_production", line: context?.line, machines }),
    () => tryIt(`/api/GetProduction?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }, { stage: "actuals_live_probe_get_production", line: context?.line, machines }),
    () => tryIt(`/api/GetProductionCounts?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }, { stage: "actuals_live_probe_get_production_counts", line: context?.line, machines }),
    () => tryIt(`/api/GetMachineProduction?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }, { stage: "actuals_live_probe_get_machine_production", line: context?.line, machines }),
    () => tryIt(`/api/Production?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify({ MachineGUIDs: ids, StartTime: startISO, EndTime: endISO }) }, { stage: "actuals_live_probe_production", line: context?.line, machines }),
  ];
  if (ids.length > 0) {
    for (const attempt of liveProductionAttempts) {
      const raw = await attempt();
      if (!raw) continue;
      merge(extractActualsByCode(raw, machines));
      mergeScrap(extractScrapByCode(raw, machines));
      mergeMetrics(raw);
      mergeLineGood(raw);
      if (lineGood > 0 || merged.size > 0) break;
    }
  }

  if (ids.length > 0 && context?.discoverLivePaths && lineGood <= 0 && merged.size === 0) {
    const discoveredPaths = await discoverLiveProductionPaths();
    logSync("live_path_discovery_candidates", { line: context.line ?? null, count: discoveredPaths.length, paths: discoveredPaths });
    let attempts = 0;
    for (const path of discoveredPaths) {
      for (const req of liveProductionRequests(path, ids, startISO, endISO)) {
        if (attempts >= 20 || lineGood > 0 || merged.size > 0) break;
        attempts += 1;
        const raw = await tryIt(req.path, req.init, { stage: `actuals_discovered_${safeStageName(path)}`, line: context?.line, machines });
        if (!raw) continue;
        merge(extractActualsByCode(raw, machines));
        mergeScrap(extractScrapByCode(raw, machines));
        mergeMetrics(raw);
        mergeLineGood(raw);
      }
      if (attempts >= 20 || lineGood > 0 || merged.size > 0) break;
    }
    logSync("live_path_discovery_result", { line: context.line ?? null, attempts, lineGood, actualCodeCount: merged.size });
  }

  // Running jobs (current SKU + live counts)
  const running = await tryIt("/api/GetRunningJobs", { method: "GET" }, { stage: "actuals_running_jobs", line: context?.line, machines });
  merge(extractActualsByCode(running, machines));
  mergeScrap(extractScrapByCode(running, machines));
  mergeMetrics(running);
  mergeLineGood(running);
  // Hydrate full job records if running returns only IDs
  const jobIds = new Set<string>();
  walkObjects(running, (obj) => {
    const mid = String(pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid"]) ?? "").trim();
    const jid = String(pick(obj, ["WorskOrderID", "WorksOrderID", "JobID", "JobId", "JobGUID", "JobGuid", "ID", "Id"]) ?? "").trim();
    if (mid && jid && ids.includes(mid)) jobIds.add(jid);
  });
  if (jobIds.size > 0) {
    const jobs = await tryIt("/api/GetJobs", { method: "POST", body: JSON.stringify(Array.from(jobIds)) }, { stage: "actuals_get_jobs", line: context?.line, machines });
    merge(extractActualsByCode(jobs, machines));
    mergeScrap(extractScrapByCode(jobs, machines));
    mergeMetrics(jobs);
    mergeLineGood(jobs);
  }

  // Jobs ran during the shift window (historical actuals)
  const ranAttempts = [
    () => tryIt(`/api/GetJobsRan?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }, { stage: "actuals_jobs_ran_query_array", line: context?.line, machines }),
    () => tryIt("/api/GetJobsRan", { method: "POST", body: JSON.stringify({ MachineGUIDs: ids, StartTime: startISO, EndTime: endISO }) }, { stage: "actuals_jobs_ran_object", line: context?.line, machines }),
    () => tryIt(`/api/GetJobsRanDuringPeriod?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }, { stage: "actuals_jobs_ran_period", line: context?.line, machines }),
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
    () => tryIt(`/api/GetShiftReport?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }, { stage: "actuals_shift_report", line: context?.line, machines }),
    () => tryIt(`/api/GetMachineKPIs?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }, { stage: "actuals_machine_kpis", line: context?.line, machines }),
    () => tryIt(`/api/GetOEE?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify(ids) }, { stage: "actuals_oee", line: context?.line, machines }),
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
    const cur = skuAgg.get(row.code) ?? { qty: 0, description: row.description, source: row.source, batch: row.batch, actual: 0 };
    cur.qty += Math.max(1, row.qty || 0);
    if (!cur.description || cur.description === row.code) cur.description = row.description;
    cur.source = cur.source === row.source ? cur.source : `${cur.source}+${row.source}`;
    if (!cur.batch && row.batch) cur.batch = row.batch;
    if (row.actual > cur.actual) cur.actual = row.actual;
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
  const allowedIds = new Set(machines.map((m) => (m.id || "").toLowerCase()));
  const jobIds = new Set<string>();
  walkObjects(running, (obj) => {
    const machineId = String(pick(obj, ["MachineID", "MachineId", "MachineGUID", "MachineGuid"]) ?? "").trim();
    const jobId = String(pick(obj, ["WorskOrderID", "WorksOrderID", "JobID", "JobId", "JobGUID", "JobGuid", "ID", "Id"]) ?? "").trim();
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

    const rawBody = await req.json().catch(() => ({}));
    const parsedBody = BodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return new Response(JSON.stringify({ error: parsedBody.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsedBody.data;

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
      const roleNames = (roles ?? []).map((r) => String(r.role));
      let ok = roleNames.some((role) => ["admin", "manager"].includes(role));
      if (!ok && roleNames.includes("operator") && body.line) {
        const { data: operatorAcct } = await admin
          .from("operator_line_accounts")
          .select("line_ids")
          .eq("user_id", userId)
          .maybeSingle();
        const allowedLineIds = (operatorAcct?.line_ids ?? []) as string[];
        if (allowedLineIds.length > 0) {
          const { data: allowedLine } = await admin
            .from("lines")
            .select("id")
            .in("id", allowedLineIds)
            .eq("name", body.line)
            .maybeSingle();
          ok = !!allowedLine?.id;
        }
      }
      if (!ok) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Egress backoff: refuse early if the iTouching daily quota window is still open.
    const blockedUntil = await intouchQuotaBlockedUntil();
    if (blockedUntil) {
      return new Response(JSON.stringify({
        ok: false,
        skipped: true,
        reason: "quota_exhausted",
        error: "iTouching daily quota exhausted",
        retry_after: blockedUntil,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
    const requestedLine = body.line ? String(body.line).trim() : "";

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
      if (requestedLine && line !== requestedLine) continue;

      logSync("line_start", {
        line,
        session_date,
        shift,
        machines: machines.map((m) => ({ id: m.id, name: m.name })),
        window: { start: startISO, end: endISO },
      });

      const ragPlan = Number(ragPlanByLine.get(line) ?? 0);
      if (ragPlan <= 0) {
        warnSync("line_skipped", { line, reason: "no RAG Weekly plan" });
        results.push({ line, skipped: "no RAG Weekly plan" });
        continue;
      }

      const { rows: skuRows, source } = await fetchSkuRowsForLine(machines, startISO, endISO);
      const skuAgg = aggregateRows(skuRows);
      logSync("line_schedule_rows", { line, source, rows: skuRows.length, skus: skuAgg.size });

      // Fallback path: no SKU schedule from iTouching, but the machines are
      // reporting live "Good" production. Create/keep a single synthetic
      // "Live Production" row so the operator screen still shows Actual.
      if (skuAgg.size === 0) {
        const live = await fetchActualsForLine(machines, startISO, endISO, { line, discoverLivePaths: body.debug_discover === true });
        if (!(live.lineGood > 0)) {
          warnSync("line_skipped", { line, reason: "no Material Requirements / schedule SKUs found", lineGood: live.lineGood, actualCodes: live.actuals.size });
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

        // Stamp iTouching live total on the session for the operator UI.
        const { error: stampErr } = await admin.from("production_sessions").update({
          intouch_good_total: Math.round(live.lineGood),
          metrics_synced_at: new Date().toISOString(),
        }).eq("id", session.id);
        if (stampErr) throw stampErr;
        const { data: stamped } = await admin.from("production_sessions")
          .select("intouch_good_total, metrics_synced_at")
          .eq("id", session.id)
          .maybeSingle();
        logSync("session_intouch_good_stamped", { line, session_id: session.id, expected: Math.round(live.lineGood), stored: stamped?.intouch_good_total ?? null, metrics_synced_at: stamped?.metrics_synced_at ?? null });

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
        .select("sku_id, actual_qty, target_qty, target_manual_at, blender_ref")
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
      // Preserve manually-entered blender batch refs across syncs.
      const blenderBySku = new Map(
        (existingItems ?? [])
          .filter((r: any) => r.blender_ref)
          .map((r: any) => [r.sku_id, String(r.blender_ref)]),
      );

      await admin.from("production_items").delete().eq("session_id", session.id);

      // Pull live actuals + scrap + shift metrics (run/down/OEE) per SKU from iTouching.
      const { actuals: actualsByCode, scrap: scrapByCode, lineGood, metrics } = await fetchActualsForLine(machines, startISO, endISO, { line, discoverLivePaths: body.debug_discover === true });

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
            : Math.max(Math.round(actualsByCode.get(code) ?? 0), Math.round(a.actual ?? 0));
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
            blender_ref: sku_id ? (blenderBySku.get(sku_id) ?? null) : null,
            target_manual_at: manualTarget != null ? new Date().toISOString() : null,
            notes: `itouching:${source}${useLineFallback ? "+line_good" : ""}${manualTarget != null ? "+manual_target" : ""}`,
          };
        })
        .filter((r) => r.sku_id);
      if (rows.length) await admin.from("production_items").insert(rows);

      // Persist shift-level OEE / run / down + iTouching live good total to the session row.
      const itouchTotal = Math.max(
        Math.round(lineGood || 0),
        // Sum of per-SKU iTouching matched actuals (independent of operator edits).
        Array.from(actualsByCode.values()).reduce((s, v) => s + Math.round(v || 0), 0),
      );
      const hasAnyMetric = metrics.runMin > 0 || metrics.downMin > 0 || metrics.oee !== null || itouchTotal > 0;
      if (hasAnyMetric) {
        const { error: stampErr } = await admin.from("production_sessions").update({
          run_time_min: metrics.runMin > 0 ? Math.round(metrics.runMin) : null,
          down_time_min: metrics.downMin > 0 ? Math.round(metrics.downMin) : null,
          oee_pct: metrics.oee,
          intouch_good_total: itouchTotal > 0 ? itouchTotal : null,
          metrics_synced_at: new Date().toISOString(),
        }).eq("id", session.id);
        if (stampErr) throw stampErr;
        const { data: stamped } = await admin.from("production_sessions")
          .select("intouch_good_total, metrics_synced_at")
          .eq("id", session.id)
          .maybeSingle();
        logSync("session_intouch_good_stamped", { line, session_id: session.id, expected: itouchTotal, stored: stamped?.intouch_good_total ?? null, metrics_synced_at: stamped?.metrics_synced_at ?? null, lineGood, actualCodeCount: actualsByCode.size });
      } else {
        warnSync("session_intouch_good_missing", { line, session_id: session.id, lineGood, actualCodeCount: actualsByCode.size, metrics });
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
        intouch_good_total: itouchTotal > 0 ? itouchTotal : null,
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
    if (e instanceof ItouchQuotaError) {
      if (runId) {
        try {
          await admin.from("intouch_sync_runs").update({
            status: "skipped",
            finished_at: new Date().toISOString(),
            error_message: msg.slice(0, 2000),
            details: { reason: "quota_exhausted", retry_after: e.blocked_until },
          }).eq("id", runId);
        } catch { /* ignore */ }
      }
      return new Response(JSON.stringify({
        ok: false,
        skipped: true,
        reason: "quota_exhausted",
        error: "iTouching daily quota exhausted",
        retry_after: e.blocked_until,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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
