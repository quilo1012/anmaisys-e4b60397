import type { Allocation, HeadcountArea } from "@/hooks/useHeadcount";

/**
 * The hours a shift actually cost, by line.
 *
 * Pulled out of `HeadcountHoursTable` because the table was answering a narrower
 * question than the one it printed. It walked the board's areas and showed a row for
 * each, so anybody placed somewhere that is not one of them was not in a row — and
 * was not in the Total either, since the Total was the sum of the rows. A table with
 * a Total line that quietly omits part of the shift is worse than no table.
 *
 * Two ways to fall out of it, both live on the record:
 *
 *   - **A deactivated area.** `useHeadcountAreas` reads `active = true`, and Pill Line
 *     is inactive with 101 placements on it, 2 to 4 a day as late as 01/10/2026.
 *   - **No area at all.** 100 placements have `area_id` null. On 18/07/2026 eight of
 *     the forty people on the Day board had none, so the table lost a fifth of the
 *     shift; on 28/07 it lost ten of seventy-four.
 *
 * Nothing is dropped here. Anything with no column of its own gets a row saying so,
 * and the total is the total.
 */

/** Shifts are 06–18 / 18–06: 12h. A half day counts 6h. */
export const SHIFT_H = 12;

/** The row that holds placements with no area recorded at all. */
export const NO_AREA_KEY = "__no_area__";

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Hours worked by one placement, from the shift length, half day and late/early times. */
export function allocationHours(a: Allocation, shift: string): number {
  if (a.half_day) return SHIFT_H / 2;
  const start = shift === "Night" ? 18 * 60 : 6 * 60;
  const rel = (t: string) => ((toMin(t) - start) + 1440) % 1440;
  const from = a.arrived_late_at ? rel(a.arrived_late_at) : 0;
  const to = a.left_early_at ? rel(a.left_early_at) : SHIFT_H * 60;
  return Math.max(0, Math.min(SHIFT_H * 60, to) - from) / 60;
}

export interface HoursRow {
  /** Area id, or `NO_AREA_KEY`. */
  key: string;
  area: string;
  people: number;
  hours: number;
  otPeople: number;
  ot: number;
  /**
   * True when this row has no column on today's board — a deactivated area, an area
   * that has since been deleted, or no area recorded. The shift was still worked.
   */
  offBoard: boolean;
}

export interface HoursTotals {
  people: number;
  hours: number;
  otPeople: number;
  ot: number;
}

const empty = () => ({ people: 0, hours: 0, otPeople: 0, ot: 0 });

/**
 * One row per area with somebody on it, the board's own areas first.
 *
 * @param areas the board's columns, in board order — active areas only, which is
 *   exactly why the off-board rows exist.
 * @param areaNameById every area ever, including the deactivated ones, so a row can
 *   name the line rather than calling it "Not on the board". Optional: without it the
 *   placements are still counted, just not named.
 */
export function hoursByArea({
  allocations,
  shift,
  areas,
  areaNameById,
}: {
  allocations: ReadonlyArray<Allocation>;
  shift: string;
  areas: ReadonlyArray<HeadcountArea>;
  areaNameById?: ReadonlyMap<string, string>;
}): { rows: HoursRow[]; totals: HoursTotals } {
  const by = new Map<string, HoursTotals>();
  for (const a of allocations) {
    if (a.status !== "assigned" && a.status !== "overtime") continue;
    const key = a.area_id ?? NO_AREA_KEY;
    const r = by.get(key) ?? empty();
    const h = allocationHours(a, shift);
    if (a.status === "overtime") { r.otPeople++; r.ot += h; } else { r.people++; r.hours += h; }
    by.set(key, r);
  }

  const onBoard = areas
    .filter((ar) => by.has(ar.id))
    .map((ar): HoursRow => ({ key: ar.id, area: ar.name, ...by.get(ar.id)!, offBoard: false }));

  const boardIds = new Set(areas.map((a) => a.id));
  const offBoard = [...by.entries()]
    .filter(([key]) => key !== NO_AREA_KEY && !boardIds.has(key))
    .map(([key, totals]): HoursRow => ({
      key,
      area: areaNameById?.get(key) ?? "Not on the board",
      ...totals,
      offBoard: true,
    }))
    .sort((a, b) => a.area.localeCompare(b.area));

  // Last, because it is the one row nobody can act on by line — but it is counted.
  const noArea = by.get(NO_AREA_KEY);
  const rows = [
    ...onBoard,
    ...offBoard,
    ...(noArea ? [{ key: NO_AREA_KEY, area: "No area recorded", ...noArea, offBoard: true }] : []),
  ];

  const totals = rows.reduce<HoursTotals>(
    (s, r) => ({
      people: s.people + r.people,
      hours: s.hours + r.hours,
      otPeople: s.otPeople + r.otPeople,
      ot: s.ot + r.ot,
    }),
    empty(),
  );

  return { rows, totals };
}
