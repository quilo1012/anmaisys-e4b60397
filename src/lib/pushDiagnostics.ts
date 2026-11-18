import { supabase } from "@/integrations/supabase/client";
import { currentPushEnvironment, iosVersion, type PushEnvironment } from "@/lib/pushEnvironment";
import { isDifferentKeyError } from "@/lib/pushSubscribe";
import { isSharedTabletSession } from "@/lib/sharedTabletSession";

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
/**
 * Which link broke, when the server has nothing for this device. "permission denied,
 * absent, not_checked" is ONE fact read three times: with permission denied nothing can be
 * subscribed, and with no subscription there is nothing to look up. null = nothing broke.
 */
export type PushGapReason =
  | "unsupported" | "permission_denied" | "not_enabled" | "no_worker"
  | "not_subscribed" | "not_saved" | "server_unreadable";

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
  reason: PushGapReason | null;
}

export const PUSH_ERROR_EVENT = "pmsystem:push-error";
/** The error name `subscribe` records when the permission answer comes back "default". */
export const PERMISSION_STAYED_DEFAULT = "PermissionStayedDefault";
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
  // The Turn on tap reached `requestPermission` and came back still "default": the
  // prompt was not shown, or was closed without an answer. Without this, that phone
  // reads exactly like one where nobody ever tapped.
  if (name === PERMISSION_STAYED_DEFAULT) return "permission_stayed_default";
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
    return { ...base, permission: "unsupported", worker: "unknown", local: "unknown", server: "not_checked", loginPhones, reason: "unsupported" };
  }

  const permission = (Notification.permission as PermissionReading) ?? "default";
  const { worker, endpoint, local } = await readWorkerAndSubscription();
  const { server, loginPhones } = await readServerRegistration(endpoint, userId);
  return { ...base, permission, worker, local, server, loginPhones, reason: gapReason(permission, worker, local, server) };
}

/** The first link that is missing, in the order a working device has them. */
export function gapReason(
  permission: PermissionReading, worker: WorkerState, local: LocalSubscription, server: ServerRegistration,
): PushGapReason | null {
  if (permission === "unsupported") return "unsupported";
  if (permission === "denied") return "permission_denied";
  if (local === "present") {
    if (server === "registered") return null;
    return server === "missing" ? "not_saved" : "server_unreadable";
  }
  if (permission === "default") return "not_enabled";
  if (worker === "none") return "no_worker";
  return "not_subscribed";
}

/**
 * What a PUSH_STATE row asks of the reader.
 *
 *  - `ok`: every link is there — the server can reach this device.
 *  - `person`: only the person holding it can move it, and the app already tells them how
 *    (`PushPromptBanner`): an iPhone opened in a Safari tab instead of from its Home Screen
 *    icon, notifications never turned on, or turned off in the phone's settings. No code
 *    change makes a phone say yes.
 *  - `fault`: the phone said yes and the chain still broke — no worker, no subscription,
 *    a subscription the server never got, a save the database refused. That is ours.
 *
 * On 18/11/2026 the page listed all 50 rows the same grey, 22 of them working phones, and
 * read as fifty errors. Unknown reasons count as faults: the direction that catches things.
 */
export type PushVerdict = "ok" | "person" | "fault";

const PERSON_REASONS = new Set<string>(["unsupported", "not_enabled", "permission_denied"]);
/** Codes from the Turn on tap or the re-save that are not the person's answer. */
const FAULT_ERROR = /^(save_refused|worker_load|different_key|push_service|other)/;

export function pushVerdict(meta: Record<string, unknown> | null | undefined): PushVerdict {
  if (!meta) return "fault";
  const reason = "reason" in meta
    ? (meta.reason as string | null)
    // Rows written before `reason` existed (before 03/11/2026): work it out the same way.
    : gapReason(
        (meta.permission as PermissionReading) ?? "default",
        (meta.worker as WorkerState) ?? "unknown",
        (meta.local as LocalSubscription) ?? "unknown",
        (meta.server as ServerRegistration) ?? "not_checked",
      );
  if (reason === null || reason === undefined) return "ok";
  if (!PERSON_REASONS.has(reason)) return "fault";
  // Blocked here, yet the server still holds it: every send "succeeds" into a device that
  // shows nothing. Ours to clear (`releaseDeniedDevicePush`), not the person's.
  if (reason === "permission_denied" && meta.server === "registered") return "fault";
  const err = meta.last_error as { code?: unknown } | null | undefined;
  return typeof err?.code === "string" && FAULT_ERROR.test(err.code) ? "fault" : "person";
}

/** What the person would have to do, in the words Root Diagnostics shows next to the row. */
export function pushVerdictHint(meta: Record<string, unknown> | null | undefined): string {
  const verdict = pushVerdict(meta);
  if (verdict === "ok") return "Working — the server can reach this device.";
  const m = meta ?? {};
  const reason = m.reason as string | null | undefined;
  const env = m.environment as string | undefined;
  const err = (m.last_error as { code?: unknown } | null | undefined)?.code;
  if (verdict === "fault") {
    if (reason === "permission_denied") return "Fault — blocked on this device but still registered on the server; the app removes it the next time this device opens.";
    if (typeof err === "string" && FAULT_ERROR.test(err)) return `Fault — the app failed to register this device (${err}).`;
    return `Fault — permission is allowed but the chain broke (${reason ?? "unknown"}).`;
  }
  if (env === "ios-install") return "Opened in a Safari tab — Share → Add to Home Screen, open from the icon, turn notifications on.";
  if (env === "ios-too-old") return "iOS older than 16.4 — this iPhone cannot receive web notifications.";
  if (reason === "unsupported") return "This browser has no notifications — open the app in Chrome, Edge or Safari.";
  if (reason === "permission_denied") return "Notifications blocked on this device — allow them in its settings.";
  if (err === "permission_stayed_default") return "Tapped Turn on but did not choose Allow.";
  return "Notifications never turned on here — the person needs to tap Turn on.";
}

/** One line a person can read in Root Diagnostics without opening the metadata. */
export function summarise(s: PushDeviceState): string {
  const opened = s.display === "standalone" ? "Home Screen app" : "browser tab";
  const err = s.lastError ? ` · last error ${s.lastError.stage}:${s.lastError.code}` : "";
  const why = s.reason ? ` · why ${s.reason}` : "";
  return `Push on ${s.platform} ${opened}: permission ${s.permission}, this device ${s.local}, server ${s.server}${why}${err}`;
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
      reason: state.reason,
    },
  };
}

let reporting = false;

/**
 * Whether this device's push state is worth a row at all.
 *
 * Not on a shared line tablet. Push is deliberately not offered there (`PushPromptBanner`:
 * a push would buzz whoever is holding it), the line has its siren instead, and the
 * tablets run in a kiosk browser with no Push API — so every one of them wrote "android
 * browser tab: permission unsupported" every morning: eight of the 50 PUSH_STATE rows on
 * 18/11/2026 (Line 1–6, Capsules Line, Gel Machine), each one reading like a fault and none
 * of them anything to fix.
 */
export function pushStateApplies(role: string | null, sharedTablet = isSharedTabletSession()): boolean {
  return role !== "operator" && !sharedTablet;
}

/** Reads the phone and writes a row when one is due. Never throws, never blocks. */
export async function reportPushDeviceState(userId: string, role: string | null, now = new Date()): Promise<boolean> {
  if (!pushStateApplies(role)) return false;
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
