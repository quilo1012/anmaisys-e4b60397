/**
 * The arithmetic behind correcting a recorded stoppage.
 *
 * Pure on purpose: the dialog uses it to show the resulting duration while the user
 * types and to keep the save button disabled until the numbers make sense, and the
 * RPC `correct_downtime_event` repeats every rule server-side, because the database
 * is what actually decides.
 *
 * The one rule worth spelling out: minutes move the END time. The same stoppage is
 * read two ways in this app — the order screen prefers the stamps, the boards prefer
 * `duration_minutes` — so writing only the minutes would give one stoppage two
 * different numbers on two different screens. Writing minutes therefore rewrites
 * `resumed_at = stopped_at + minutes`, and the two readings stay equal.
 */

export interface CorrectionInput {
  /** ISO string or Date for the corrected start of the stoppage. */
  stoppedAt: string | Date | null | undefined;
  /** ISO string or Date for the corrected end. Ignored when `minutes` is given. */
  resumedAt?: string | Date | null;
  /** Corrected duration in minutes. Wins over `resumedAt` when both are present. */
  minutes?: number | null;
  /** Mandatory free text explaining the correction. */
  reason: string;
  /** True when the stoppage on record has no `resumed_at` yet. */
  isOpen?: boolean;
  /** Clock injection for tests. */
  now?: Date;
}

export interface CorrectionResult {
  stoppedAt: Date;
  resumedAt: Date | null;
  durationMinutes: number | null;
}

export type ResolveCorrection = CorrectionResult | { error: string };

export function isCorrectionError(r: ResolveCorrection): r is { error: string } {
  return (r as { error?: string }).error !== undefined;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveCorrection(input: CorrectionInput): ResolveCorrection {
  const now = input.now ?? new Date();

  if (!input.reason || input.reason.trim() === "") {
    return { error: "A reason is required" };
  }

  const stoppedAt = toDate(input.stoppedAt);
  if (!stoppedAt) return { error: "Start time is required" };
  if (stoppedAt.getTime() > now.getTime()) {
    return { error: "Start time cannot be in the future" };
  }

  const hasMinutes = input.minutes !== null && input.minutes !== undefined && !Number.isNaN(input.minutes);

  if (hasMinutes) {
    const minutes = Number(input.minutes);
    if (input.isOpen) {
      return { error: "This stoppage is still open — resume the line before setting a duration" };
    }
    if (minutes < 0) return { error: "Duration cannot be negative" };
    return {
      stoppedAt,
      resumedAt: new Date(stoppedAt.getTime() + minutes * 60_000),
      durationMinutes: minutes,
    };
  }

  const resumedAt = toDate(input.resumedAt ?? null);
  if (!resumedAt) {
    return { stoppedAt, resumedAt: null, durationMinutes: null };
  }
  if (resumedAt.getTime() < stoppedAt.getTime()) {
    return { error: "End time cannot be before the start time" };
  }
  return {
    stoppedAt,
    resumedAt,
    durationMinutes: Math.round((resumedAt.getTime() - stoppedAt.getTime()) / 60_000),
  };
}
