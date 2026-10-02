import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { ShiftKey } from "@/lib/operationalShift";
import {
  boardClockLabel, boardClockTitle, boardClockVerdict,
  type BoardClockRow, type BoardClockVerdict,
} from "@/lib/boardClockStatus";

/**
 * Whether the day on screen is a plan, a record, or a disagreement.
 *
 * The board is written in the morning and the clock is written by the door, and
 * nothing reconciles them — 594 person-days disagree across the 52 days that have
 * both. Until somebody reconciles them, the least a screen can do is say which of the
 * two it is showing.
 *
 * It is per BOARD and not per day, which is a correction to how this was first
 * specified. `attendance_days` has no shift column, so it is tempting to call the
 * status a property of the date — but the comparison is against the people allocated
 * to one board, and the two boards give different answers on the same day: on
 * 05/09/2026 the Day board had 7 disagreements and the Night board had no comparable
 * people at all. One badge for both would have to pick one and silently drop the other.
 */
const TONE: Record<BoardClockVerdict["kind"], string> = {
  no_clock: "border-border bg-muted/50 text-muted-foreground",
  // Deliberately NOT the agreement tone. It is the absence of a check, and it reads
  // closer to a warning than to a pass.
  no_basis: "border-warning/40 bg-warning/10 text-warning-strong",
  agrees: "border-success/40 bg-success/10 text-success-strong",
  differs: "border-destructive/40 bg-destructive/10 text-destructive-strong",
};

export function DayClockBadge({
  onDate,
  shift,
  boardLabel,
  className,
}: {
  onDate: string;
  shift: ShiftKey;
  /** Names the board when more than one is on screen, so the badge cannot be read as covering both. */
  boardLabel?: string;
  className?: string;
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["board_clock_status", onDate, shift],
    staleTime: 60_000,
    queryFn: async (): Promise<BoardClockRow | null> => {
      // The function is newer than the generated Postgrest types, hence the cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- function newer than the generated types
      const { data, error } = await (supabase as any).rpc("fn_board_clock_status", {
        p_date: onDate,
        p_shift: shift,
      });
      if (error) throw error;
      // Returns a table; one row, or none if the day is outside what it can answer.
      const rows = (data ?? []) as BoardClockRow[];
      return rows[0] ?? null;
    },
  });

  // Silent while loading and silent on failure. A badge is a claim about the day, and
  // the honest thing to do when it cannot be made is not to make it — unlike the
  // coverage note, which corrects a reading the screen is actively giving.
  if (isPending || isError) return null;

  const verdict = boardClockVerdict(data);
  if (!verdict) return null;

  return (
    <Badge
      variant="outline"
      className={cn("print:hidden", TONE[verdict.kind], className)}
      title={boardClockTitle(verdict)}
    >
      {boardLabel ? `${boardLabel}: ` : ""}{boardClockLabel(verdict)}
    </Badge>
  );
}
