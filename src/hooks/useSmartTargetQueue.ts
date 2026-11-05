import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/invokeFunction";
import type { ShiftType } from "@/lib/smartTargetEngine";
import { isCurrentShift, queueRowsFromSections, type QueueRow, type ScheduledJobItem } from "@/lib/smartTargetQueue";

/**
 * The iTouch queue Smart Target fills order quantities from: read once per shift, kept
 * in smart_target_queue_snapshots, then read from there by everyone (Q26b).
 *
 * The first person to open the page during a shift with no snapshot triggers the one
 * read of iTouch, through the function the Planner already uses. The database keeps the
 * first save and refuses later ones, so a second viewer at the same moment costs one
 * extra iTouch read at most and never a second snapshot. A past or future shift is never
 * read from iTouch: the queue only describes now.
 */

export type QueueState =
  | { kind: "saved"; fetchedAt: string }
  | { kind: "reading" }
  | { kind: "not_current" }
  | { kind: "not_installed" }
  | { kind: "empty"; reason: string }
  | { kind: "error"; message: string };

export function useSmartTargetQueue(date: string, shift: ShiftType) {
  const qc = useQueryClient();
  const key = ["smart_target_queue", date, shift];
  const tried = useRef<string | null>(null);
  const [reading, setReading] = useState<QueueState | null>(null);

  const snapshot = useQuery({
    queryKey: key,
    queryFn: async () => {
      // Not in the generated types until BLOCO 147 is applied and types.ts regenerated.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("smart_target_queue_snapshots")
        .select("line, seq, sku, order_qty, done_qty, status, fetched_at")
        .eq("session_date", date)
        .eq("shift", shift)
        .order("seq");
      if (error) {
        if (error.code === "PGRST205" || error.code === "42P01") return { installed: false, rows: [] as (QueueRow & { fetched_at: string })[] };
        throw error;
      }
      return { installed: true, rows: (data ?? []) as (QueueRow & { fetched_at: string })[] };
    },
  });

  const current = isCurrentShift(date, shift);
  const needsRead = !!snapshot.data?.installed && snapshot.data.rows.length === 0 && current;

  useEffect(() => {
    const id = `${date}|${shift}`;
    if (!needsRead || tried.current === id) return;
    tried.current = id;
    (async () => {
      setReading({ kind: "reading" });
      const { data, error } = await invokeFunction<{ sections?: { line: string; items: ScheduledJobItem[] }[]; skipped?: boolean; reason?: string }>(
        "intouch-list-scheduled-jobs",
        { session_date: date, shift },
      );
      if (error) {
        setReading({ kind: "error", message: error.message ?? String(error) });
        return;
      }
      if (data?.skipped) {
        setReading({ kind: "empty", reason: data.reason ?? "iTouch did not answer" });
        return;
      }
      const rows = queueRowsFromSections(data?.sections ?? []);
      if (!rows.length) {
        setReading({ kind: "empty", reason: "iTouch's queue has no jobs for the mapped lines" });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: saveError } = await (supabase as any).rpc("save_smart_target_queue", { p_date: date, p_shift: shift, p_rows: rows });
      if (saveError) {
        setReading({ kind: "error", message: saveError.message });
        return;
      }
      setReading(null);
      await qc.invalidateQueries({ queryKey: key });
    })();
    // `key` is derived from date and shift, already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRead, date, shift, qc]);

  const rows = snapshot.data?.rows ?? [];
  const state: QueueState | null = snapshot.isLoading
    ? null
    : snapshot.error
      ? { kind: "error", message: (snapshot.error as Error).message }
      : snapshot.data && !snapshot.data.installed
        ? { kind: "not_installed" }
        : rows.length
          ? { kind: "saved", fetchedAt: rows[0].fetched_at }
          : reading ?? (current ? { kind: "reading" } : { kind: "not_current" });

  return { rows, state };
}
