import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ChevronDown } from "lucide-react";
import { leaderTracking, type LeaderTrackingRow, type TrackedAction } from "@/lib/leaderTracking";
import { useLeaderAttribution } from "@/hooks/useLabelAttribution";
import { PointsPending } from "@/components/quality/PointsPending";
import { cn } from "@/lib/utils";

export interface QualityTrackingByLeaderProps {
  actions: TrackedAction[];
  /** The period the numbers cover, printed beside the title. */
  periodLabel: string;
  /** Optional click-through, e.g. to open that leader's scorecard. */
  onSelectLeader?: (leader: string) => void;
}

/** Below this many leaders the table shows everyone — a fold costs more than it saves. */
const FOLD_ABOVE = 8;
/** And a fold that hides one or two rows costs a row to say so. */
const FOLD_MIN_HIDDEN = 3;

/**
 * A leader's weight in the period, as a bar.
 *
 * The table used to print "7 pts (7 open)" in one cell and leave the reader to rank
 * sixteen of those strings by eye. The bar is the same two numbers: its length is the
 * points picked up, measured against the heaviest leader on screen, and the solid head
 * of it is the share still standing. Where the solid part runs the whole length,
 * nothing has been filed.
 */
function WeightBar({ points, openPoints, max }: { points: number; openPoints: number; max: number }) {
  if (!points) return null;
  const width = max > 0 ? Math.max(4, (points / max) * 100) : 0;
  const openShare = points > 0 ? (openPoints / points) * 100 : 0;
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="h-full rounded-full bg-warning/25" style={{ width: `${width}%` }}>
        <div className="h-full rounded-full bg-warning-strong/70" style={{ width: `${openShare}%` }} />
      </div>
    </div>
  );
}

function LeaderRow({
  r,
  max,
  onSelectLeader,
}: {
  r: LeaderTrackingRow;
  max: number;
  onSelectLeader?: (leader: string) => void;
}) {
  const clickable = !!onSelectLeader;
  return (
    <tr
      className={cn(
        "border-b border-border/60 transition-colors last:border-0",
        clickable && "cursor-pointer hover:bg-muted/50",
      )}
      onClick={clickable ? () => onSelectLeader!(r.leader) : undefined}
    >
      {/* Name and shift on one line: the shift is how you tell two Marcios apart,
          not a figure to compare down a column, and stacked it made every row two
          lines tall — sixteen leaders then ran past the bottom of the screen. */}
      <td className="py-2 pr-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-semibold text-foreground">{r.leader}</span>
          <span className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground/80">{r.shifts}</span>
        </div>
      </td>

      <td className="whitespace-nowrap px-2 py-2 text-right font-figure tabular-nums text-foreground">
        {r.total}
      </td>

      <td
        className={cn(
          "whitespace-nowrap px-2 py-2 text-right font-figure tabular-nums",
          r.open ? "font-bold text-warning-strong" : "text-muted-foreground/60",
        )}
      >
        {r.open || "—"}
      </td>

      {/* Validated paperwork is a penalty; pending is not one yet, so it stays a
          quiet aside rather than a second figure of equal weight. With nothing
          validated the dash is dropped entirely — "— +2" is not a reading. */}
      <td className="whitespace-nowrap px-2 py-2 text-right">
        {r.paperwork > 0 && (
          <span className="font-figure font-bold tabular-nums text-warning-strong">{r.paperwork}</span>
        )}
        {r.paperworkPending > 0 ? (
          <span
            className={cn("text-2xs text-muted-foreground", r.paperwork > 0 && "ml-1")}
            title="Raised, not yet validated by Quality"
          >
            {r.paperwork > 0 ? `+${r.paperworkPending}` : `${r.paperworkPending} pending`}
          </span>
        ) : (
          r.paperwork === 0 && <span className="font-figure text-muted-foreground/60">—</span>
        )}
      </td>

      <td
        className={cn(
          "whitespace-nowrap px-2 py-2 text-right font-figure tabular-nums",
          r.highCritical ? "font-bold text-destructive-strong" : "text-muted-foreground/60",
        )}
      >
        {r.highCritical || "—"}
      </td>

      {/* Neutral, not red: these are points on the record, not a fine. */}
      <td className="w-[150px] py-2 pl-3 align-middle">
        <div className="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
          <span className="font-figure text-sm font-bold tabular-nums text-foreground">{r.points}</span>
          <span className="text-2xs text-muted-foreground">
            {r.openPoints ? `pts · ${r.openPoints} open` : "pts"}
          </span>
        </div>
        <WeightBar points={r.points} openPoints={r.openPoints} max={max} />
      </td>
    </tr>
  );
}

