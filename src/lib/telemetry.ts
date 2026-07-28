import { supabase } from "@/integrations/supabase/client";

export type TelemetryErrorType =
  | "REACT_CRASH"
  | "JS_ERROR"
  | "UNHANDLED_REJECTION"
  | "RLS_ERROR"
  | "API_ERROR"
  | "REALTIME";

// Best-effort context, set from AuthContext so logs carry the user + role
// without an extra query on the hot error path.
let ctxUserId: string | null = null;
let ctxRole: string | null = null;
let inFlight = false; // recursion guard: never log an error caused by logging
const recent = new Map<string, number>(); // throttle identical errors

export function setTelemetryContext(userId: string | null, role: string | null) {
  ctxUserId = userId;
  ctxRole = role;
}

/**
 * Fire-and-forget: record a system error to system_telemetry_logs so an admin
 * can diagnose "the audio didn't send" / "the tablet logged out" after the fact.
 * Never throws, never blocks the UI, throttles identical errors, and won't
 * recurse if the telemetry insert itself fails.
 */
export function logSystemError(
  errorType: TelemetryErrorType,
  message: string,
  opts?: { stack?: string | null; metadata?: Record<string, unknown> },
) {
  try {
    if (inFlight) return;
    const msg = (message || "").toString().slice(0, 2000);
    if (!msg) return;
    const route = typeof window !== "undefined" ? window.location.pathname : null;
    const key = `${errorType}|${msg}|${route}`;
    const now = Date.now();
    if (now - (recent.get(key) ?? 0) < 30_000) return; // ≤ 1 identical / 30s
    recent.set(key, now);
    if (recent.size > 200) recent.clear();

    inFlight = true;
    void (supabase as unknown as {
      from: (t: string) => { insert: (r: unknown) => Promise<unknown> };
    })
      .from("system_telemetry_logs")
      .insert({
        user_id: ctxUserId,
        user_role: ctxRole,
        error_type: errorType,
        message: msg,
        stack_trace: opts?.stack ? String(opts.stack).slice(0, 6000) : null,
        route_path: route,
        metadata: opts?.metadata ?? null,
      })
      .then(
        () => { inFlight = false; },
        () => { inFlight = false; },
      );
  } catch {
    inFlight = false;
  }
}

/** Register global handlers for uncaught JS errors + unhandled promise rejections. */
export function installTelemetryHandlers() {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (e) => {
    const m = e.message || (e.error as Error | undefined)?.message || "";
    if (!m || /ResizeObserver loop/i.test(m)) return; // ignore known browser noise
    logSystemError("JS_ERROR", m, {
      stack: (e.error as Error | undefined)?.stack,
      metadata: { filename: e.filename, lineno: e.lineno, colno: e.colno },
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as { message?: string; stack?: string } | string | undefined;
    const m = (typeof reason === "string" ? reason : reason?.message) || "Unhandled promise rejection";
    logSystemError("UNHANDLED_REJECTION", m, { stack: typeof reason === "object" ? reason?.stack : undefined });
  });
}
