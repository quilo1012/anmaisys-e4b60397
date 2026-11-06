import { useLoggingShift } from "@/contexts/LoggingShiftContext";
import { productsOffPlan, useSmartLineTarget, type SmartLineTargetState } from "@/hooks/useSmartLineTarget";
import { londonHM } from "@/lib/shifts";
import { WIDE_MARGIN_LINES } from "@/lib/smartTargetHistory";
import type { LineNo } from "@/lib/smartTargetEngine";

/**
 * Smart Target's number for the shift, at the top of the operator's screen with no PIN
 * (Q51a). It is frozen once made; the leader-PIN target beside it is the RAG plan.
 */
export function SmartTargetBlock({ line, loggedCodes }: { line: string; loggedCodes: string[] }) {
  const { sessionDate, shift } = useLoggingShift();
  const q = useSmartLineTarget(line, sessionDate, shift);
  return <SmartTargetView state={q.data} loggedCodes={loggedCodes} />;
}

/** What the block shows for one answer from smart_target_line_targets(). */
export function SmartTargetView({ state, loggedCodes }: { state: SmartLineTargetState | undefined; loggedCodes: string[] }) {
  if (!state || state.kind === "not_installed") return null;
  const t = state.kind === "target" ? state.target : null;
  const setAt = t ? londonHM(new Date(t.frozen_at)) : null;
  const offPlan = t && t.jobs.length ? productsOffPlan(t, loggedCodes) : [];
  return (
    <div className="rounded-lg border bg-card px-4 py-3" data-testid="smart-line-target">
      <div className="text-xs text-muted-foreground">
        Smart Target{setAt ? ` · set ${setAt}` : ""}{t?.source === "page" ? " (during the shift)" : ""}
      </div>
      {!t ? (
        <div className="mt-1 text-sm text-muted-foreground">Not made for this shift.</div>
      ) : t.held_back ? (
        <div className="mt-1 text-sm text-muted-foreground">No target yet: this line is still being measured.</div>
      ) : t.status === "no_itouch_jobs" ? (
        <div className="mt-1 text-sm text-muted-foreground">No jobs were in iTouch before the shift, so there is no target.</div>
      ) : t.expected_total === null ? (
        <div className="mt-1 text-sm text-muted-foreground">— Not enough data to give a number.</div>
      ) : (
        <>
          <div className="mt-1 text-2xl font-bold tabular-nums">{t.expected_total.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">
            containers{t.expected_per_hour !== null ? ` · ${Math.round(t.expected_per_hour).toLocaleString()} per hour` : ""} · provisional
          </div>
          {WIDE_MARGIN_LINES[t.line as LineNo] !== undefined && (
            <div className="text-xs text-muted-foreground">A guide: this line usually misses by about {WIDE_MARGIN_LINES[t.line as LineNo]}%.</div>
          )}
        </>
      )}
      {offPlan.length > 0 && (
        <div className="mt-2 text-xs font-medium text-warning-strong">
          Plan changed since {setAt}: {offPlan.join(", ")} {offPlan.length === 1 ? "was" : "were"} not in it. The target stays as set.
        </div>
      )}
    </div>
  );
}