/**
 * Who is accumulating deviations, and what it costs them.
 *
 * This is the whole of the Quality module's tracking now. The To do / In progress /
 * Complete board is gone: it answered "what is left to do today", which changes twice
 * an hour and means nothing on a report. What is left is the question a review asks —
 * in whose name are actions still standing, and how many points have they picked up.
 *
 * "Open" means not yet closed by a manager. That is the lifecycle that carries a
 * signature: raised, then validated or rejected by Quality, then filed.
 *
 * The points column ACCUMULATES. It is not written as a penalty and carries no minus
 * sign: the table records what was raised, and leaves what it costs to the scorecard.
 */
export function QualityTrackingByLeader({ actions, periodLabel, onSelectLeader }: QualityTrackingByLeaderProps) {
  // Nothing is drawn until attribution is in: an empty exclusion set is a valid
  // answer meaning "everything counts", so rendering early shows every leader an
  // inflated total and then corrects it in front of them.
  const { excluded, ready, failed } = useLeaderAttribution();
  const rows = useMemo(() => leaderTracking(actions, excluded), [actions, excluded]);
  const [showAll, setShowAll] = useState(false);

  // Rows already arrive worst-first, so the head of the list sets the scale.
  const max = rows[0]?.points ?? 0;

  // A long tail of leaders with nothing against them pushes the two names a director
  // needs off the top of the card. They are counted, named and one click away — they
  // are just not the answer to the question the table asks.
  const scoring = rows.filter((r) => r.points > 0 || r.highCritical > 0);
  const hiddenCount = rows.length - scoring.length;
  const folded = rows.length > FOLD_ABOVE && hiddenCount >= FOLD_MIN_HIDDEN;
  const visible = folded && !showAll ? scoring : rows;

  return (
    <Card className="flex flex-col break-inside-avoid">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide">
          <Users className="h-4 w-4 text-muted-foreground" />
          Quality tracking by leader
        </CardTitle>
        <span className="shrink-0 whitespace-nowrap pt-0.5 text-2xs font-medium text-muted-foreground">
          {periodLabel}
        </span>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col pt-0">
        {/* The whole table waits, not just the Points cells: the rows are SORTED by
            points and the fold hides everyone on zero, so drawing it early would put
            the wrong leaders at the top and hide the right ones. */}
        {!ready ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {failed
              ? "Points are unavailable: the label attribution table could not be read."
              : "Working out which actions count…"}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No quality actions in this period.
          </p>
        ) : (
          <>
            <div className="-mx-2 overflow-x-auto px-2">
              <table className="w-full min-w-[540px] text-left text-xs">
                <colgroup>
                  <col />
                  <col className="w-16" />
                  <col className="w-16" />
                  <col className="w-28" />
                  <col className="w-24" />
                  <col className="w-[150px]" />
                </colgroup>
                <thead>
                  <tr className="border-b text-2xs font-bold uppercase tracking-wide text-muted-foreground [&>th]:whitespace-nowrap">
                    <th className="py-2 pr-3 font-bold">Leader</th>
                    <th className="px-2 py-2 text-right font-bold">Actions</th>
                    <th className="px-2 py-2 text-right font-bold">Open</th>
                    <th className="px-2 py-2 text-right font-bold">Paperwork</th>
                    <th className="px-2 py-2 text-right font-bold">High / Crit</th>
                    <th className="py-2 pl-3 text-right font-bold">Points</th>
                  </tr>
                </thead>
                <tbody className="font-medium">
                  {visible.map((r) => (
                    <LeaderRow key={r.leader} r={r} max={max} onSelectLeader={onSelectLeader} />
                  ))}
                </tbody>
              </table>
            </div>

            {folded && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-auto flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border pt-2 pb-2 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")} />
                {showAll
                  ? "Show only leaders carrying points"
                  : `Show ${hiddenCount} leader${hiddenCount === 1 ? "" : "s"} with no points`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default QualityTrackingByLeader;
