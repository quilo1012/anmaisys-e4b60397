import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRole } from "@/hooks/useRole";
import { useScorecardEntry } from "@/hooks/useScorecardEntry";
import { approvalBlockers } from "@/lib/capaGate";
import type { ScorecardBoardRow } from "@/lib/scorecardWeek";
import { supabase } from "@/integrations/supabase/client";
import { CapaBlock } from "./CapaBlock";
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
  const { draft, setField, saveNow, verdict, isSaving, isLoading, isError, error } = useScorecardEntry(row.leader_id, row.line_id, weekEnding);
  const { can } = useRole();
  // Guards the click-to-getUser gap: `isSaving` only turns true once the write
  // itself has started, so without this a second click during the (brief)
  // `getUser()` await could fire a second submit/approve before the first has
  // reached `saveNow` at all.
  const [pendingAction, setPendingAction] = useState<"submit" | "approve" | null>(null);

  const blockers = approvalBlockers(draft, verdict);
  // Read off `verdict` — the query's CONFIRMED data — never off `draft`.
  // `saveNow` writes `submitted_at`/`approved_at` into `draft` optimistically,
  // before the network call resolves, and a previous version of this file left
  // them there even when the write was then rejected: the button flipped to
  // "Submitted"/disabled while nothing had actually been recorded. `verdict`
  // only changes when a write SUCCEEDS (the mutation's `onSuccess` invalidates
  // and refetches it); a rejected write never touches it, so it cannot lie.
  const alreadySubmitted = Boolean(verdict?.submitted_at);
  const alreadyApproved = Boolean(verdict?.approved_at);

  /**
   * The database, not `getUser()` alone, decides whether this write is
   * accepted — the trigger's rejection reaches the person through the same
   * `save.onError` toast every other write in this drawer uses (see
   * `useScorecardEntry.ts`). Here we only add the one check the trigger
   * cannot make for us: that somebody IS signed in, so an approval is never
   * attempted with a null `approved_by`.
   */
  const submit = async () => {
    setPendingAction("submit");
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser?.id) {
        toast.error("You must be signed in to submit this week.");
        return;
      }
      await saveNow({ submitted_by: authUser.id, submitted_at: new Date().toISOString() }).catch(() => {});
    } finally {
      setPendingAction(null);
    }
  };

  const approve = async () => {
    setPendingAction("approve");
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser?.id) {
        toast.error("You must be signed in to approve this week.");
        return;
      }
      await saveNow({ approved_by: authUser.id, approved_at: new Date().toISOString() }).catch(() => {});
    } finally {
      setPendingAction(null);
    }
  };

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
          <CapaBlock draft={draft} setField={setField} verdict={verdict} />

          <section className="flex flex-col gap-2 border-t pt-4">
            <div className="flex flex-wrap gap-2">
              {can("scorecard.fill") && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSaving || pendingAction !== null || alreadySubmitted}
                  onClick={() => { void submit(); }}
                >
                  {alreadySubmitted ? "Submitted" : "Submit"}
                </Button>
              )}

              {can("scorecard.approve") && (
                <Button
                  type="button"
                  disabled={isSaving || pendingAction !== null || alreadyApproved || blockers.length > 0}
                  aria-describedby="capa-approve-blockers"
                  onClick={() => { void approve(); }}
                >
                  {alreadyApproved ? "Approved" : "Approve"}
                </Button>
              )}
            </div>

            {/*
              This list is what the trigger `scorecard_require_capa_before_approval`
              will demand, computed client-side ONLY to warn before the attempt —
              `approvalBlockers` mirrors the trigger, it does not replace it. If the
              database ever disagrees, the toast from `save.onError` (the trigger's own
              message) is what a person should believe.

              The wrapper stays mounted (never unmounts on its own) so `aria-live`
              announces both the list's arrival and every change to it as fields
              are filled in — an aria-live region only fires on a mutation of an
              already-present node, not on first mount of a new one.
            */}
            <div aria-live="polite">
              {can("scorecard.approve") && !alreadyApproved && blockers.length > 0 && (
                <p id="capa-approve-blockers" className="text-xs text-destructive-strong">
                  Cannot approve yet — missing: {blockers.join(", ")}.
                </p>
              )}
            </div>

            {alreadySubmitted && <p className="text-xs text-muted-foreground">Submitted{alreadyApproved ? " and approved" : ""}.</p>}
          </section>
        </>
      )}
    </div>
  );
}
