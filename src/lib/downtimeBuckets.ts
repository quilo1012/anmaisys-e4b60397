/**
 * Shared mapping from a downtime record's free-text reason/category to a
 * canonical RAG/Downtime bucket label.
 *
 * Used by RAG Weekly and Production Downtime aggregations so classification
 * stays consistent across every view.
 *
 * Returning `null` means the record must be EXCLUDED from all downtime
 * calculations — e.g. "No Planned Shift" is a period when the line was not
 * scheduled to run, so it is not real downtime.
 */

const NO_PLANNED_SHIFT_RE = /no[\s_-]*planned[\s_-]*shift/i;

export function isNoPlannedShift(
  reason?: string | null,
  category?: string | null,
  stopCode?: string | null,
): boolean {
  const parts = [reason, category, stopCode].filter(Boolean).join(" ");
  return NO_PLANNED_SHIFT_RE.test(parts) || /^no_planned_shift$/i.test(stopCode ?? "");
}

/**
 * Map a reason (primary) or category (fallback) to a bucket label.
 * Returns `null` when the record should be excluded from downtime calcs.
 */
export function bucketFromReason(
  reason?: string | null,
  category?: string | null,
): string | null {
  if (isNoPlannedShift(reason, category)) return null;

  const text = `${reason ?? ""} ${category ?? ""}`.toLowerCase().trim();
  if (!text) return "OTHER";

  if (/\bbreak(s)?\b/.test(text)) return "Break";
  if (/maintenance|maint\b|wo\s*request/.test(text)) return "MAINT";
  if (/clean(ing)?|deep\s*clean|drill\s*clean|brush/.test(text)) return "Cleaning";
  if (/changeover|change[-_\s]*over/.test(text)) return "Changeover";
  if (/quality/.test(text)) return "Quality";
  return "OTHER";
}
