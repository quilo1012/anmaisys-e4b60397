import { statusForPlacement, type AllocStatus, type RotaCover } from "@/lib/rotaStatus";

/**
 * Copying yesterday's board onto today.
 *
 * A board is who is standing where. That is the only thing worth copying: the rest of
 * an allocation row — a half day, a note, an absence — is a record of one date and is
 * not true of another one just because the same people are back in.
 *
 * Three rules, all of them learnt from rows already in the table:
 *
 * - **Only people who were working.** The source day carries its sick, its holidays
 *   and its unpaid days as rows too. Copying those forward would book somebody off for
 *   a day nobody has decided anything about yet. `is_leader` stays behind for the same
 *   reason the rest of the day does: who led Line 2 on Friday is a fact about Friday,
 *   and the board names today's leader in one press.
 * - **Nothing the target day already says is touched.** 09/08 to 13/08 held nothing
 *   but holiday marks, entered days ahead of anybody being placed; an upsert over them
 *   would have replaced approved leave with an ordinary shift, silently.
 * - **The rota is asked again.** The source is a different date, so the same placement
 *   can be a different kind of day — a Friday night copied onto Saturday is nobody's
 *   rota and has to be saved as overtime. The mark does not travel with the person
 *   either: a Saturday call-in copied onto a rostered Monday is an ordinary Monday.
 */

/** What the source day says about one person. Extra columns are ignored on purpose. */
export interface BoardPlacement {
  employee_id: string;
  area_id: string | null;
  status: string;
}

/** A row ready to insert: where somebody stands, and how the day counts. */
export interface CopiedRow {
  on_date: string;
  shift: string;
  employee_id: string;
  area_id: string | null;
  status: AllocStatus;
}

/** One day offered as something to copy: the date, and how many people it holds. */
export interface CopyableDay {
  on_date: string;
  people: number;
}

/** How many days the menu offers. Ten is a fortnight of a board that runs weekdays. */
export const COPYABLE_DAYS_SHOWN = 10;

/**
 * The days worth copying, most recent first.
 *
 * Built from working rows only, which is what makes the list useful: 06/08 and 09/08
 * to 13/08 each hold two or three holiday marks and nobody else, and offering them
 * would be offering an empty board. The count beside each date is the point — it is
 * how somebody tells a full Tuesday from a skeleton Saturday before pressing anything.
 *
 * `maybeTruncated` says the rows are a block off the top of a longer answer, because
 * PostgREST caps a response and a board runs to eighty rows a day. The oldest date in
 * a capped block is the one that can be half there, so it is dropped rather than shown
 * with a count that is quietly too low.
 */
export function copyableDays(
  rows: Array<{ on_date: string; employee_id: string }>,
  opts: { maybeTruncated: boolean },
): CopyableDay[] {
  const byDate = new Map<string, Set<string>>();
  for (const r of rows) {
    const people = byDate.get(r.on_date) ?? new Set<string>();
    people.add(r.employee_id);
    byDate.set(r.on_date, people);
  }
  const days = [...byDate.entries()]
    .map(([on_date, people]) => ({ on_date, people: people.size }))
    .sort((a, b) => b.on_date.localeCompare(a.on_date));
  if (opts.maybeTruncated && days.length > 1) days.pop();
  return days.slice(0, COPYABLE_DAYS_SHOWN);
}

export function rowsToCopy(input: {
  /** The source day's rows, on this same board. */
  source: BoardPlacement[];
  onDate: string;
  shift: string;
  /** Everybody the target day already holds a row for, whatever it says. */
  alreadyOnTheDay: Iterable<string>;
  /** Whether the rota puts this person on this board on the target date. */
  cover: (employeeId: string) => RotaCover;
}): CopiedRow[] {
  const skip = new Set(input.alreadyOnTheDay);
  const taken = new Set<string>();
  const out: CopiedRow[] = [];

  for (const row of input.source) {
    if (row.status !== "assigned" && row.status !== "overtime") continue;
    if (skip.has(row.employee_id) || taken.has(row.employee_id)) continue;
    taken.add(row.employee_id);
    out.push({
      on_date: input.onDate,
      shift: input.shift,
      employee_id: row.employee_id,
      area_id: row.area_id,
      // No existing mark to defer to — these are people the day has nothing on yet.
      status: statusForPlacement("assigned", null, input.cover(row.employee_id)),
    });
  }

  return out;
}
