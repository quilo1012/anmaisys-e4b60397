import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Eight ReferenceErrors from DashboardLayout.tsx, and the file never had a bug.
 *
 * Lovable's preview is a Vite dev server. An AI edit lands on a file as a run of
 * separate writes, and HMR ships every one of them to whatever browser is sitting
 * on that route. Between two writes the body of the file uses a name its import
 * line has not got yet — or, when a feature is being taken back out, still uses
 * one the body has already lost.
 *
 * On 09/09 one 20-minute edit added a hide-on-scroll header to DashboardLayout
 * and then removed it again. Two people had the app open, on
 * /dashboard/root-diagnostics and /dashboard/stock, and the log took the whole
 * teardown a name at a time:
 *
 *     11:22:34  headerHidden is not defined
 *     11:22:59  contentRef is not defined
 *     11:23:14  useRef is not defined       <- and twice more, one as REACT_CRASH
 *
 * The commit that ended the edit, 97ea4ff7, contains none of those names, and
 * neither does the hook file — it was deleted in the same commit that created it
 * seventeen minutes earlier.
 *
 * The tell is the URL and not the message: `?t=<epoch>` is Vite's cache-buster,
 * and only a dev server serves it. So the same ReferenceError out of a published
 * build is still recorded, in full — an import missing from committed code IS a
 * fault, and this filter must never be the reason nobody hears about one.
 */

const insert = vi.fn<(r: unknown) => Promise<Record<string, unknown>>>(() => Promise.resolve({}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: (r: unknown) => insert(r) }) },
}));

const { installTelemetryHandlers, logSystemError } = await import("@/lib/telemetry");
installTelemetryHandlers();

const HOST = "https://091e038b-48fc-421f-9245-b03e63c99308.lovableproject.com";
const DEV_MODULE = `${HOST}/src/components/DashboardLayout.tsx?t=1788952994954`;
const BUILT_BUNDLE = `${HOST}/assets/index-Ca7f19bd.js`;

/** The stack the browser actually recorded at 12:23:26 on 09/09. */
const devStack = [
  "ReferenceError: useRef is not defined",
  `    at DashboardLayout (${DEV_MODULE}:1015:24)`,
  `    at renderWithHooks (${HOST}/node_modules/.vite/deps/chunk-XQLYTHWV.js?v=4483cfd8:11548:26)`,
  `    at mountIndeterminateComponent (${HOST}/node_modules/.vite/deps/chunk-XQLYTHWV.js?v=4483cfd8:14926:21)`,
].join("\n");

const builtStack = [
  "ReferenceError: useRef is not defined",
  `    at Vn (${BUILT_BUNDLE}:412:9187)`,
].join("\n");

function raise(message: string, filename: string, stack: string) {
  const error = new Error(message);
  error.stack = stack;
  window.dispatchEvent(new ErrorEvent("error", { message, error, filename }));
}

describe("a file the dev server is halfway through writing is not a crash", () => {
  beforeEach(() => insert.mockClear());

  it("drops the uncaught error from a module carrying Vite's cache-buster", () => {
    raise("Uncaught ReferenceError: useRef is not defined", DEV_MODULE, devStack);
    expect(insert).not.toHaveBeenCalled();
  });

  it("drops it on the ErrorBoundary path too, which is what badges Root Diagnostics", () => {
    // componentDidCatch has no filename to offer — only error.stack.
    logSystemError("REACT_CRASH", "useRef is not defined", { stack: devStack });
    expect(insert).not.toHaveBeenCalled();
  });

  it("drops the temporal-dead-zone twin, the same window seen from the other side", () => {
    logSystemError("REACT_CRASH", "Cannot access 'contentRef' before initialization", {
      stack: devStack.replace("useRef is not defined", "x"),
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("RECORDS the same message from a published build, where no edit is in flight", () => {
    raise("Uncaught ReferenceError: useRef is not defined", BUILT_BUNDLE, builtStack);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ error_type: "JS_ERROR" });
  });

  it("records a real fault that happens to be raised on the dev server", () => {
    // The filter is about half-written modules, not about silencing the preview.
    raise(
      "Cannot read properties of undefined (reading 'blender_number')",
      DEV_MODULE,
      devStack.replace("useRef is not defined", "x"),
    );
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("records a missing name that is not attributed to any dev module", () => {
    logSystemError("JS_ERROR", "supabase is not defined", { stack: "    at <anonymous>:1:1" });
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
