import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { useScorecardWeek } from "@/hooks/useScorecardWeek";
import { useUnledShifts } from "@/hooks/useUnledShifts";
import { boardCounts, weekEndingFor, type ScorecardBoardRow } from "@/lib/scorecardWeek";
import { ScorecardWeekBoard } from "@/components/scorecard/ScorecardWeekBoard";
import { ScorecardEntryDrawer } from "@/components/scorecard/ScorecardEntryDrawer";

/**
 * The week's leader scorecard board: one row per leader assigned to a line,
 * their RAGs and their score for the week ending on the chosen Sunday.
 *
 * Nothing here computes a RAG, a score or a ceiling — the database already did,
 * and `scoreCell`/`RagChip`/`stateLabel` only format what it returned. An error
 * from the query is shown as an error, never folded into the "no leader
 * assigned" empty state that `ScorecardWeekBoard` renders for a genuinely empty
 * board — a person reading this screen must be able to tell "nothing to show"
 * apart from "the query failed". A third state sits above the board: shifts that
 * ran with no leader recorded, which `scorecard_week_board` cannot return at all.
 * A week can be 20% invisible and still look complete without it.
 */
export default function LeaderScorecardWeekPage() {
  const [weekEnding, setWeekEnding] = useState(() => weekEndingFor(new Date()));
  const { data: rows, isLoading, isError, error } = useScorecardWeek(weekEnding);
  const counts = useMemo(() => boardCounts(rows ?? []), [rows]);
  const { data: unled } = useUnledShifts(weekEnding);
  const [open, setOpen] = useState<ScorecardBoardRow | null>(null);

  const shiftWeek = (days: number) => {
    const d = new Date(`${weekEnding}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    setWeekEnding(weekEndingFor(d));
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        <PageHeader
          module="Production"
          title="Leader scorecard"
          description={`Week ending ${weekEnding}`}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => shiftWeek(-7)}>
                Previous week
              </Button>
              <Button variant="outline" onClick={() => shiftWeek(7)}>
                Next week
              </Button>
            </div>
          }
        />

        {isError ? (
          <div role="alert" className="flex items-start gap-3 rounded border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive-strong">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Could not load the week.</p>
              <p className="text-destructive-strong/80">
                {error instanceof Error ? error.message : "The board query failed."}
              </p>
            </div>
          </div>
        ) : (
          <>
            {/*
              How much of the week is not on the board. These shifts have no leader
              recorded at all, so `scorecard_week_board` never returns them — they are
              absent rows, not blank ones, and without this the screen reports on 80% of
              a week while looking complete.

              Warning, not error: the destructive block above is reserved for "the query
              failed", and this page's whole job is keeping "nothing to show" apart from
              "something broke". A gap in the data is a third thing, and reads as neither.
            */}
            {unled && unled.total > 0 && (
              <div className="flex items-start gap-3 rounded border border-warning/30 bg-warning/10 p-4 text-sm text-warning-strong">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium">
                    {unled.total === 1
                      ? "1 shift this week has no leader recorded."
                      : `${unled.total} shifts this week have no leader recorded.`}
                  </p>
                  <p className="text-warning-strong/80">
                    {unled.lines.length > 0
                      ? `Not counted in the board below — ${unled.lines.join(", ")}.`
                      : "Not counted in the board below."}
                  </p>
                </div>
              </div>
            )}
            <ScorecardWeekBoard rows={rows ?? []} isLoading={isLoading} onOpen={setOpen} />
          </>
        )}

        {!isError && (
          <footer className="text-sm text-muted-foreground">
            {counts.toFill} to fill · {counts.toApprove} to approve · {counts.capasOpen} CAPA open
          </footer>
        )}
      </div>

      <ScorecardEntryDrawer row={open} weekEnding={weekEnding} onClose={() => setOpen(null)} />
    </DashboardLayout>
  );
}
