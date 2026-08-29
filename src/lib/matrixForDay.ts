/**
 * Which standard board a date is planned from.
 *
 * The day board had two standards and somebody chose between them every morning. That
 * was the right shape while there were two, and it stopped being right at four: the
 * choice is not a judgement, it is the weekday, and a menu that asks a question with
 * one correct answer is a menu that will eventually be answered wrong — a Saturday
 * filled from the weekday standard is forty people booked as overtime.
 *
 * So the date names the standard, and the menu still lists all four for the mornings
 * that are not ordinary: a bank holiday Monday worked like a Saturday, a Friday the
 * factory runs as a full shift.
 *
 *   Monday      Fri–Mon finishing   +  Mon–Thu starting
 *   Tue–Thu     Mon–Thu             +  Tue–Fri            (the full shift)
 *   Friday      Tue–Fri finishing   +  Fri–Mon starting
 *   Sat, Sun    Fri–Mon
 *
 * The night board keeps the two standards it always had, chosen by hand: nights are
 * one crew and its weekdays are the rota's business, so there is no day type to read.
 */

export type MatrixKind = "normal" | "changeover" | "monday" | "full" | "friday" | "weekend";

/** A standard offered on a board: what it is called, and what kind of day it is for. */
export interface MatrixKindSpec {
  kind: MatrixKind;
  label: string;
  hint: string;
}

/** In the order the week runs, which is the order somebody looks for one in a list. */
const DAY_KINDS: MatrixKindSpec[] = [
  { kind: "monday", label: "Monday", hint: "Fri–Mon finishing as Mon–Thu starts" },
  { kind: "full", label: "Full shift", hint: "Tuesday to Thursday — both weekday crews on the lines" },
  { kind: "friday", label: "Friday", hint: "Tue–Fri finishing as Fri–Mon starts" },
  { kind: "weekend", label: "Weekend", hint: "Saturday and Sunday — the Fri–Mon crew" },
];

/** The night board's two, unchanged: the same names its menu has always shown. */
const NIGHT_KINDS: MatrixKindSpec[] = [
  { kind: "normal", label: "standard day", hint: "the middle of the week, one crew steady on each line" },
  { kind: "changeover", label: "changeover day", hint: "a crew finishing and a crew starting — Mondays and Fridays" },
];

/** The standards this board has. Four on days, two everywhere else. */
export function matrixKindsFor(shift: string): MatrixKindSpec[] {
  return shift === "Day" ? DAY_KINDS : NIGHT_KINDS;
}

/**
 * The standard this date is planned from, or null where the weekday does not decide.
 *
 * Read at midday, like every other date in this codebase: `new Date("2026-08-31")` is
 * UTC midnight, which is the Sunday before in any timezone west of UTC — and a Monday
 * board would then be offered the weekend matrix.
 */
export function matrixForDate(shift: string, iso: string): MatrixKind | null {
  if (shift !== "Day") return null;
  const w = new Date(`${iso}T12:00:00`).getDay();
  if (w === 0 || w === 6) return "weekend";
  if (w === 1) return "monday";
  if (w === 5) return "friday";
  return "full";
}
