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

/** A reason that is only a bare UUID — a stop code that was never given its name. */
const BARE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // A stop stored as its raw UUID has no name for any of the rules below to match,
  // so it would quietly land in OTHER and be counted as a real stoppage — which is
  // exactly what happened to 421 minutes of No Planned Shift on Line 4. Give it its
  // own bucket so it is visible and gets mapped, rather than blended into the total.
  if (BARE_UUID_RE.test((reason ?? "").trim())) return "Unmapped stop code";

  const text = `${reason ?? ""} ${category ?? ""}`.toLowerCase().trim();
  if (!text) return "OTHER";

  if (/\bbreak(s)?\b/.test(text)) return "Break";
  if (/maintenance|maint\b|wo\s*request/.test(text)) return "MAINT";
  if (/clean(ing)?|deep\s*clean|drill\s*clean|brush/.test(text)) return "Cleaning";
  if (/changeover|change[-_\s]*over/.test(text)) return "Changeover";
  if (/quality/.test(text)) return "Quality";
  return "OTHER";
}
