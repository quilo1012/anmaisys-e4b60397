import { supabase } from "@/integrations/supabase/client";

export type TelemetryErrorType =
  | "REACT_CRASH"
  | "JS_ERROR"
  | "UNHANDLED_REJECTION"
  | "RLS_ERROR"
  | "API_ERROR"
  // A backend refusal the person who hit it can fix by typing something else, on a
  // screen that already tells them how. Recorded rather than dropped — three duplicate
  // SKU codes in four minutes is what said the screen should name the SKU already
  // holding the code — but not a fault. `userCorrectable` decides, one constraint at
  // a time, and everything unlisted stays a fault.
  | "USER_ERROR"
  // A read that asked for a column the code knows may not be there, on a database
  // where it is not. The ladder in `selectOptions` handled it and the screen is
  // right; what is left is the migration, unapplied. Worth recording — it is the
  // only place the drift surfaces — but not a fault anybody caused. `schemaProbes`
  // decides, one column at a time, and everything unlisted stays a fault.
  | "SCHEMA_DRIFT"
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
    if (isMidEditReload(msg, opts?.stack, opts?.metadata?.filename)) return;
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

/**
 * The dev server was halfway through rewriting the module this came out of.
 *
 * Lovable's preview IS a Vite dev server, and an AI edit lands on a file as a run
 * of separate writes. HMR ships every one of them to whatever browser is sitting
 * on that route, so for a few seconds the body of the file uses a name its import
 * line has not got yet — or, when a feature is being taken back out, still uses
 * one the body has already lost. Nothing is wrong with the file; the next write is
 * seconds away and fixes it.
 *
 * One 20-minute edit on 09/09 that added a hide-on-scroll header to
 * DashboardLayout.tsx and then removed it again wrote eight of these into the log
 * for two people who had the app open — `headerHidden`, `scrollRef`,
 * `dashboardPathFor`, `contentRef`, `useRef` — and three of them arrived through
 * the ErrorBoundary as REACT_CRASH, which is what puts the red badge on Root
 * Diagnostics. The commit that ended the edit (97ea4ff7) contains none of those
 * names.
 *
 * The tell is the URL and not the message: `?t=<epoch>` is Vite's cache-buster and
 * exists only on a dev server. A published build serves hashed bundles, so the
 * same ReferenceError out of production is still recorded in full — which matters,
 * because an import missing from committed code IS a fault. That one is caught
 * before it merges, by `tsc --noEmit` in CI (TS2304, added after the StockPage
 * `DropdownMenu` incident of 08/09). Nothing catches the seconds between two
 * writes to a sandbox, and nothing needs to.
 */
const DEV_MODULE_FRAME = /\/src\/[^\s"')]+\.[jt]sx?\?[tv]=[0-9a-f]+/i;
const HALF_WRITTEN_MODULE = /\bis not defined\b|\bCannot access '[^']*' before initialization\b/;

function isMidEditReload(message: string, stack?: string | null, filename?: unknown): boolean {
  if (!HALF_WRITTEN_MODULE.test(message)) return false;
  const origin = `${typeof filename === "string" ? filename : ""}\n${stack ?? ""}`;
  return DEV_MODULE_FRAME.test(origin);
}

/**
 * Messages that mean nothing was wrong, so they never become a fault.
 *
 * `ResizeObserver loop` is the browser telling itself it re-laid-out twice.
 *
 * The two `RenderedCameraImpl` lines come from html5-qrcode, which sets `onabort`
 * and `onerror` on the <video> it creates and THROWS a bare string from each
 * (camera/core-impl.js). Nothing catches those, so they arrive here as uncaught
 * errors. Closing the scanner is the usual trigger — StockScanOutDialog detaches
 * the handlers before it stops the camera for exactly that reason — but a tablet
 * that backgrounds the page or loses the camera to another app fires `abort` with
 * the scanner still live and the handler still attached. The string carries no
 * detail in any of those cases; a camera that genuinely fails to start is reported
 * by the screen itself, off the start() rejection.
 */
function isKnownNoise(message: string): boolean {
  return (
    /ResizeObserver loop/i.test(message) ||
    /RenderedCameraImpl video surface on(abort|error)\(\) called/i.test(message)
  );
}

/**
 * The browser refusing to say anything, which is not the same as an error.
 *
 * An exception thrown inside a script served from another origin reaches
 * window.onerror stripped to a fixed placeholder — message "Script error.", filename
 * "", line and column 0, and no Error object. There is no file, no line, no stack,
 * and no way to tell which script: the entry is a tally mark. /dashboard/engineer,
 * 10/09 05:29, is one.
 *
 * It is never this app. Our bundle is served from our own origin, so its exceptions
 * arrive whole. The placeholder means a script we do not serve — on a shop tablet,
 * usually a browser extension. If a third-party script we DO load ever needs to be
 * seen, the answer is `crossorigin` on its tag and CORS on its host, which unmasks it
 * properly; there is nothing here to unmask.
 *
 * Filtered on the SHAPE and not the words, because the words alone are not proof: an
 * error whose message happens to read "Script error." while carrying a file, a line
 * or a stack came from somewhere we can look, and is still recorded.
 */
function isOpaqueCrossOriginError(e: ErrorEvent): boolean {
  if (!/^Script error\.?$/i.test((e.message || "").trim())) return false;
  return !e.filename && !e.lineno && !e.colno && !e.error;
}

/** Register global handlers for uncaught JS errors + unhandled promise rejections. */
export function installTelemetryHandlers() {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (e) => {
    const m = e.message || (e.error as Error | undefined)?.message || "";
    if (!m || isKnownNoise(m) || isOpaqueCrossOriginError(e)) return;
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
