/**
 * What one board adds up to — the Headcount board's own figures, in one place.
 *
 * The board worked these out inline (ProductionHeadcountPage) and the Production
 * dashboard needs exactly the same numbers. Two copies of "who counts as working" is
 * how a dashboard and the screen it summarises come to disagree, so both read this.
 *
 * The rules, as the board has them:
 * - **Working** is status `assigned`. Overtime, training and the away columns are not
 *   in it: that total is the crew the day was planned with.
 * - **On lines** is working people in a `production` area; **support** is the rest of
 *   working.
 * - **Away** is `sick`, `unpaid` and `holiday`. Training is apart from it: a person in
 *   training is here and is paid.
 * - Only rows the board can draw count (`drawable` — active people, and leavers up to
 *   their last day; see `boardPeopleOn`). Counting what is not drawn is how a column
 *   reading zero sat under a total saying ten.
 * - **Not placed** is somebody the rota has due on this board today with no row at all,
 *   or with only a line-less `assigned` row (see `hasPlaceOnBoard`).
 */

/**
 * Whether a row puts somebody somewhere the board draws.
 *
 * `assigned` with no area is a place nobody can see: not in a column (those are keyed
 * by area), not in the away blocks (those are other statuses), and — because the row
 * exists — not in "Not placed yet" either. Copying a matrix that held somebody with no
 * line wrote exactly that: on 12/10 and 19/10 a batch of people sat in the total and on
 * no part of the screen. Such a row is treated as no place at all, so the person lands
 * in the tray where somebody can drag them onto a line. Overtime with no area is
 * different: it has its own block.
 */
export function hasPlaceOnBoard(a: { area_id: string | null; status: string }): boolean {
  return !(a.status === "assigned" && !a.area_id);
}
export interface BoardTallyInput {
  allocations: ReadonlyArray<{ employee_id: string; area_id: string | null; status: string }>;
  areas: ReadonlyArray<{ id: string; kind: string }>;
  /** Who the rota has due on this board on this day (`useShiftRoster().data`). */
  roster: ReadonlyArray<{ id: string }>;
  drawable: (employeeId: string) => boolean;
}

export interface BoardTally {
  /** Due in, by the rota. */
  onRota: number;
  working: number;
  onLines: number;
  support: number;
  overtime: number;
  training: number;
  away: { sick: number; unpaid: number; holiday: number; total: number };
  /** On the rota today and on no row of the board. */
  notPlaced: number;
  /** Working and overtime people per area id. Away rows have no area. */
  byArea: Map<string, { working: number; overtime: number }>;
}

export function tallyBoard({ allocations, areas, roster, drawable }: BoardTallyInput): BoardTally {
  const production = new Set(areas.filter((a) => a.kind === "production").map((a) => a.id));
  const rows = allocations.filter((a) => drawable(a.employee_id));
  const is = (s: string) => rows.filter((a) => a.status === s);

  const working = is("assigned").filter(hasPlaceOnBoard);
  const overtime = is("overtime");
  const sick = is("sick").length;
  const unpaid = is("unpaid").length;
  const holiday = is("holiday").length;

  const byArea = new Map<string, { working: number; overtime: number }>();
  for (const a of [...working, ...overtime]) {
    if (!a.area_id) continue;
    const cell = byArea.get(a.area_id) ?? { working: 0, overtime: 0 };
    if (a.status === "assigned") cell.working += 1; else cell.overtime += 1;
    byArea.set(a.area_id, cell);
  }

  // Any row at all places a person — away and training included — as the board's
  // "Not placed yet" tray reads it.
  const placed = new Set(allocations.filter(hasPlaceOnBoard).map((a) => a.employee_id));
  const onLines = working.filter((a) => a.area_id && production.has(a.area_id)).length;

  return {
    onRota: roster.length,
    working: working.length,
    onLines,
    support: working.length - onLines,
    overtime: overtime.length,
    training: is("training").length,
    away: { sick, unpaid, holiday, total: sick + unpaid + holiday },
    notPlaced: roster.filter((e) => !placed.has(e.id)).length,
    byArea,
  };
}

/** One day of the board, for a trend line and the period's absence breakdown. */
export interface BoardDay {
  on_date: string;
  working: number;
  overtime: number;
  sick: number;
  holiday: number;
  unpaid: number;
  training: number;
}

/**
 * Board rows over a period, one point per day, both shifts together.
 *
 * Same counting rules as `tallyBoard`. `drawableOn` takes the date, because who the
 * board can draw changes over a period: a leaver counts up to their last day only.
 * Every day in [from, to] gets a point, so a day nobody filled in reads as zero
 * rather than being skipped and joining its neighbours into one line.
 */
export function boardTrend(
  rows: ReadonlyArray<{ on_date: string; employee_id: string; status: string }>,
  from: string,
  to: string,
  drawableOn: (employeeId: string, onDate: string) => boolean,
): BoardDay[] {
  const days = new Map<string, BoardDay>();
  for (let d = from; d <= to; d = nextIsoDay(d)) {
    days.set(d, { on_date: d, working: 0, overtime: 0, sick: 0, holiday: 0, unpaid: 0, training: 0 });
  }
  for (const r of rows) {
    const day = days.get(r.on_date);
    if (!day || !drawableOn(r.employee_id, r.on_date)) continue;
    if (r.status === "assigned") day.working += 1;
    else if (r.status === "overtime") day.overtime += 1;
    else if (r.status === "sick" || r.status === "unpaid" || r.status === "holiday" || r.status === "training") {
      day[r.status] += 1;
    }
  }
  return [...days.values()];
}

/** The ISO date after `iso`, by the calendar and not by 24 hours (clock changes). */
export function nextIsoDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}
