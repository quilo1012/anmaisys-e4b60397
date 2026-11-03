import { shiftSessionDate } from "@/lib/shifts";

/**
 * Which date a quality action's form shows, and which `recorded_at` a save writes.
 *
 * The list files an action under its shift's date (`shiftSessionDate`): a NIGHT action
 * logged at 02:30 belongs to the night that began the evening before. The edit form used
 * the UTC calendar date of the timestamp instead, and every save rewrote `recorded_at` to
 * 12:00 of whatever the form said — so correcting a description moved a night action into
 * the next day's shift, and onto whoever led it. Audit 2026-11-02, BIZ-001.
 */
export function qualityActionFormDate(recordedAt: string, shift: string | null): string {
  return shiftSessionDate(recordedAt, shift);
}

/**
 * The stored time stands unless the person changed the date or the shift. Then — and for
 * a new action — it is midday of the chosen date, which every shift files under that date.
 */
export function recordedAtOnSave(
  form: { date: string; shift: string },
  original: { recorded_at: string; shift: string | null } | null,
): string {
  if (original
    && form.shift === (original.shift ?? "DAY")
    && form.date === qualityActionFormDate(original.recorded_at, original.shift)) {
    return original.recorded_at;
  }
  return new Date(`${form.date}T12:00:00`).toISOString();
}
