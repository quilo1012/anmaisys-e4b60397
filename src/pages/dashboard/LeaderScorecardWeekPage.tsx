import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { useScorecardWeek } from "@/hooks/useScorecardWeek";
import { boardCounts, weekEndingFor } from "@/lib/scorecardWeek";
import { ScorecardWeekBoard } from "@/components/scorecard/ScorecardWeekBoard";

/**
 * The week's leader scorecard board: one row per leader assigned to a line,
 * their RAGs and their score for the week ending on the chosen Sunday.
 *
 * Nothing here computes a RAG, a score or a ceiling — the database already did,
 * and `scoreCell`/`RagChip`/`stateLabel` only format what it returned. An error
 * from the query is shown as an error, never folded into the "no leader
 * assigned" empty state that `ScorecardWeekBoard` renders for a genuinely empty
 * board — a person reading this screen must be able to tell "nothing to show"
 * apart from "the query failed".
 */
export default function LeaderScorecardWeekPage() {
  const [weekEnding, setWeekEnding] = useState(() => weekEndingFor(new Date()));
  const { data: rows, isLoading, isError, error } = useScorecardWeek(weekEnding);
  const counts = useMemo(() => boardCounts(rows ?? []), [rows]);

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
          <div className="flex items-start gap-3 rounded border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive-strong">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Could not load the week.</p>
              <p className="text-destructive-strong/80">
                {error instanceof Error ? error.message : "The board query failed."}
              </p>
            </div>
          </div>
        ) : (
          <ScorecardWeekBoard rows={rows ?? []} isLoading={isLoading} />
        )}

        {!isError && (
          <footer className="text-sm text-muted-foreground">
            {counts.toFill} to fill · {counts.toApprove} to approve · {counts.capasOpen} CAPA open
          </footer>
        )}
      </div>
    </DashboardLayout>
  );
}
