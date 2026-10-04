/**
 * Whether a name is already on the employee record, written slightly differently.
 *
 * On 04/10/2026 the record held FELIPE DE ARAUJO and FELIPE ARAUJO: two active rows,
 * the same Night crew, the same start date of 30/06, and one man. The work split
 * across them — 37 placements and 40 attendance days on one, 7 and 8 on the other,
 * the newer row taking over from 30/09 — so he is two people to the headcount, and
 * his holiday balance, his sickness count and his overtime are each half of
 * themselves on two rows of the Leave screen. Ezaquiel dos Santos is the same story
 * with a leaver: he left on 04/08 and came back as a second row rather than as
 * himself.
 *
 * Nothing stops a third. "Add employee" takes a name and writes it, and the office
 * has no way of seeing that the name is already there under one more word. So the
 * dialog asks this first.
 *
 * It warns and never blocks. Two brothers on the same line is a real thing in this
 * factory, and a screen that refuses a real name is worse than one that asks.
 */

/**
 * Words that are spelling rather than name: the payroll list writes "FELIPE DE
 * ARAUJO" and the floor writes "FELIPE ARAUJO", and they mean one person.
 *
 * `Junior`, `Filho` and `Neto` are deliberately NOT here. They are what tells a
 * father from his son, and dropping them would merge two people who both work here.
 */
const CONNECTIVES = new Set([
  "de", "do", "da", "dos", "das", "du", "del", "della", "di", "e",
  "la", "le", "van", "von", "der", "den", "bin", "al", "of",
]);

/** Accents off, case off, punctuation to spaces: `José  da-Silva` → `jose da silva`. */
export function normaliseName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The name's words, with the connectives dropped. */
export function nameTokens(raw: string): string[] {
  return normaliseName(raw)
    .split(" ")
    .filter((t) => t && !CONNECTIVES.has(t));
}

/**
 * One name, reduced to what makes it that name: its words, sorted, connectives gone.
 *
 * Sorted because the record holds both orders — the sheets write a surname first as
 * often as last — and "Araujo Felipe" is not a second employee.
 */
export function nameKey(raw: string): string {
  return nameTokens(raw).slice().sort().join(" ");
}

/** How sure we are. `same` is the same name; `close` wants a human to look. */
export type NameMatchStrength = "same" | "close";

/** Edit distance, but it stops caring past one. Two typos is a different name. */
function differsByAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let slips = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (++slips > 1) return false;
    if (short.length === long.length) { i++; j++; } else { j++; }
  }
  return slips + (long.length - j) + (short.length - i) <= 1;
}

function isSubsetOf(small: string[], large: string[]): boolean {
  const pool = [...large];
  for (const t of small) {
    const at = pool.indexOf(t);
    if (at === -1) return false;
    pool.splice(at, 1);
  }
  return true;
}

/** How a typed name compares with one already on file, or null when they are unrelated. */
export function compareNames(typed: string, existing: string): NameMatchStrength | null {
  const a = nameTokens(typed);
  const b = nameTokens(existing);
  if (a.length === 0 || b.length === 0) return null;

  const keyA = a.slice().sort().join(" ");
  const keyB = b.slice().sort().join(" ");
  if (keyA === keyB) return "same";

  // A typo of one letter anywhere in the whole name. `Juniour` for `Junior` is how
  // one man becomes two rows without anybody typing a different name.
  if (differsByAtMostOne(keyA, keyB)) return "close";

  // The record carries middle names the typist left out, or the other way round.
  // Two shared words at least: a first name in common is not a match, or half the
  // Felipes in the building would warn about the other half.
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  if (small.length >= 2 && isSubsetOf(small.slice().sort(), large.slice().sort())) return "close";

  return null;
}

/**
 * Everybody on file whose name may be this name, strongest first.
 *
 * Leavers included. Somebody coming back is a record to reopen — their attendance
 * and their overtime balance are on it — and typing them again is how the record
 * grew a second Ezaquiel.
 */
export function similarNames<T extends { full_name: string }>(
  typed: string,
  onFile: ReadonlyArray<T>,
): (T & { strength: NameMatchStrength })[] {
  if (nameTokens(typed).length === 0) return [];
  const rank: Record<NameMatchStrength, number> = { same: 0, close: 1 };
  return onFile
    .map((row, i) => ({ row, i, strength: compareNames(typed, row.full_name) }))
    .filter((m): m is { row: T; i: number; strength: NameMatchStrength } => m.strength !== null)
    .sort((x, y) => rank[x.strength] - rank[y.strength] || x.i - y.i)
    .map((m) => ({ ...m.row, strength: m.strength }));
}
