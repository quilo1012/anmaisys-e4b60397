/**
 * The matrix read the way a crossover is read: by rota first, column second.
 *
 * A board is drawn by column because that is how a day is worked. The matrix is not a
 * day — it is everybody the board has, and no day has everybody. Every weekday here is
 * two rotas overlapping: Monday is Mon–Thu and Fri–Mon, Friday is Tue–Fri and Fri–Mon,
 * and Mon–Thu nights is forty-eight people who are never in on a Friday. Grouped by
 * column, the matrix answers "who is on Line 1" with eleven names of whom four are in
 * on any given day. Grouped by rota it answers the question actually being asked:
 * which crews make up this day, and who each one puts where.
 *
 * The rota is never stored with the matrix — it is read from the person each time, so
 * somebody moved between crews moves group here without anybody re-saving anything.
 */

/** One person in the matrix, with everything already resolved for the day being read. */
export interface MatrixEntry {
  employee_id: string;
  name: string;
  area_id: string | null;
  /** The rota's name, or null when nobody has recorded one. */
  rota: string | null;
  /** Whether that rota puts them on this board on the day being looked at. */
  due: boolean;
}

export interface MatrixGroup {
  /** The rota's name, or the sentence used where there is none. */
  rota: string;
  people: number;
  due: number;
  areas: Array<{ area_id: string | null; names: string[] }>;
}

/** What an unrecorded rota is called. Unknown is not off, and it is not a blank. */
export const NO_ROTA = "No rota recorded";

/**
 * Group the matrix by rota, then by column.
 *
 * Crews with somebody in today come first, because the day being planned is the reason
 * the screen is open. Inside a crew the columns follow the board's own order — the
 * matrix is meant to be read against the board beside it — with people who have no
 * column yet at the end, where they can be seen rather than lost.
 */
export function groupMatrix(entries: MatrixEntry[], areaOrder: string[]): MatrixGroup[] {
  const rank = new Map(areaOrder.map((id, i) => [id, i]));
  const byRota = new Map<string, MatrixEntry[]>();
  for (const e of entries) {
    const key = e.rota ?? NO_ROTA;
    byRota.set(key, [...(byRota.get(key) ?? []), e]);
  }

  const groups = [...byRota.entries()].map(([rota, people]) => {
    const byArea = new Map<string | null, string[]>();
    for (const p of people) {
      byArea.set(p.area_id, [...(byArea.get(p.area_id) ?? []), p.name]);
    }
    const areas = [...byArea.entries()]
      .map(([area_id, names]) => ({ area_id, names: [...names].sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => {
        // No column yet goes last: it is a gap in the matrix, not a place.
        if (a.area_id === null) return 1;
        if (b.area_id === null) return -1;
        return (rank.get(a.area_id) ?? 999) - (rank.get(b.area_id) ?? 999);
      });
    return { rota, people: people.length, due: people.filter((p) => p.due).length, areas };
  });

  return groups.sort((a, b) => {
    // In today first; then the biggest crew; then by name, so the order never wobbles
    // between two renders of the same matrix.
    if ((a.due > 0) !== (b.due > 0)) return a.due > 0 ? -1 : 1;
    return b.people - a.people || a.rota.localeCompare(b.rota);
  });
}
