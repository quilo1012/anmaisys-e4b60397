/**
 * Pure gating helper used by `useWOAlerts` to decide whether a Work Order
 * realtime event should trigger the critical siren for the current engineer.
 *
 * Extracted so the rules are unit-testable independently of Supabase + React.
 * The single-fire-per-WO guarantee is enforced by `isAcknowledged` (backed by
 * localStorage in production) plus the server-side
 * `engineer_notified_acknowledged_at` column.
 */
export interface WORealtimeRow {
  id: string;
  status: string;
  engineer_id: string | null;
  locked_engineer_id: string | null;
  engineer_notified_acknowledged_at: string | null;
  line_id: string | null;
}

export interface WOAlertGateOptions {
  userId: string;
  /** Engineer's per-line preference. `null` line_id (unassigned) always alerts. */
  shouldAlertForLine: (lineId: string | null) => boolean;
  /** Acknowledgment gate (typically wraps `isWOAcknowledged` from woAck). */
  isAcknowledged: (woId: string) => boolean;
}

/**
 * Returns true when the WO should fire a siren for this engineer.
 *
 * Rules (all must pass):
 *  - WO is in `open` status
 *  - Not already acknowledged client-side
 *  - Not already acknowledged server-side
 *  - Not assigned/locked to a different engineer
 *  - Line filter allows it
 */
export function shouldFireWOAlert(
  wo: WORealtimeRow,
  opts: WOAlertGateOptions,
): boolean {
  if (wo.status !== "open") return false;
  if (opts.isAcknowledged(wo.id)) return false;
  if (wo.engineer_notified_acknowledged_at) return false;
  if (wo.engineer_id && wo.engineer_id !== opts.userId) return false;
  if (wo.locked_engineer_id && wo.locked_engineer_id !== opts.userId) return false;
  if (!opts.shouldAlertForLine(wo.line_id)) return false;
  return true;
}
