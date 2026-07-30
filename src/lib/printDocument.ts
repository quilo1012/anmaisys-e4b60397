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
</style></head><body></body></html>`);
    doc.close();

    doc.body.appendChild(doc.importNode(el, true));
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
