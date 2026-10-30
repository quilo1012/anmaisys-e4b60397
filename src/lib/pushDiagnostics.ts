import { supabase } from "@/integrations/supabase/client";
import { currentPushEnvironment, iosVersion, type PushEnvironment } from "@/lib/pushEnvironment";
import { isDifferentKeyError } from "@/lib/pushSubscribe";

/**
 * What this phone says about push, written where an admin can read it.
 *
 * 30/10/2026: four employees booked overtime from their iPhones. One got the confirmation;
 * for the other three the server had no phone ("no_device"), and nothing on the server could
 * say why — whether the app was open in a Safari tab or from the Home Screen, whether they
 * had said no, never been asked, or said yes and the save failed. Only the phone knows, so
 * the phone says it, once a day, or as soon as the answer changes.
 *
 * Goes to `system_telemetry_logs` as `PUSH_STATE`. Its policy "telemetry insert own" lets a
 * login insert only rows with its own user_id (or none), and only admins can read them, so
 * this needs no schema or policy change.
 *
 * Never written: the subscription endpoint, its keys, tokens, or an error's own text (a
 * browser error can quote a URL). An error is reduced to a fixed code.
 *
 * How the app was opened is read from the display mode, never from the user agent: an app
 * opened from the iPhone Home Screen sends the same Safari user agent as a Safari tab (all
 * 13 iPhone subscriptions on 30/10 did).
 */

export type DisplayMode = "standalone" | "browser";
export type PermissionReading = "default" | "granted" | "denied" | "unsupported";
export type LocalSubscription = "present" | "absent" | "unknown";
/** Whether the server holds a row for THIS phone, for THIS login. */
export type ServerRegistration = "registered" | "missing" | "unknown" | "not_checked";
export type WorkerState = "active" | "installing" | "none" | "unknown";

export interface PushErrorRecord {
  /** "enable" = the Turn on button; "resync" = the silent re-save at start-up. */
  stage: "enable" | "resync";
  code: string;
  at: string;
}

export interface PushDeviceState {
  display: DisplayMode;
  environment: PushEnvironment["kind"];
  permission: PermissionReading;
  worker: WorkerState;
  local: LocalSubscription;
  server: ServerRegistration;
  /** Rows this login has on the server, on any phone. A count, never the rows. */
  loginPhones: number | null;
  platform: "ios" | "android" | "desktop" | "other";
  /** "18.7" on an iPhone, for the 16.4 floor; null elsewhere. */
  iosVersion: string | null;
  lastError: PushErrorRecord | null;
}

export const PUSH_ERROR_EVENT = "pmsystem:push-error";
const ERROR_KEY = "an_push_last_error";
const REPORT_KEY = "an_push_diag_v1";
const SW_PATH = "/sw.js";

export function currentDisplayMode(): DisplayMode {
  if (typeof window === "undefined") return "browser";
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return "standalone";
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return "standalone";
  } catch { /* old engines without matchMedia */ }
  return "browser";
}

/** A label for the reader, never a test for anything. */
export function platformFamily(userAgent: string, platform = "", maxTouchPoints = 0): PushDeviceState["platform"] {
  if (/iP(hone|ad|od)/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)) return "ios";
  if (/Android/.test(userAgent)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/.test(userAgent)) return "desktop";
  return "other";
}

/**
 * A fixed code for an error from turning push on or saving it. The text is not kept: a
 * browser's message can quote the push service URL, and a Postgres one can quote values.
 */
export function pushErrorCode(e: unknown): string {
  const err = (e && typeof e === "object" ? e : { message: typeof e === "string" ? e : "" }) as
    { name?: unknown; message?: unknown; code?: unknown };
  const name = typeof err.name === "string" ? err.name : "";
  const message = typeof err.message === "string" ? err.message : "";
  const code = typeof err.code === "string" ? err.code : "";

  // A PostgREST / Postgres refusal of the save: keep the code, it is what says which.
  // First, because Postgres words its 42501 as "permission denied", which is not the
  // phone's notification permission.
  if (/^(PGRST\d{3}|[0-9A-Z]{5})$/.test(code)) return `save_refused:${code}`;
  if (isDifferentKeyError(e)) return "different_key";
  if (name === "NotAllowedError" || /permission|denied/i.test(message)) return "permission_denied";
  if (/unsupported MIME type|failed to register a serviceworker|script fetch/i.test(message)) return "worker_load";
  if (/timed out|timeout/i.test(message)) return "timeout";
  if (/not authenticated/i.test(message)) return "not_authenticated";
  if (name === "AbortError" || /push service|registration failed/i.test(message)) return "push_service";
  if (/failed to fetch|network|load failed/i.test(message)) return "network";
  return /^[A-Za-z]{1,40}Error$/.test(name) ? `other:${name}` : "other";
}

export function rememberPushError(stage: PushErrorRecord["stage"], e: unknown): void {
  const record: PushErrorRecord = { stage, code: pushErrorCode(e), at: new Date().toISOString() };
  try { localStorage.setItem(ERROR_KEY, JSON.stringify(record)); } catch { /* private mode */ }
  try { window.dispatchEvent(new Event(PUSH_ERROR_EVENT)); } catch { /* no window */ }
}

/** Called after a save that worked: the last error is history, and the report already has it. */
export function clearPushError(): void {
  try { localStorage.removeItem(ERROR_KEY); } catch { /* private mode */ }
}

