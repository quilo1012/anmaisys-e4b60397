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
 * It is per BOARD and not per day. `attendance_days` has no shift column, which makes
 * it tempting to call the status a property of the date — but the comparison is
 * against the people allocated to ONE board, and the two boards answer differently on
 * the same day: on 05/09/2026 the Day board had 7 disagreements and the Night board
 * had nobody comparable at all. One badge for both would have to pick one and drop the
 * other in silence.
 *
 * Reads `v_board_clock_status`, not the `fn_board_clock_status` function behind it:
 * one row through `.from().eq()`, which is how the rest of the app asks. The two were
 * checked against each other across all 123 (date, shift) pairs and agree on every
 * column.
 *
 * It PRINTS, and that is not styling. A printed board carrying no word about the clock
 * is exactly the sheet that gets filed as evidence somebody was at work; the printed
 * copy has to say "Planned only" where that is what it is.
 */
const TONE: Record<BoardClockVerdict["kind"], string> = {
  // On the navy band, so the colour is carried by a tint behind white text rather than
  // by coloured ink, which is unreadable there. Print strips the band and the tint.
  no_clock: "border-white/40 bg-transparent text-white",
  // Deliberately NOT the agreement tone. It is the ABSENCE of a check, and it reads
  // closer to a warning than to a pass — five night boards are in exactly this state.
  no_basis: "border-warning/60 bg-warning/30 text-white",
  agrees: "border-success/60 bg-success/30 text-white",
  differs: "border-destructive/60 bg-destructive/40 text-white",
};

export function DayClockBadge({
  onDate,
  shift,
  boardLabel,
  className,
}: {
  onDate: string;
  shift: ShiftKey;
  /** Names the board when both are on screen, so neither can be read as covering the other. */
  boardLabel?: string;
  className?: string;
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["board_clock_status", onDate, shift],
    staleTime: 60_000,
    queryFn: async (): Promise<BoardClockRow | null> => {
      // The view is newer than the generated Postgrest types, hence the cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view newer than the generated types
      const { data, error } = await (supabase as any)
        .from("v_board_clock_status")
        .select("status, clock_rows, covered_people, differs")
        .eq("on_date", onDate)
        .eq("shift", shift)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as BoardClockRow | null;
    },
  });

  // Silent while loading, and silent when the read failed. A badge is a claim about
  // the day; the honest thing when it cannot be made is not to make it.
  if (isPending || isError) return null;

  // A day with nobody allocated has no row in the view — and no board to describe
  // either. "Planned only" is the true thing to say about it.
  const verdict = boardClockVerdict(
    data ?? { status: "planned", clock_rows: 0, covered_people: 0, differs: 0 },
  );
  if (!verdict) return null;

  return (
    <Badge
      variant="outline"
      className={cn("print:border-black print:bg-transparent print:text-black", TONE[verdict.kind], className)}
      title={boardClockTitle(verdict)}
    >
      {boardLabel ? `${boardLabel}: ` : ""}{boardClockLabel(verdict)}
    </Badge>
  );
}
