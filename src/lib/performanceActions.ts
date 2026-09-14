import { getShift, shiftSessionDate } from "@/lib/shifts";

/** The two fields any quality action carries about when it happened. */
export interface ActionWhen {
  recorded_at: string;
  shift?: string | null;
}

/**
 * Which shift an action belongs to.
 *
 * The column when it was filled in, the clock when it was not.
 *
 * `quality_actions.shift` is only written by the hand-typed log. Everything the
 * SafetyCulture sync brings in — 123 of the 188 rows on 13/09/2026, and every
 * single one raised since 13/08 — lands with `shift` null, because the source has
 * no such field. Treating that blank as "belongs to neither shift" emptied the
 * Production Performance report of a month of quality actions.
 *
 * A blank is not a third shift; it is a row that only has a timestamp, and the hour
 * is the right question for it — the same reading `workOrdersInPeriod` already
 * applies to work orders, which carry no shift column at all.
 *
 * Where the column IS filled it wins, and the disagreement is not hypothetical:
 * bulk-imported history landed with a synthetic midday timestamp and a real NIGHT
 * in the column, and reading the clock there would file a night under a day nobody
 * worked. See {@link shiftSessionDate}, which keeps the same order of precedence.
 */
export function actionShift(a: ActionWhen): "DAY" | "NIGHT" {
  const recorded = (a.shift ?? "").trim().toUpperCase();
  if (recorded === "DAY" || recorded === "NIGHT") return recorded;
  return getShift(a.recorded_at) === "night" ? "NIGHT" : "DAY";
}

/** Whether the log itself said which shift this was — the report footnotes the rest. */
export function shiftWasRecorded(a: ActionWhen): boolean {
  const recorded = (a.shift ?? "").trim().toUpperCase();
  return recorded === "DAY" || recorded === "NIGHT";
}

export interface ReportPeriod {
  from: string;
  to: string;
  shift: "all" | "DAY" | "NIGHT";
}

/**
 * The actions a report for this period should print.
 *
 * Applied here rather than in the query for two reasons. A shift the clock has to
 * work out cannot be asked of Postgres through PostgREST, and the fetch deliberately
 * reaches into the morning after the period — a night that starts on the 13th is
 * still the 13th's night at 05:00 on the 14th — so something has to throw back what
 * does not belong. See `shiftDateFetchRange`.
 */
export function actionsInReportPeriod<T extends ActionWhen>(rows: T[], period: ReportPeriod): T[] {
  return rows.filter((a) => {
    const shift = actionShift(a);
    if (period.shift !== "all" && shift !== period.shift) return false;
    const day = shiftSessionDate(a.recorded_at, shift);
    return day >= period.from && day <= period.to;
  });
}
