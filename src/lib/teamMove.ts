/**
 * Moving a whole line's team to another line, in one go.
 *
 * Asked on 30/10/2026: Line 4's five people go to Line 5 together, without dragging five
 * cards. The plan is worked out here, before anything is written, so the confirmation can
 * show exactly who goes, who stays and why — and the write is then one statement over
 * those row ids.
 *
 * Who is "the team": every row on this board (date and shift) whose `area_id` is the
 * line and who is working it — `assigned` or `overtime`, half days included, because
 * that is what the column draws. Nothing else on the row changes: status, half day,
 * late start, early finish and the attendance record all stay as they are; only the
 * line does.
 *
 * Who stays: a row whose person is no longer on the active staff list. The board does
 * not draw them (see `employeeById`), so moving them would move somebody nobody can see;
 * the row is history and is left where it is.
 *
 * Leadership: the database drops `is_leader` whenever a row changes column
 * (`leadership_follows_the_column`), and allows one leader per column. So the line's
 * leader is carried only when the destination has none; otherwise the mark stays behind
 * with the line and the destination keeps its own.
 */
export type TeamRow = {
  id: string;
  employee_id: string;
  area_id: string | null;
  status: string;
  is_leader?: boolean | null;
};

export type TeamMovePlan<R extends TeamRow = TeamRow> = {
  movers: R[];
  staying: { row: R; reason: string }[];
  /** The source line's leader, to be re-marked on the destination after the move. */
  carryLeader: R | null;
  /** Who already leads the destination, if anyone. */
  destinationLeader: R | null;
};

const working = (status: string) => status === "assigned" || status === "overtime";

export function planTeamMove<R extends TeamRow>(input: {
  allocations: ReadonlyArray<R>;
  from: string;
  to: string;
  /** Whether the board can draw this person (an active staff record). */
  drawable: (employeeId: string) => boolean;
}): TeamMovePlan<R> {
  const { allocations, from, to, drawable } = input;
  if (!from || !to) throw new Error("Pick a line to move the team to.");
  if (from === to) throw new Error("The team is already on that line.");

  const onLine = allocations.filter((a) => a.area_id === from && working(a.status));
  const movers = onLine.filter((a) => drawable(a.employee_id));
  const staying = onLine
    .filter((a) => !drawable(a.employee_id))
    .map((row) => ({
      row,
      reason: "Their staff record is no longer active, so this row stays here as history.",
    }));

  const destinationLeader =
    allocations.find((a) => a.area_id === to && working(a.status) && a.is_leader === true) ?? null;
  const sourceLeader = movers.find((a) => a.is_leader === true) ?? null;

  return {
    movers,
    staying,
    carryLeader: destinationLeader ? null : sourceLeader,
    destinationLeader,
  };
}
