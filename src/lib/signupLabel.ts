import QRCode from "qrcode";

/**
 * The "Create your account" sheet, sized to whatever paper the printer has loaded.
 *
 * It was a web page laid out for A4 — 48px of padding, a 340px picture of the QR,
 * grey text — and the printer it actually goes to is the Zebra ZT231 at 300dpi,
 * through the ZDesigner driver, with a label a few centimetres high loaded. Chrome
 * shrank the A4 page onto the label or cut it across several, the QR arrived as a
 * 320px PNG resampled by the driver into soft modules, and the slate greys (#475569)
 * came out as a dither of dots a thermal head cannot print as a tone.
 *
 * So the sheet makes no assumption about the paper:
 *
 *  - `@page` has a zero margin and NO size. The page is then the media the driver
 *    reports — the label in the ZT231, A4 on an office printer — and everything on it
 *    is sized in viewport units, which on paper are the page. One label, whatever its
 *    size, and never a second one.
 *  - A label wider than it is tall (100 × 50) puts the QR beside the words instead of
 *    under them, where it would have to shrink to a stamp.
 *  - The QR is vector — one filled square per dark module, not a stroked path and not
 *    a bitmap — so the driver rasterises it at its own 300dpi with hard edges.
 *  - Black on white and nothing in between. A thermal head prints a dot or no dot.
 */

/** The QR's dark modules as one SVG path, a run of squares per row. */
export function qrPath(payload: string): { size: number; d: string } {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  let d = "";
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!data[y * size + x]) { x++; continue; }
      const start = x;
      while (x < size && data[y * size + x]) x++;
      d += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  }
  return { size, d };
}

/** Four modules of white around the code: the quiet zone the standard asks for. */
const QUIET = 4;

export const SIGNUP_LABEL_CSS = `
@page { margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, Helvetica, sans-serif; }
.label {
  box-sizing: border-box; width: 100vw; height: 100vh; overflow: hidden;
  padding: 4vmin;
  display: grid; justify-items: center; align-content: center; gap: 2.2vmin;
  grid-template-areas: "title" "lead" "qr" "code";
  text-align: center;
  break-inside: avoid; break-after: avoid; page-break-after: avoid;
}
h1 { grid-area: title; margin: 0; font-size: min(9vmin, 14mm); font-weight: 800; line-height: 1.05; }
.lead { grid-area: lead; margin: 0; font-size: min(4.6vmin, 6mm); font-weight: 700; line-height: 1.2; }
svg.qr { grid-area: qr; display: block; width: min(76vw, 56vh, 110mm); height: auto; }
.code { grid-area: code; margin: 0; font-size: min(4vmin, 5.5mm); font-weight: 700; line-height: 1.2; }
.code b {
  display: block; margin-top: 0.6vmin;
  font-family: "Courier New", Courier, monospace;
  font-size: min(7vmin, 10mm); font-weight: 800; letter-spacing: 0.05em;
}
@media (min-aspect-ratio: 3/2) {
  .label {
    grid-template-columns: auto 1fr;
    /* Empty rows above and below take the slack, so the three lines of text sit
       together beside the code instead of spreading to its corners. */
    grid-template-rows: 1fr auto auto auto 1fr;
    grid-template-areas: "qr ." "qr title" "qr lead" "qr code" "qr .";
    justify-items: start; align-content: stretch; text-align: left; column-gap: 4vmin;
  }
  svg.qr { width: auto; height: calc(100vh - 8vmin); max-height: 110mm; }
}
`;

/**
 * Writes the label into `d` — a blank document, the print window's.
 *
 * Built node by node: the code is somebody's typing and this is a document, and
 * `textContent` keeps the two apart by construction instead of by remembering to
 * escape. The SVG is built the same way, from numbers, never parsed from a string.
 */
export function writeSignupLabel(d: Document, opts: { payload: string; code: string }) {
  d.title = "Create your account";

  const style = d.createElement("style");
  style.textContent = SIGNUP_LABEL_CSS;
  d.head.appendChild(style);

  const label = d.createElement("main");
  label.className = "label";

  const h1 = d.createElement("h1");
  h1.textContent = "Create your account";

  const lead = d.createElement("p");
  lead.className = "lead";
  lead.textContent = "Scan with your phone to sign up for overtime.";

  const { size, d: path } = qrPath(opts.payload);
  const NS = "http://www.w3.org/2000/svg";
  const svg = d.createElementNS(NS, "svg");
  const full = size + QUIET * 2;
  svg.setAttribute("class", "qr");
  svg.setAttribute("viewBox", `${-QUIET} ${-QUIET} ${full} ${full}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code to sign-up");
  const bg = d.createElementNS(NS, "rect");
  bg.setAttribute("x", String(-QUIET));
  bg.setAttribute("y", String(-QUIET));
  bg.setAttribute("width", String(full));
  bg.setAttribute("height", String(full));
  bg.setAttribute("fill", "#fff");
  const dark = d.createElementNS(NS, "path");
  dark.setAttribute("d", path);
  dark.setAttribute("fill", "#000");
  svg.append(bg, dark);

  const fallback = d.createElement("p");
  fallback.className = "code";
  fallback.append("No scan? Invite code:");
  const b = d.createElement("b");
  b.textContent = opts.code;
  fallback.appendChild(b);

  label.append(h1, lead, svg, fallback);
  d.body.appendChild(label);
}
