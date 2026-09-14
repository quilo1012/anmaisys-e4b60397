/**
 * How big the reading box is, given the viewfinder the camera ended up with.
 *
 * html5-qrcode calls this with the <video> element's own client size, measured from
 * inside a `playing` listener it hangs on that video (`camera/core-impl.js`). Two
 * things follow from where the measurement is taken, and both are why this is a
 * function with a floor rather than the arithmetic it used to be inline:
 *
 * 1. The element may no longer be on the page. Radix removes the dialog content the
 *    instant it closes, and a detached element measures 0 x 0 — so the callback is
 *    asked to frame a viewfinder that does not exist.
 * 2. Whatever it returns is validated by `validateQrboxSize`, which THROWS a bare
 *    string under 50px. That throw is inside a DOM event handler, so nothing catches
 *    it: it reaches window.onerror and Root Diagnostics files it as a JS_ERROR.
 *    `Uncaught minimum size of 'config.qrbox' dimension value is 50px.` on
 *    /dashboard/stock, 09/09 12:58, is 0 x 0 arriving here.
 *
 * The floor makes that throw unreachable whatever the library hands over. It is not a
 * cosmetic clamp on a number nobody sees: above the floor the library truncates a box
 * wider than the viewfinder and merely warns, so a 50px box on a viewfinder that has
 * no size costs nothing and refuses nothing.
 */

/** `Constants.MIN_QR_BOX_SIZE` in html5-qrcode. Below it, the library throws. */
export const MIN_QRBOX_PX = 50;

/** The reading box sits inside the shortest side, with a margin around it. */
const FRACTION_OF_SHORTEST_SIDE = 0.7;

export function qrboxFor(
  viewfinderWidth: number,
  viewfinderHeight: number,
): { width: number; height: number } {
  const w = Number.isFinite(viewfinderWidth) ? viewfinderWidth : 0;
  const h = Number.isFinite(viewfinderHeight) ? viewfinderHeight : 0;
  const size = Math.max(
    MIN_QRBOX_PX,
    Math.round(Math.min(w, h) * FRACTION_OF_SHORTEST_SIDE),
  );
  return { width: size, height: size };
}
