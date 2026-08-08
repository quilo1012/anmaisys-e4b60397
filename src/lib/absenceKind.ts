/**
 * What kind of day off it was, from whatever the source called it.
 *
 * Three systems name the same day three ways. TimeMoto writes `Vacation` and
 * `Unpaid Leave` on the clock record; the headcount board writes `holiday`, `sick`,
 * `unpaid`; the Leave screen writes `holiday`. The finance close already folded them
 * into one vocabulary, privately, inside its own file — so when the attendance screen
 * needed the same fold it was one regex away from being written a second time, in a
 * second place, with a second opinion about whether `annual leave` counts.
 *
 * It lives here so there is one answer. The close imports it; so does Time & Attendance.
 *
 * The order of the tests is the rule, not an accident: sick is read first, so
 * "unpaid sick leave" is sickness that happens not to be paid rather than unpaid leave
 * somebody was ill during. Payroll treats it as the former.
 */

export type AbsenceKind = "holiday" | "sick" | "unpaid" | "other";

const SICK = /sick/i;
const HOLIDAY = /holiday|vacation|annual/i;
const UNPAID = /unpaid/i;

export function absenceKind(name: string): AbsenceKind {
  if (SICK.test(name)) return "sick";
  if (HOLIDAY.test(name)) return "holiday";
  if (UNPAID.test(name)) return "unpaid";
  return "other";
}

export interface AbsenceSplit {
  holiday: number;
  sick: number;
  unpaid: number;
  other: number;
  /**
   * Everything that was not booked holiday, still under the name the source used.
   *
   * Kept verbatim because the reason is the point of an unplanned day: "Unpaid Leave"
   * and "Jury service" are different problems, and collapsing both to "other" on the
   * screen loses the only thing a supervisor reads that cell for.
   */
  unplanned: Record<string, number>;
}

/**
 * A person's absence names and day counts, split into booked holiday and the rest.
 *
 * Holiday is separated because it is not an absence in any sense the floor cares
 * about: it was asked for, granted, paid, and drawn from an entitlement that has a
 * balance. Counting it beside sickness made a screen that said somebody was absent
 * twice when they were on holiday twice, and made the shift's absence total a number
 * nobody could act on.
 */
export function splitAbsences(counts: Record<string, number>): AbsenceSplit {
  const out: AbsenceSplit = { holiday: 0, sick: 0, unpaid: 0, other: 0, unplanned: {} };
  for (const [name, n] of Object.entries(counts)) {
    const kind = absenceKind(name);
    out[kind] += n;
    if (kind !== "holiday") out.unplanned[name] = (out.unplanned[name] ?? 0) + n;
  }
  return out;
}
