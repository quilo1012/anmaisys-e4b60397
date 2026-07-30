/**
 * Print one element as its own document.
 *
 * `window.print()` prints the whole dashboard and then relies on the global print
 * stylesheet to hide the shell around it — a sidebar, a sticky header, three nested
 * flex containers with `h-screen` and `overflow-hidden`, and a scroll container the
 * content actually lives in. Every one of those has to be neutralised by a
 * `!important` rule, in the right order, in every browser. When one of them wins
 * instead, the page comes out blank, clipped at the first screenful, or missing its
 * right-hand side, and there is nothing on screen to explain why.
 *
 * So the element is cloned into an isolated iframe that contains only the document
 * to print, with the app's own stylesheets copied across so it keeps its appearance.
 * Nothing outside the element exists in that document, so nothing outside it can
 * hide or clip it.
 *
 * An iframe rather than a popup window: popup blockers refuse window.open on many
 * tablets, and that failure is silent too.
 */
export async function printElementAsDocument(el: HTMLElement, title: string): Promise<void> {
  const iframe = document.createElement("iframe");
  // Off-screen but still laid out — `display: none` would give images no chance to
  // load and Safari nothing to paginate.
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;";
  document.body.appendChild(iframe);

  const cleanup = () => {
    // Late enough for the print dialog to have taken its snapshot.
    window.setTimeout(() => iframe.remove(), 1000);
  };

  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error("Could not open a print document");

    const styles = Array.from(
      document.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style'),
    )
      .map((node) => node.outerHTML)
      .join("\n");

    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${styles}
<style>
  /* The document IS the page here, so it needs none of the shell overrides. */
  @page { size: A4 portrait; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-size: 9pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Screen-only controls that came along with the clone. */
  button, [role="button"], .no-print { display: none !important; }
  /* Print-only blocks must show: the clone is not inside an @media print context
     until the dialog opens, and Safari resolves that late. */
  .hidden.print\\:block { display: block !important; }
  .hidden.print\\:flex { display: flex !important; }
  .hidden.print\\:grid { display: grid !important; }
  .print\\:hidden { display: none !important; }
  img { max-width: 100%; }
  table { width: 100%; border-collapse: collapse; }
  tr, img { break-inside: avoid; }
  thead { display: table-header-group; }

  /* ── One report layout, whichever screen printed it ──────────────────────── */

  /* A card is a unit: split across a page break it reads as two half-cards. */
  [class*="rounded-lg"], [class*="rounded-xl"], section { break-inside: avoid; }

  /* Charts. The clone is static HTML, so a chart is whatever SVG the screen had —
     but the wrapper Recharts sizes at runtime measures nothing here, which left
     empty framed boxes where "WOs per Day" and "Orders by Status" should be. Sizes
     are stamped onto the clone from the live layout (below) and clamped here so a
     chart wider than A4 shrinks instead of being cut. */
  svg { max-width: 100% !important; height: auto; }
  .recharts-responsive-container, .recharts-wrapper { max-width: 100% !important; }
  /* Legends are absolutely positioned on screen; on paper they escaped the card
     and printed as stray words down the right-hand edge ("finish", "activ"). */
  .recharts-legend-wrapper { position: static !important; margin-top: 4px; }

  /* The empty-state block a chart shows when it has no data must print — an empty
     bordered box says nothing, "No data available" says the report is complete. */
  .recharts-surface:empty { display: none !important; }
</style></head><body></body></html>`);
    doc.close();

    const clone = doc.importNode(el, true) as HTMLElement;
    stampChartSizes(el, clone);
    doc.body.appendChild(clone);
    appendFooter(doc, title);
    // Dark mode is a screen preference; on paper it wastes toner and reads badly.
    doc.documentElement.classList.remove("dark");

    await waitForImages(doc);
    // One frame for layout to settle before the dialog snapshots the document.
    await new Promise((r) => window.requestAnimationFrame(() => r(null)));

    win.focus();
    win.print();
  } finally {
    cleanup();
  }
}

/**
 * Copies the on-screen size of every chart onto the clone.
 *
 * Recharts sizes its container at runtime from a ResizeObserver. The clone is static
 * HTML with no React and no observer, so those containers measured nothing and the
 * chart cards printed as empty framed boxes — the report looked like it had lost its
 * data. The SVG itself comes across intact; it only needs to be told how big it was.
 *
 * Walks both trees in the same order, which is safe because the clone is a deep copy
 * of the source and neither is mutated.
 */
function stampChartSizes(source: HTMLElement, clone: HTMLElement) {
  const sel = ".recharts-responsive-container, .recharts-wrapper, svg";
  const from = source.querySelectorAll<HTMLElement>(sel);
  const to = clone.querySelectorAll<HTMLElement>(sel);
  for (let i = 0; i < from.length && i < to.length; i++) {
    const r = from[i].getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    to[i].style.width = `${Math.round(r.width)}px`;
    to[i].style.height = `${Math.round(r.height)}px`;
    if (to[i] instanceof SVGElement || to[i].tagName.toLowerCase() === "svg") {
      to[i].setAttribute("width", String(Math.round(r.width)));
      to[i].setAttribute("height", String(Math.round(r.height)));
    }
  }
}

/**
 * The footer every printed document carries.
 *
 * Added here rather than on each screen, so a new report cannot ship without one —
 * three of them had hand-written footers and the rest had none. Page numbers are
 * deliberately absent: browsers do not support CSS page counters in print, and the
 * jsPDF reports that can number their pages already do.
 */
function appendFooter(doc: Document, title: string) {
  if (doc.querySelector(".print-doc-footer")) return;
  const el = doc.createElement("div");
  el.className = "print-doc-footer";
  el.style.cssText =
    "margin-top:6mm;padding-top:2mm;border-top:1px solid #000;display:flex;" +
    "justify-content:space-between;font-size:7pt;color:#333;";
  const printed = new Date().toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
  el.innerHTML =
    `<span>${escapeHtml(title)}</span>` +
    `<span>Applied Nutrition &middot; Confidential &middot; printed ${escapeHtml(printed)}</span>`;
  doc.body.appendChild(el);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Resolves once every image has loaded or failed — a print that races the logo prints a gap. */
function waitForImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images);
  if (!imgs.length) return Promise.resolve();
  return new Promise((resolve) => {
    let left = imgs.length;
    const done = () => { if (--left <= 0) resolve(); };
    // Never hang the print on a broken asset.
    const timer = window.setTimeout(resolve, 3000);
    imgs.forEach((img) => {
      if (img.complete) return done();
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });
    if (left <= 0) { window.clearTimeout(timer); resolve(); }
  });
}
