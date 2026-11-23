import type { BoardPlacement } from "./copyBoard";

export type PreviousPlace = BoardPlacement & { on_date: string };

/**
 * Standing places first; otherwise each person's own last working day, not the last board.
 *
 * Somebody whose standing place on their record (`employees.headcount_area_id`) is the
 * Training area is suggested in the Training column, ahead of any line. The board reads
 * that area as the Training state (`foldTrainingArea`) and never draws it as a column,
 * and training days are not working history, so a trainee had no suggestion at all and
 * sat in "Not placed yet" every morning — Nikolas Rios, from 06/11 to 23/11/2026, with
 * Training as his place on file the whole time.
 */
export function suggestHeadcountPlaces(input: {
  dueIds: string[];
  savedIds: string[];
  awayIds: string[];
  areaIds: string[];
  primary: Array<{ employee_id: string; area_id: string | null }>;
  secondary: Array<{ employee_id: string; area_id: string | null }>;
  previous: PreviousPlace[];
  /** People whose standing place on their record is the Training area. */
  trainingIds?: string[];
  onDate: string;
  today: string;
}): BoardPlacement[] {
  if (input.onDate < input.today) return [];
  const valid = new Set(input.areaIds);
  const blocked = new Set([...input.savedIds, ...input.awayIds]);
  const training = new Set(input.trainingIds ?? []);
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
  return [...new Set(input.dueIds)].flatMap((id): BoardPlacement[] => {
    if (blocked.has(id)) return [];
    if (training.has(id)) return [{ employee_id: id, area_id: null, status: "training" }];
    const area = places.get(id);
    return area ? [{ employee_id: id, area_id: area, status: "assigned" }] : [];
  });
}
