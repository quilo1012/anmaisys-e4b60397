/**
 * Which lines a board draws, once some are hidden on that shift.
 *
 * A hidden line is a filter on the screen, never on the headcount. So a hidden line that
 * has somebody on it today is still drawn — flagged, so whoever hid it sees why it is
 * back — rather than taking those people off the board while they still count in the
 * totals. That is the exact failure the board has had before: a column reading zero under
 * a total saying ten.
 */
export function linesToDraw<A extends { id: string }>(
  areas: ReadonlyArray<A>,
  hidden: ReadonlySet<string>,
  peopleOn: (areaId: string) => number,
): { drawn: A[]; hiddenButStaffed: Set<string> } {
  const hiddenButStaffed = new Set<string>();
  const drawn = areas.filter((a) => {
    if (!hidden.has(a.id)) return true;
    if (peopleOn(a.id) > 0) {
      hiddenButStaffed.add(a.id);
      return true;
    }
    return false;
  });
  return { drawn, hiddenButStaffed };
}
