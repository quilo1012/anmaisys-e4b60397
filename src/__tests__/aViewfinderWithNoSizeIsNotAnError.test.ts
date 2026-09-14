import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { MIN_QRBOX_PX, qrboxFor } from "@/lib/scannerViewfinder";

/**
 * Closing the scan dialog before the camera finished opening wrote a fault to the log.
 *
 * html5-qrcode measures its viewfinder inside a `playing` listener on the <video> it
 * built (`camera/core-impl.js`), and hands the measurement to the `qrbox` callback.
 * A throw from a DOM event handler is uncaught by definition, so anything that
 * function makes the library reject lands in window.onerror — the same route as the
 * `onabort` string in [[aCameraThatClosesIsNotAnError]].
 *
 * Two things met on 09/09 12:58 on /dashboard/stock. Radix takes the dialog content
 * out of the document the moment it closes, which takes the <video> with it, and a
 * detached element measures 0 x 0. And the teardown asked the wrong question before
 * shutting the camera down: `Html5Qrcode.isScanning` is a plain field set from that
 * same `playing` listener, so between `start()` resolving and the first frame playing
 * it is still false — the camera is up, the library's own state says SCANNING, and the
 * dialog skipped `stop()` and called `clear()`, which only empties the container. The
 * stream stayed live on a video nobody could see, `playing` fired on it seconds later,
 * and `Math.min(0, 0) * 0.7` gave the library a 0px box:
 *
 *     Uncaught minimum size of 'config.qrbox' dimension value is 50px.
 *
 * Both halves are held here because they fail for different reasons: a box is never
 * smaller than the library's floor whatever it is handed, and the camera is stopped on
 * the library's state rather than on a field that lags it.
 */

describe("a viewfinder with no size", () => {
  it("never asks for a box below the library's floor", () => {
    // The measurement a detached <video> reports. 0 * 0.7 is what threw.
    expect(qrboxFor(0, 0).width).toBeGreaterThanOrEqual(MIN_QRBOX_PX);
    expect(qrboxFor(0, 0).height).toBeGreaterThanOrEqual(MIN_QRBOX_PX);
  });

  it("holds the floor across every size that used to fall under it", () => {
    // Anything shorter than 50 / 0.7 = 71.4px produced a box the library refuses.
    for (const side of [1, 12, 40, 60, 71]) {
      expect(qrboxFor(side, side).width).toBeGreaterThanOrEqual(MIN_QRBOX_PX);
    }
  });

  it("survives a measurement that is not a number at all", () => {
    expect(qrboxFor(NaN, NaN).width).toBe(MIN_QRBOX_PX);
    expect(qrboxFor(undefined as unknown as number, 300).width).toBe(MIN_QRBOX_PX);
  });

  it("still frames the shortest side on a viewfinder that has one", () => {
    expect(qrboxFor(480, 300)).toEqual({ width: 210, height: 210 });
    expect(qrboxFor(300, 480)).toEqual({ width: 210, height: 210 });
  });
});

describe("the scan dialog stops the camera on the library's state", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/StockScanOutDialog.tsx"),
    "utf8",
  );

  it("does not gate the stop on the field that lags the first frame", () => {
    expect(src).not.toContain("s.isScanning ? s.stop()");
  });

  it("asks the state manager instead, the same question stop() asks itself", () => {
    expect(src).toContain("Html5QrcodeScannerState");
    expect(src).toMatch(/getState\(\)\s*!==\s*Html5QrcodeScannerState\.NOT_STARTED/);
  });

  it("shuts down a camera that finishes opening after the dialog has gone", () => {
    // start() resolving after the cleanup ran is the one case the state gate cannot
    // catch: at cleanup time the library was still NOT_STARTED.
    expect(src).toMatch(/if \(cancelled\) \{[\s\S]{0,400}?closeScanner\(/);
  });

  it("hands the sizing to the shared function rather than an inline lambda", () => {
    expect(src).toContain("qrbox: qrboxFor");
    expect(src).not.toContain("Math.min(w, h) * 0.7");
  });
});
