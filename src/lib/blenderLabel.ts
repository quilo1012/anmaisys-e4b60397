/**
 * The blender box has a ceiling, and now the screen knows it.
 *
 * `production_blender_entries.blender_number` is `smallint` under
 * `CHECK (blender_number >= 1 AND blender_number <= 999)`. Log Production
 * validated `Number.isFinite(n) && n >= 1` and nothing else, so every figure above
 * the ceiling bought a network round trip and came back as
 * `new row for relation "production_blender_entries" violates check constraint
 * "production_blender_entries_blender_number_check"` — filed twice as an API_ERROR
 * against the Line 4 operator on 26/08 at 22:56 and 22:57 UTC.
 *
 * WHAT WENT IN THE BOX, and why the message names it. Two minutes after the second
 * refusal the same operator saved blender "33" on batch A26213, so the box did not
 * hold a blender. The batch field sits beside it, and the screen reads the first
 * run of digits: `"A26213".match(/\d+/)` is `26213`. A toast saying "invalid"
 * would hide that; a toast saying the app read 26213 puts the batch code back in
 * front of the person who typed it, which is the same trade
 * `parseWholeQuantity` makes when it names a thousands separator instead of
 * rounding it away.
 *
 * WHY 999 AND NOT 99. The old ceiling was 99 and it was not slack. `blender_number`
 * is not the machine — it is the blend's number within its batch, and it climbs for
 * as long as the batch runs: CRE250 on batch A26213 went 30 → 35 across two days,
 * and batch B26188 reached 69 in five. A batch running a fortnight walks through 99
 * on its own, with nobody mistyping anything, and the operator on shift that night
 * would have met a constraint name for doing the job correctly. 999 is three
 * digits of headroom against a smallint that holds 32767, and it still catches a
 * five-digit batch code, which is the mistake that actually happens.
 */

/**
 * The database's upper bound, kept here so the screen refuses before PostgREST
 * does. Raising it means a migration on `production_blender_entries` first — see
 * `supabase/migrations/20260827120000_blender_number_ceiling.sql`.
 */
export const MAX_BLENDER_NUMBER = 999;

/**
 * Two nullable fields and a message rather than a discriminated union on `ok`:
 * this project compiles with `strict: false` and `strictNullChecks: false`, where
 * narrowing a union does not work and every call site would need a cast. Read
 * `message` first — non-null means refused, and `label`/`number` are null.
 */
export interface ParsedBlender {
  /** The label exactly as typed, trimmed. This is the entry's identity. */
  label: string | null;
  /** The first run of digits in the label — the value the numeric column takes. */
  number: number | null;
  /** Why it was refused, or null when it was accepted. */
  message: string | null;
}

/** What the operator is told when the box holds nothing usable. */
const ASK = "Enter the blender (e.g. 3 or 7/8)";

const refuse = (message: string): ParsedBlender => ({ label: null, number: null, message });

export function parseBlenderLabel(raw: string): ParsedBlender {
  const label = (raw ?? "").trim();
  if (label === "") return refuse(ASK);

  // Blenders can be combined ("7/8"). The typed label stays the identity and the
  // first number feeds the numeric column used in reporting.
  const digits = label.match(/\d+/);
  if (!digits) return refuse(ASK);

  const number = Number(digits[0]);
  if (!Number.isFinite(number) || number < 1) return refuse(ASK);

  if (number > MAX_BLENDER_NUMBER) {
    // Letters in the box mean a code, not a blender, and the only code within
    // reach of this field is the batch. Say so — but only then, because telling
    // somebody who fat-fingered "4820" to check the batch field sends them
    // looking at a field that is perfectly fine.
    const looksLikeACode = /[A-Za-z]/.test(label);
    return refuse(
      looksLikeACode
        ? `Blender must be 1–${MAX_BLENDER_NUMBER} — "${label}" reads as ${number}. Is that the batch code?`
        : `Blender must be 1–${MAX_BLENDER_NUMBER} — this reads as ${number}.`,
    );
  }

  return { label, number, message: null };
}
