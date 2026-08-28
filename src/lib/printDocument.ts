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
export async function printElementAsDocument(
  el: HTMLElement,
  title: string,
  opts: {
    landscape?: boolean;
    /** Extra CSS for one document's own layout, injected last so it wins. */
    css?: string;
    /** Shrink the document until it fits in this many pages. Opt-in. */
    fitPages?: number;
  } = {},
): Promise<void> {
  const iframe = document.createElement("iframe");
  // Off-screen but still laid out — `display: none` would give images no chance to
  // load and Safari nothing to paginate.
  iframe.setAttribute("aria-hidden", "true");
  // Laid out at the paper's own width, so a landscape report is measured against
  // 297mm rather than being composed for a portrait page and then re-flowed by the
  // print engine.
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${opts.landscape ? "297mm" : "210mm"};height:${opts.landscape ? "210mm" : "297mm"};border:0;`;
  document.body.appendChild(iframe);

  const cleanup = () => {
    // Late enough for the print dialog to have taken its snapshot.
    window.setTimeout(() => iframe.remove(), 1000);
  };

  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error("Could not open a print document");

    // Stylesheets are copied with ABSOLUTE hrefs. The iframe's own document is
    // about:blank, so a relative "/assets/index-x.css" has no base to resolve
    // against — the sheet 404s and the report prints as unstyled text. `node.href`
    // is the DOM's already-resolved absolute URL.
    const styles = Array.from(
      document.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style'),
    )
      .map((node) => {
        if (node instanceof HTMLLinkElement) {
          return `<link rel="stylesheet" href="${node.href}">`;
        }
        return node.outerHTML;
      })
      .join("\n");

    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/"><title>${escapeHtml(title)}</title>${styles}
<style>
  /* The document IS the page here, so it needs none of the shell overrides. */
  /* Zero page margin, and our own padding inside the body instead.
     The browser prints its own header and footer — the date, the document title and
     the page URL — into the page margin box. With no margin there is nowhere for
     them to go, so the "https://lovable.dev/projects/…" line stops appearing on
     every report. The margin comes back as body padding, so the layout is unchanged.
     Note: this is the only lever a page has. Whoever prints can still switch
     "Headers and footers" back on in the print dialog; that setting is theirs. */
  @page { size: A4 ${opts.landscape ? "landscape" : "portrait"}; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { padding: 12mm; }
  body { font-size: 9pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Screen-only controls that came along with the clone. Only real buttons: KPI
     cards that double as filters carry role="button", and hiding those would have
     dropped the whole KPI row out of every printed report. */
  button, .no-print { display: none !important; }
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

  /* A table given a min-width for horizontal scrolling on screen cannot scroll on
     paper: it simply loses its right-hand columns off the edge. PM Intelligence's
     table asks for 900px, wider than A4 portrait. */
  [class*="min-w-["] { min-width: 0 !important; }
  th, td { word-break: break-word; }
</style>${opts.css ? `<style>${opts.css}</style>` : ""}</head><body></body></html>`);
    doc.close();

    const clone = doc.importNode(el, true) as HTMLElement;
    stampChartSizes(el, clone);
    doc.body.appendChild(clone);
    appendFooter(doc, title);
    // Dark mode is a screen preference; on paper it wastes toner and reads badly.
    doc.documentElement.classList.remove("dark");

    // Wait for the STYLESHEETS before anything else.
    //
    // This is what made the leader scorecard print as a column of unstyled text: the
    // link elements load asynchronously, and print() was being called before the CSS
    // arrived, so the browser snapshotted a document with no styles at all. Images
    // were waited for and stylesheets were not, which is why a report with a slow
    // logo happened to come out fine and one without did not.
    await waitForStylesheets(doc);
    await waitForImages(doc);
    // Two frames for layout to settle after the styles apply.
    await new Promise((r) => window.requestAnimationFrame(() => r(null)));
    await new Promise((r) => window.requestAnimationFrame(() => r(null)));

    if (opts.fitPages) shrinkToFit(doc, opts.fitPages, !!opts.landscape);

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
 * Shrinks a document until it fits in `pages` sheets.
 *
 * A one-page order is not a formatting preference: it is signed in ink, filed, and
 * read on a clipboard. When it runs 30mm over, the second sheet carries two
 * signature lines and nothing else, and the pair gets separated in the file.
 *
 * Everything the layout can do to save that 30mm is done in CSS. This is the last
 * resort for the orders CSS cannot save — a repair with forty timeline entries — and
 * it stops at MIN_FIT_SCALE, because an order nobody can read at arm's length is
 * worse than an order on two sheets.
 *
 * `zoom` rather than `transform: scale()`: zoom is a layout property, so the print
 * engine paginates the shrunken layout. A transform paints smaller over a box that
 * still measures its original height, which is how content ends up scaled AND still
 * spilling onto page two. Browsers without `zoom` ignore it and print as before.
 */
const MIN_FIT_SCALE = 0.7;

/** CSS defines 1in as 96px and 1mm as 1/25.4 of that, in every browser, always. */
const PX_PER_MM = 96 / 25.4;

function shrinkToFit(doc: Document, pages: number, landscape: boolean) {
  // Not `body.scrollHeight` and not `body.getBoundingClientRect()`: both report at
  // least the iframe's own 297mm viewport, so a short order measured as a full sheet
  // and a long one stopped growing at one. A zero-height marker at the end of the
  // content has no such floor.
  const marker = doc.createElement("div");
  marker.style.cssText = "height:0;clear:both;";
  doc.body.appendChild(marker);
  const contentPx = marker.getBoundingClientRect().bottom - doc.body.getBoundingClientRect().top;
  marker.remove();

  const padBottom = parseFloat(getComputedStyle(doc.body).paddingBottom) || 0;
  const height = contentPx + padBottom;
  // 0.98 of the sheet: the last rule must not land on the fold.
  const budget = (landscape ? 210 : 297) * pages * PX_PER_MM * 0.98;
  if (!(height > budget)) return;

  // One pass, not a loop. `zoom` scales every used length — font sizes and mm
  // paddings alike — so the shrunken layout is geometrically similar to this one:
  // the lines break in the same places and the height falls by exactly the factor.
  const scale = Math.max(MIN_FIT_SCALE, budget / height);
  (doc.body.style as unknown as Record<string, string>).zoom = String(scale);
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

/**
 * Resolves once every copied stylesheet has loaded or failed.
 *
 * Without this the print dialog can open on a document whose CSS has not arrived —
 * every card, grid and colour gone, the whole report a vertical list of words.
 * Capped, because a print must never hang on a stalled asset: unstyled output beats
 * a dialog that never opens.
 */
function waitForStylesheets(doc: Document): Promise<void> {
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  if (!links.length) return Promise.resolve();
  return new Promise((resolve) => {
    let left = links.length;
    const done = () => { if (--left <= 0) { window.clearTimeout(timer); resolve(); } };
    const timer = window.setTimeout(resolve, 4000);
    links.forEach((l) => {
      // sheet is populated once the CSSOM has it — the reliable "already loaded" test.
      let loaded = false;
      try { loaded = !!l.sheet; } catch { loaded = true; /* cross-origin, treat as ready */ }
      if (loaded) return done();
      l.addEventListener("load", done, { once: true });
      l.addEventListener("error", done, { once: true });
    });
    if (left <= 0) { window.clearTimeout(timer); resolve(); }
  });
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