export function readLastPushError(): PushErrorRecord | null {
  try {
    const raw = localStorage.getItem(ERROR_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<PushErrorRecord>;
    if ((r.stage === "enable" || r.stage === "resync") && typeof r.code === "string" && typeof r.at === "string") {
      return { stage: r.stage, code: r.code, at: r.at };
    }
  } catch { /* unreadable: treat as none */ }
  return null;
}

/**
 * Does the server hold this phone for this login? Reads the login's own rows (the policy
 * returns only those to an employee; an admin sees everyone's, hence the user_id filter) and
 * compares endpoints here, so the endpoint never travels in a query string.
 */
export async function readServerRegistration(
  endpoint: string | null,
  userId: string,
): Promise<{ server: ServerRegistration; loginPhones: number | null }> {
  try {
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => Promise<{ data: { endpoint: string }[] | null; error: unknown }> } };
    })
      .from("push_subscriptions")
      .select("endpoint")
      .eq("user_id", userId);
    if (error || !Array.isArray(data)) return { server: "unknown", loginPhones: null };
    if (!endpoint) return { server: "not_checked", loginPhones: data.length };
    return { server: data.some((r) => r.endpoint === endpoint) ? "registered" : "missing", loginPhones: data.length };
  } catch {
    return { server: "unknown", loginPhones: null };
  }
}

async function readWorkerAndSubscription(): Promise<{ worker: WorkerState; endpoint: string | null; local: LocalSubscription }> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (!reg) return { worker: "none", endpoint: null, local: "absent" };
    const worker: WorkerState = reg.active ? "active" : (reg.installing || reg.waiting) ? "installing" : "none";
    const sub = await reg.pushManager?.getSubscription();
    return { worker, endpoint: sub?.endpoint ?? null, local: sub ? "present" : "absent" };
  } catch {
    return { worker: "unknown", endpoint: null, local: "unknown" };
  }
}

export async function readPushDeviceState(userId: string): Promise<PushDeviceState> {
  const environment = currentPushEnvironment();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const v = iosVersion(ua);
  const platform = platformFamily(ua, navigator?.platform, navigator?.maxTouchPoints);
  const base = {
    display: currentDisplayMode(),
    environment: environment.kind,
    platform,
    iosVersion: platform === "ios" && v ? `${v[0]}.${v[1]}` : null,
    lastError: readLastPushError(),
  };

  // Safari tab on an iPhone, or a browser with no push at all: there is no worker or
  // subscription to look at, and permission cannot be asked here.
  if (environment.kind !== "ready") {
    const { loginPhones } = await readServerRegistration(null, userId);
    return { ...base, permission: "unsupported", worker: "unknown", local: "unknown", server: "not_checked", loginPhones };
  }

  const permission = (Notification.permission as PermissionReading) ?? "default";
  const { worker, endpoint, local } = await readWorkerAndSubscription();
  const { server, loginPhones } = await readServerRegistration(endpoint, userId);
  return { ...base, permission, worker, local, server, loginPhones };
}

/** One line a person can read in Root Diagnostics without opening the metadata. */
export function summarise(s: PushDeviceState): string {
  const opened = s.display === "standalone" ? "Home Screen app" : "browser tab";
  const err = s.lastError ? ` · last error ${s.lastError.stage}:${s.lastError.code}` : "";
  return `Push on ${s.platform} ${opened}: permission ${s.permission}, this phone ${s.local}, server ${s.server}${err}`;
}

/** The parts of the state whose change is worth a second row the same day. */
function fingerprint(s: PushDeviceState): string {
  return JSON.stringify([s.display, s.environment, s.permission, s.worker, s.local, s.server,
    s.lastError ? `${s.lastError.stage}:${s.lastError.code}:${s.lastError.at}` : null]);
}

function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** One row per phone per day per login, and another only when the state changed. */
export function shouldReport(state: PushDeviceState, userId: string, now = new Date()): boolean {
  try {
    const last = JSON.parse(localStorage.getItem(REPORT_KEY) ?? "null") as { day?: string; user?: string; fp?: string } | null;
    return !last || last.day !== localDay(now) || last.user !== userId || last.fp !== fingerprint(state);
  } catch {
    return true;
  }
}

function markReported(state: PushDeviceState, userId: string, now: Date): void {
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify({ day: localDay(now), user: userId, fp: fingerprint(state) }));
  } catch { /* private mode: it reports again next time, which is fine */ }
}

/** The row, built in one place so a test can hold what it may and may not carry. */
export function telemetryRow(state: PushDeviceState, userId: string, role: string | null) {
  return {
    user_id: userId,
    user_role: role,
    error_type: "PUSH_STATE",
    message: summarise(state),
    stack_trace: null,
    route_path: typeof window !== "undefined" ? window.location.pathname : null,
    metadata: {
      display: state.display,
      environment: state.environment,
      permission: state.permission,
      worker: state.worker,
      local: state.local,
      server: state.server,
      login_phones: state.loginPhones,
      platform: state.platform,
      ios_version: state.iosVersion,
      last_error: state.lastError,
    },
  };
}

let reporting = false;

/** Reads the phone and writes a row when one is due. Never throws, never blocks. */
export async function reportPushDeviceState(userId: string, role: string | null, now = new Date()): Promise<boolean> {
  if (reporting) return false;
  reporting = true;
  try {
    const state = await readPushDeviceState(userId);
    if (!shouldReport(state, userId, now)) return false;
    const { error } = await (supabase as unknown as {
      from: (t: string) => { insert: (r: unknown) => Promise<{ error: unknown }> };
    }).from("system_telemetry_logs").insert(telemetryRow(state, userId, role));
    if (error) return false;
    markReported(state, userId, now);
    return true;
  } catch {
    return false;
  } finally {
    reporting = false;
  }
}
