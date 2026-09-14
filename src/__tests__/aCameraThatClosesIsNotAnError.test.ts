import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Closing the barcode scanner filled the error log with a fault nobody caused.
 *
 * html5-qrcode builds its own <video> and hangs two handlers on it that THROW a bare
 * string (`camera/core-impl.js`):
 *
 *     this.surface.onabort  = () => { throw "RenderedCameraImpl video surface onabort() called"; };
 *     this.surface.onerror  = () => { throw "RenderedCameraImpl video surface onerror() called"; };
 *
 * Its `close()` then pulls every track off the MediaStream while the video is still
 * pointed at it, so the browser fires `abort` on the way out. A throw from a DOM event
 * handler is uncaught by definition, so it reaches window.onerror — and the telemetry
 * handler writes it to system_telemetry_logs as a JS_ERROR. That is what 09/09 08:07
 * on /dashboard/stock is: a scanner that shut down exactly as asked.
 *
 * Two layers, because the abort has more than one way out. StockScanOutDialog detaches
 * the handlers before it stops the camera — that is the one path we control. A tablet
 * that backgrounds the page, or loses the camera to another app, fires `abort` with the
 * scanner still live and the handler still attached; the filter catches that. Neither
 * layer hides a real camera failure: a camera that will not start rejects `start()` and
 * the screen says so itself.
 */

const insert = vi.fn<(r: unknown) => Promise<Record<string, unknown>>>(() => Promise.resolve({}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: (r: unknown) => insert(r) }) },
}));

const { installTelemetryHandlers } = await import("@/lib/telemetry");
installTelemetryHandlers();

function raise(message: string) {
  window.dispatchEvent(new ErrorEvent("error", { message, error: new Error(message) }));
}

describe("a camera that closes is not an error", () => {
  beforeEach(() => insert.mockClear());

  it("does not record the teardown throw html5-qrcode makes on abort", () => {
    raise("RenderedCameraImpl video surface onabort() called");
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not record its onerror twin either", () => {
    raise("RenderedCameraImpl video surface onerror() called");
    expect(insert).not.toHaveBeenCalled();
  });

  it("still records a real uncaught error", () => {
    raise("Cannot read properties of undefined (reading 'code')");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ error_type: "JS_ERROR" });
  });

  it("still records a genuine camera failure, which reads nothing like the noise", () => {
    raise("NotAllowedError: Permission denied");
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe("the scan dialog detaches those handlers before it closes the camera", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/StockScanOutDialog.tsx"),
    "utf8",
  );

  it("holds the <video> the library appended, rather than looking it up at teardown", () => {
    // By the time the cleanup runs React has already taken the reader container out of
    // the document, so getElementById would come back null and the detach would silently
    // do nothing.
    expect(src).toMatch(/surfaceRef\s*=\s*useRef<HTMLVideoElement \| null>\(null\)/);
    expect(src).toMatch(/surfaceRef\.current\s*=\s*el\.querySelector\("video"\)/);
  });

  it("clears onabort and onerror before calling stop()", () => {
    // Both live in `closeScanner`, which is the only path that puts the camera down —
    // the effect cleanup and the start() that resolves after it both go through there.
    const detach = src.indexOf("surface.onabort = null");
    const stop = src.indexOf("await s.stop()");
    expect(detach).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(-1);
    expect(detach).toBeLessThan(stop);
    expect(src).toContain("surface.onerror = null");
  });
});
