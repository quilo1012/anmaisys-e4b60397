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

/**
 * Where the hidden lines sit between the ones drawn, the way Excel marks a hidden column:
 * a double rule on the edge of the next visible column. `before` holds, for each drawn
 * line, the hidden lines just to its left; `after` holds those past the last drawn line.
 * Order is the band's own (`areas` as given).
 */
export function hiddenGaps<A extends { id: string }>(
  areas: ReadonlyArray<A>,
  drawnIds: ReadonlySet<string>,
): { before: Map<string, A[]>; after: A[] } {
  const before = new Map<string, A[]>();
  let pending: A[] = [];
  for (const a of areas) {
    if (drawnIds.has(a.id)) {
      if (pending.length) before.set(a.id, pending);
      pending = [];
    } else {
      pending.push(a);
    }
  }
  return { before, after: pending };
}
