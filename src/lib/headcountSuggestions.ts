import type { BoardPlacement } from "./copyBoard";

export type PreviousPlace = BoardPlacement & { on_date: string };

/** Standing places first; otherwise each person's own last working day, not the last board. */
export function suggestHeadcountPlaces(input: {
  dueIds: string[];
  savedIds: string[];
  awayIds: string[];
  areaIds: string[];
  primary: Array<{ employee_id: string; area_id: string | null }>;
  secondary: Array<{ employee_id: string; area_id: string | null }>;
  previous: PreviousPlace[];
  onDate: string;
  today: string;
}): BoardPlacement[] {
  if (input.onDate < input.today) return [];
  const valid = new Set(input.areaIds);
  const blocked = new Set([...input.savedIds, ...input.awayIds]);
  const places = new Map<string, string>();
  const remember = (row: { employee_id: string; area_id: string | null }) => {
    if (row.area_id && valid.has(row.area_id) && !places.has(row.employee_id)) {
      places.set(row.employee_id, row.area_id);
    }
  };
  input.primary.forEach(remember);
  input.secondary.forEach(remember);
  [...input.previous]
    .filter((r) => r.on_date < input.onDate && (r.status === "assigned" || r.status === "overtime"))
    .sort((a, b) => b.on_date.localeCompare(a.on_date))
    .forEach(remember);
  return [...new Set(input.dueIds)].flatMap((id) => {
    const area = places.get(id);
    return area && !blocked.has(id) ? [{ employee_id: id, area_id: area, status: "assigned" }] : [];
  });
}