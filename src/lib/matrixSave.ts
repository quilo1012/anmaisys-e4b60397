/**
 * What saving a day's board does to a matrix.
 *
 * No day has everybody: Monday is Mon–Thu + Fri–Mon, Friday is Tue–Fri + Fri–Mon.
 * So a save replaces only the crews that were on the board that day, and leaves every
 * other crew's rows where they are — saving the changeover on a Monday and then on a
 * Friday builds one matrix holding all three crews, in either order.
 *
 * The crew is the `shift_group` held *on that date* (`resolveShiftOn`), not today's.
 */
import { resolveShiftOn, type ShiftPosition } from "@/hooks/useWorkforce";

export interface MatrixSavePerson {
  id: string;
  active: boolean;
  shift_group: string | null;
  shift_pattern_id: string | null;
}

/** null crew is still a crew — "nobody recorded one" — and is keyed as such. */
const crewKey = (g: string | null) => (g ?? "").trim().toLowerCase() || "__none__";

export function planMatrixDelete(input: {
  onDate: string;
  boardEmployeeIds: string[];
  existingMatrixIds: string[];
  people: MatrixSavePerson[];
  history: ShiftPosition[] | undefined;
}): string[] {
  const { onDate, history } = input;
  const byId = new Map(input.people.map((p) => [p.id, p]));
  const onBoard = new Set(input.boardEmployeeIds);
  const crewOf = (p: MatrixSavePerson) => crewKey(resolveShiftOn(history, p, onDate).shift_group);

  const savedCrews = new Set<string>();
  for (const id of onBoard) {
    const p = byId.get(id);
    if (p) savedCrews.add(crewOf(p));
  }

  return input.existingMatrixIds.filter((id) => {
    if (onBoard.has(id)) return false;
    const p = byId.get(id);
    // Not an active employee: would be copied onto the board, since an unknown rota
    // is let through. Out.
    if (!p || !p.active) return true;
    // Of a crew saved today but not on today's board: they left the pattern.
    return savedCrews.has(crewOf(p));
  });
}
