import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `Script error.` is the browser refusing to say anything, not something to fix.
 *
 * When an exception comes out of a script served from another origin, the browser
 * strips window.onerror down to a fixed placeholder: the message becomes
 * "Script error.", the filename becomes "", the line and column become 0, and there
 * is no Error object at all. That is the whole payload. 10/09 05:29 on
 * /dashboard/engineer is one of these, and there is no follow-up that could be done
 * with it — not the file, not the line, not even which script.
 *
 * It cannot be ours. This app's bundle is served from its own origin, so an exception
 * in it arrives with message, file, line and stack intact; the placeholder means a
 * script the app does not serve — a browser extension on a shop tablet, most often.
 * If a third party we DO load ever needs unmasking, the fix is `crossorigin` on its
 * tag plus CORS on its host, not a line in the log that says nothing.
 *
 * So the shape is what is filtered, not the words. An error that merely says "Script
 * error." while carrying a file or a stack is a real error and is still recorded —
 * the placeholder is only the placeholder when everything else is empty too.
 */

const insert = vi.fn<(r: unknown) => Promise<Record<string, unknown>>>(() => Promise.resolve({}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: (r: unknown) => insert(r) }) },
}));

const { installTelemetryHandlers } = await import("@/lib/telemetry");
installTelemetryHandlers();

function raise(init: ErrorEventInit) {
  window.dispatchEvent(new ErrorEvent("error", init));
}

describe("the opaque cross-origin error", () => {
  // `logSystemError` throttles the same type+message+route to one in thirty seconds,
  // and every case here raises the same message on purpose. A route of its own per
  // test keeps the throttle out of the way of what is being asserted.
  let n = 0;
  beforeEach(() => {
    insert.mockClear();
    window.history.pushState({}, "", `/dashboard/case-${n++}`);
  });

  it("is not recorded, because there is nothing in it to record", () => {
    raise({ message: "Script error.", filename: "", lineno: 0, colno: 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("is not recorded without the full stop either", () => {
    raise({ message: "Script error", filename: "", lineno: 0, colno: 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("IS recorded when it names a file, because then it is not the placeholder", () => {
    raise({
      message: "Script error.",
      filename: "https://anmaisys.lovable.app/assets/index-CzO8q2VT.js",
      lineno: 12,
      colno: 3,
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("IS recorded when it carries an Error, for the same reason", () => {
    raise({
      message: "Script error.",
      filename: "",
      lineno: 0,
      colno: 0,
      error: new Error("Script error."),
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("still records an ordinary uncaught error with no filename of its own", () => {
    raise({ message: "Cannot read properties of null (reading 'id')", filename: "", lineno: 0, colno: 0 });
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
