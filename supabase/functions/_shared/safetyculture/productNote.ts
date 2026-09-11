/**
 * The product a SafetyCulture action is about, recovered from the note.
 *
 * Lives on the edge-function side because the sync is what writes `sku` and
 * `batch`; `src/lib/qualityProductNote.ts` re-exports it so the report and the
 * sync can never drift into reading the same sentence two different ways.
 *
 * `quality_actions.sku` and `.batch` are written by the log form and by the old
 * spreadsheet import. **Nothing writes them for a SafetyCulture row** — the API's
 * Action carries no product field, and `_shared/safetyculture/sync.ts` does not
 * name either column in its payload. Every action since 01/09/2026 arrives that
 * way, so the report's SKU, Product and Batch columns came out blank on all 106 of
 * them while the operator had in fact written the product down: in the Action's
 * free-text description, as
 *
 *     Muscle Moose Whey Protein Vanilla 900g / MM26252 / 09-2026 , 09-2028
 *     └─ product ──────────────────────────┘   └ batch ┘   └ best before ┘
 *
 * This module reads that shape back. It never invents one: a description with no
 * batch-shaped middle segment (`Battery died`, `Emergency light not working`) is
 * left alone, which is most of them — those actions are about a floor or a bin and
 * have no product to name.
 */

/** `MM26252`, `A26213`, `L26244` — one to three letters, then the run's digits. */
const BATCH = /^[A-Z]{1,3}\d{4,6}$/;

export interface ProductNote {
  /** What the operator typed, verbatim minus the padding. */
  product: string;
  /** The batch code, upper-cased. */
  batch: string;
}

/**
 * `product / BATCH / dates` → its two halves, or null when the text is not that.
 *
 * The batch segment is what decides: plenty of titles carry a stray slash
 * ("Air Extractor ( L6/ Maintenance)") and none of them is a product note.
 */
export function parseProductNote(text: string | null | undefined): ProductNote | null {
  const parts = (text ?? "").split("/");
  if (parts.length < 3) return null;
  // Second segment only. A third slash belongs to a date written 09/2026, and the
  // product name itself never contains one.
  const batch = parts[1].trim().toUpperCase();
  if (!BATCH.test(batch)) return null;
  const product = parts[0].replace(/\s+/g, " ").trim();
  if (!product) return null;
  return { product, batch };
}

/** Words worth matching on: drops punctuation, emoji, and the units' separators. */
function tokens(s: string): string[] {
  return s
    .toUpperCase()
    .replace(/\[[^\]]*\]/g, " ") // "[HS CODE:2106108070]" is on every catalogue name
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/**
 * Which of a batch's SKUs the note is about.
 *
 * A batch code is not a SKU: `production_items` says batch A26213 was run as both
 * CRE250 and CRE500, and Y26245 as both the UK and the Australia pack. When the
 * batch ran one SKU that is the answer; when it ran several, the operator's own
 * words break the tie — "Creatine Monohydrate Unflavoured 250g" carries 250G, which
 * only one of the two candidates does.
 *
 * A tie that the words do not break returns null. A guessed code on a document that
 * gets signed and filed is worse than an empty cell, and the product name the
 * operator wrote is printed either way.
 */
export function resolveSkuFromNote(
  note: ProductNote,
  candidates: { code: string; name: string }[],
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].code;
  const wanted = new Set(tokens(note.product));
  const scored = candidates.map((c) => {
    const own = tokens(c.name);
    // Every word of the note the candidate accounts for, less every word the
    // candidate adds that the note never mentions — which is how "AUSTRALIA
    // CREATINE 250G…" loses to "CREATINE 250G…" against a note that says neither
    // country.
    const hit = own.filter((t) => wanted.has(t)).length;
    const extra = own.length - hit;
    return { code: c.code, score: hit - extra };
  });
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].code;
}
