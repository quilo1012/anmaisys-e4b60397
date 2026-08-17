import { AlertTriangle } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useScorecardEntry } from "@/hooks/useScorecardEntry";
import type { ScorecardBoardRow } from "@/lib/scorecardWeek";
import { ScorecardVerdict } from "./ScorecardVerdict";
import { VolumePillar } from "./pillars/VolumePillar";
import { QualityPillar } from "./pillars/QualityPillar";
import { HealthSafetyPillar } from "./pillars/HealthSafetyPillar";
import { MonitoredPillar } from "./pillars/MonitoredPillar";

type Props = {
  /** The board row that was clicked. Null closes the drawer. */
  row: ScorecardBoardRow | null;
  weekEnding: string;
  onClose: () => void;
};

/**
 * The single leader-week the board's click opens.
 *
 * `v_leader_weekly_scorecard` does not exist in the database yet, so today every
 * open of this drawer fails to load — that is shown as an explicit error, never
 * folded into a blank week: a person must be able to tell "nothing recorded yet"
 * (verdict null, query succeeded) apart from "the query failed" (verdict null,
 * error set). Rendering `ScorecardVerdict` for both would blur exactly that line.
 *
 * Tasks 8–11 add `VolumePillar`, `QualityPillar`, `HealthSafetyPillar` and
 * `MonitoredPillar` above the verdict — done below. Task 12 adds `CapaBlock`
 * below it.
 */
export function ScorecardEntryDrawer({ row, weekEnding, onClose }: Props) {
  return (
    <Sheet open={row !== null} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {row && <ScorecardEntryDrawerBody row={row} weekEnding={weekEnding} />}
      </SheetContent>
    </Sheet>
  );
}

function ScorecardEntryDrawerBody({ row, weekEnding }: { row: ScorecardBoardRow; weekEnding: string }) {
  const { draft, setField, verdict, isLoading, isError, error } = useScorecardEntry(row.leader_id, row.line_id, weekEnding);

  return (
    <div className="flex flex-col gap-4">
      <SheetHeader>
        <SheetTitle>{row.leader_name}</SheetTitle>
        <SheetDescription>{row.line_name} · Week ending {weekEnding}</SheetDescription>
      </SheetHeader>

      {isError ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive-strong"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Could not load this week.</p>
            <p className="text-destructive-strong/80">
              {error instanceof Error ? error.message : "The scorecard query failed."}
            </p>
          </div>
        </div>
      ) : isLoading ? (
        <p aria-live="polite" aria-busy="true" className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <VolumePillar lineId={row.line_id} weekEnding={weekEnding} draft={draft} setField={setField} />
          <QualityPillar draft={draft} setField={setField} verdict={verdict} />
          <HealthSafetyPillar draft={draft} setField={setField} verdict={verdict} />
          <MonitoredPillar draft={draft} setField={setField} />
          <ScorecardVerdict verdict={verdict} />
        </>
      )}
    </div>
  );
}
