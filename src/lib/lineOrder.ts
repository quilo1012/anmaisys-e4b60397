/**
 * Moving a column of the Headcount board to another place in its band.
 *
 * Only `headcount_areas.sort_order` changes. The people on a line are allocations that
 * point at the line's id, never at its position, so a line carries its whole team with
 * it by construction: nobody is copied, dropped or re-pointed, and no shift, time or
 * history is touched. That is the whole of "the team follows the column".
 *
 * Any line to any position, in either direction: there is no rule about particular
 * lines here, and a line added next month is just one more id in the list.
 */
export type LineOrder = { id: string; sort_order: number };

/**
 * The band's ids with `from` taken out and put down where `to` is.
 *
 * Over every line of the band, hidden ones included, so renumbering the ones on screen
 * never lands a hidden line on the same sort order as a shown one. Null when there is
 * nothing to do: dropped on itself, or an id that is not in the band.
 */
export function moveLine(ids: readonly string[], from: string, to: string): string[] | null {
  const a = ids.indexOf(from);
  const b = ids.indexOf(to);
  if (a < 0 || b < 0 || a === b) return null;
  const next = ids.slice();
  next.splice(a, 1);
  next.splice(b, 0, from);
  return next;
}

/**
 * What to write for a new order, and what to write to take it back.
 *
 * Renumbered in tens, leaving room to slide something in later without rewriting the
 * whole band. Only the lines whose number actually changes are written, so moving Line
 * 2 past Line 3 is two updates rather than thirteen. `undo` puts back exactly the
 * numbers they had, ties and gaps included, which is what makes it an undo and not a
 * second, slightly different reorder.
 */
export function renumber(
  ordered: readonly string[],
  current: ReadonlyMap<string, number>,
): { save: LineOrder[]; undo: LineOrder[] } {
  const save: LineOrder[] = [];
  const undo: LineOrder[] = [];
  ordered.forEach((id, i) => {
    const sort_order = (i + 1) * 10;
    const was = current.get(id);
    if (was === sort_order) return;
    save.push({ id, sort_order });
    if (was !== undefined) undo.push({ id, sort_order: was });
  });
  return { save, undo };
}

/** Lay new sort orders over a list of areas and put it back in board order. */
export function applyLineOrder<T extends { id: string; name: string; sort_order: number }>(
  areas: readonly T[],
  changes: readonly LineOrder[],
): T[] {
  const by = new Map(changes.map((c) => [c.id, c.sort_order]));
  return areas
    .map((a) => (by.has(a.id) ? { ...a, sort_order: by.get(a.id)! } : a))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}
