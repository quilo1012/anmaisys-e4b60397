/**
 * What has to be true before a maintenance order can be turned away.
 *
 * The gate was three characters. "Ooo" is three characters, and so is "..." — the two
 * reasons actually recorded when somebody rejected a report of a capsule polisher
 * giving an electric shock and a metal detection on Line 1, sixty seconds apart. Four
 * of the five rejections on the system have a reason of five characters or fewer.
 *
 * A length check cannot tell an explanation from a keystroke, so this asks two
 * questions instead: is there a real sentence here, and is this the kind of report
 * that should not be closed on somebody's say-so at all.
 */

/** Reasons that pass a length check and say nothing. */
const EMPTY_WORDS = new Set([
  "ok", "no", "na", "n/a", "nao", "não", "nope", "nada", "test", "teste",
  "asd", "asdf", "qwe", "xxx", "yyy", "zzz", "done", "fix", "fixed",
]);

/**
 * Why this reason is not good enough, or null when it is.
 *
 * Deliberately not a boolean: the person is about to be stopped, and being told
 * "min 3 characters" when they typed three characters is the message that trained
 * everybody to type "Ooo".
 */
export function rejectionReasonProblem(reason: string): string | null {
  const t = (reason ?? "").trim();
  if (t.length < 15) return "Say what was checked and why it does not need work — a few words is not a reason.";
  // "aaaaaaaaaaaaaaaa" clears a length check and a word count.
  const letters = t.replace(/[^\p{L}]/gu, "").toLowerCase();
  if (letters.length < 10) return "Mostly punctuation. Write what you found.";
  if (new Set(letters).size <= 3) return "That is the same character repeated. Write what you found.";
  const words = t.split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, "").length > 1);
  if (words.length < 3) return "Three words or more, please — enough for the next person to follow.";
  if (words.every((w) => EMPTY_WORDS.has(w.toLowerCase().replace(/[^\p{L}/]/gu, "")))) {
    return "That does not say anything. Write what you found.";
  }
  return null;
}

/**
 * Reports that must not be waved away.
 *
 * Two kinds, and they are here for different reasons. Safety, because somebody is
 * describing a way the factory can hurt a person. Contamination, because a metal
 * detection or a glass breakage is a product recall if it turns out to be real, and
 * the cost of checking is an hour.
 *
 * Matched on the words an operator actually types under pressure, in both languages
 * the floor uses. It errs towards catching too much: a false catch costs one extra
 * sentence and a tick, and a miss costs what WO-2026-000801 nearly cost.
 */
// No trailing word boundary: the report that started this says "Metal Detected", and
// `\bmetal detect\b` does not match it because the word carries on. Anchored at the
// start of a word only, so "shock" catches "shocked" and "shocking" as well.
const SAFETY = /\b(shock|choque|electrocut|electric|el[ée]tric|fire\b|fogo\b|inc[êe]ndio|burn|queimad|injur|ferid|acidente|accident|trapped|entalad|guard|prote(c|ç)[ãa]o|fume|fuma|smell of|cheiro a|exposed wire|fio exposto|hot surface)/i;
const CONTAMINATION = /\b(metal\s*dete|contaminat|contamina(ç|c)[ãa]o|foreign body|corpo estranho|glass\b|vidro\b|plastic in|pl[áa]stico no|oil in|[óo]leo no|grease in|allergen|alerg[ée]n)/i;

export type ConcernKind = "safety" | "contamination";

/**
 * What kind of report this is, from the operator's own words. Null for ordinary work.
 */
export function concernInDescription(description: string | null | undefined): ConcernKind | null {
  const t = (description ?? "").trim();
  if (!t) return null;
  if (SAFETY.test(t)) return "safety";
  if (CONTAMINATION.test(t)) return "contamination";
  return null;
}

/** What the person rejecting has to confirm, in the words they will read. */
export function concernWarning(kind: ConcernKind): string {
  return kind === "safety"
    ? "This reads as a safety report — somebody has described a way this machine can hurt a person. It cannot be rejected without saying who checked it and what they found."
    : "This reads as a contamination report. If it is real it is a product decision, not a maintenance one. It cannot be rejected without saying who checked it and what they found.";
}

/** A concern needs a fuller account than an ordinary rejection. */
export function reasonProblemFor(
  description: string | null | undefined,
  reason: string,
): string | null {
  const base = rejectionReasonProblem(reason);
  if (base) return base;
  if (concernInDescription(description) && reason.trim().length < 40) {
    return "For a safety or contamination report, say who inspected it, when, and what they found.";
  }
  return null;
}
