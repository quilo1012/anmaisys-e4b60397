/**
 * A shift's output is a whole number of units, and the column says so.
 *
 * `production_blender_entries.quantity` is `integer`. The Log Production screen
 * validated with `Number.isFinite(q) && q > 0`, which 2.428 passes, so the row
 * travelled to PostgREST and came back as
 * `invalid input syntax for type integer: "2.428"` — filed as an API_ERROR against
 * an operator on a tablet at the end of a shift.
 *
 * WHY THIS REFUSES INSTEAD OF ROUNDING, which is the whole design and the reason
 * this is a file rather than a `Math.round` at the call site. Measured against the
 * live database on 2026-08-26: 850 entries, median 1000, p90 4187, and exactly one
 * below ten. `2.428` is 2428 written with a thousands separator — the habit of
 * every Portuguese and Brazilian keyboard on the floor. Rounding it gives 2, and 2
 * would be filed as a real shift's output with nothing anywhere to say the figure
 * is off by a thousand. The current failure is ugly and loud; rounding would be
 * tidy and wrong, and this codebase has already paid for one silent downgrade.
 *
 * So the separator is DETECTED and NAMED, never applied. The operator is told the
 * number they almost certainly meant and types it themselves — the app never files
 * a figure nobody entered.
 */

/**
 * Two fields rather than a discriminated union on `ok`: this project compiles with
 * `strict: false` and `strictNullChecks: false`, where narrowing a `{ok: true} |
 * {ok: false}` union does not work and every call site would need a cast. Read
 * `message` first — non-null means refused.
 */
export interface WholeQuantity {
  /** The parsed integer, or null when the text was refused. */
  value: number | null;
  /** Why it was refused, or null when it was accepted. */
  message: string | null;
}

/**
 * `2.428`, `2,428`, `1.234.567` — one to three digits, then groups of exactly
 * three. Anchored and exact on purpose: `2.5` and `2.4281` are not separator runs
 * and must not be reported as one, because suggesting "25" to somebody who typed
 * "2.5" invents a number just as surely as rounding does.
 */
const SEPARATOR_RUN = /^\d{1,3}([.,]\d{3})+$/;

const refuse = (message: string): WholeQuantity => ({ value: null, message });

export function parseWholeQuantity(raw: string): WholeQuantity {
  const text = (raw ?? "").trim();
  if (text === "") return refuse("Enter a quantity greater than 0");

  if (SEPARATOR_RUN.test(text)) {
    const meant = text.replace(/[.,]/g, "");
    return refuse(`Quantity must be a whole number — write ${meant}, without the dot or comma.`);
  }

  const n = Number(text);
  if (!Number.isFinite(n)) return refuse("Enter a quantity greater than 0");
  if (!Number.isInteger(n)) return refuse("Quantity must be a whole number of units.");
  if (n <= 0) return refuse("Enter a quantity greater than 0");

  return { value: n, message: null };
}
