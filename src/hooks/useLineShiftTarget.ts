import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type LineShiftTargetShift = "DAY" | "NIGHT" | string;

export interface UseLineShiftTargetParams {
  line: string | null | undefined;
  date: string | null | undefined; // YYYY-MM-DD
  shift: LineShiftTargetShift | null | undefined;
  /**
   * Optional predicate to match rows returned for (date, shift) against the
   * caller's line. Defaults to case-insensitive, whitespace-collapsed equality.
   * Provide a custom matcher (e.g. lineNamesMatch) to preserve caller-specific
   * behavior without changing the shared query.
   */
  matchLine?: (rowLine: string | null | undefined) => boolean;
  refetchIntervalMs?: number;
  enabled?: boolean;
}

export interface UseLineShiftTargetResult {
  target: number;
  actual: number;
  gap: number;
  rowId: string | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  /** Alias for `target` — kept so callers that previously read `ragPlanQ.data` (a number) still work. */
  data: number;
  queryKey: readonly unknown[];
  refetch: () => void;
}

function defaultNormalize(s: string | null | undefined) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Unified query for RAG Weekly target/actual for a given (line, date, shift).
 * Encapsulates the shared read done today in DailyTargetCard,
 * MyProductionPage (ragQ) and LineProductionScreen (ragPlanQ) — same source,
 * same fields, so all three stay behaviorally identical.
 */
export function useLineShiftTarget(params: UseLineShiftTargetParams): UseLineShiftTargetResult {
  const { line, date, shift, matchLine, refetchIntervalMs = 30_000, enabled = true } = params;

  const normalizedLine = defaultNormalize(line);
  const matcher =
    matchLine ??
    ((rowLine: string | null | undefined) => defaultNormalize(rowLine) === normalizedLine);

  const queryKey = ["use-line-shift-target", line ?? null, date ?? null, shift ?? null] as const;

  const q = useQuery({
    enabled: enabled && !!line && !!date && !!shift,
    queryKey,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rag_weekly_entries")
        .select("id, line, plan_qty, actual_qty")
        .eq("entry_date", date)
        .eq("shift", shift);
      if (error) throw error;
      const rows = (data || []).filter((r: any) => matcher(r.line));
      const target = rows.reduce((s: number, r: any) => s + Number(r.plan_qty || 0), 0);
      const actual = rows.reduce((s: number, r: any) => s + Number(r.actual_qty || 0), 0);
      const rowId = rows.length === 1 ? (rows[0].id as string) : null;
      return { target, actual, rowId };
    },
    refetchInterval: refetchIntervalMs,
  });

  // Consistent error surfacing across all consumers — one toast per error transition.
  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (q.isError) {
      const msg = (q.error as any)?.message || "Failed to load target";
      if (lastErrorRef.current !== msg) {
        lastErrorRef.current = msg;
        toast.error(`Target sync error: ${msg}`, { id: 'line-shift-target' });
      }
    } else if (!q.isFetching) {
      lastErrorRef.current = null;
    }
  }, [q.isError, q.error, q.isFetching]);

  const target = Number(q.data?.target ?? 0);
  const actual = Number(q.data?.actual ?? 0);
  const gap = Math.max(0, target - actual);

  return {
    target,
    actual,
    gap,
    rowId: q.data?.rowId ?? null,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    data: target,
    queryKey,
    refetch: () => q.refetch(),
  };
}
