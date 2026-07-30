import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { leaderTracking, scoreImpactLabel, type TrackedAction } from "@/lib/leaderTracking";

export interface QualityTrackingByLeaderProps {
  actions: TrackedAction[];
  /** The period the numbers cover, printed beside the title. */
  periodLabel: string;
  /** Optional click-through, e.g. to open that leader's scorecard. */
  onSelectLeader?: (leader: string) => void;
}

/**
 * Who is accumulating deviations, and what it costs them.
 *
 * The status counts (To do / In progress / Complete) stay where they belong — on the
 * board above, where they double as the filter. They answer "what is left to do
 * today". This answers the question a review asks instead: which leader, how severe,
 * how much of it was paperwork, and what comes off the scorecard for it.
 */
export function QualityTrackingByLeader({ actions, periodLabel, onSelectLeader }: QualityTrackingByLeaderProps) {
  const rows = leaderTracking(actions);

  return (
    <Card className="break-inside-avoid">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
          <Users className="h-4 w-4 text-muted-foreground" />
          Quality tracking by leader
        </CardTitle>
        <span className="text-xs font-medium text-muted-foreground">{periodLabel}</span>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No quality actions in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b text-2xs font-bold uppercase text-muted-foreground">
                  <th className="py-2 pr-2">Leader</th>
                  <th className="py-2 px-2">Shift</th>
                  <th className="py-2 px-2 text-center">Actions</th>
                  <th className="py-2 px-2 text-center">Paperwork</th>
                  <th className="py-2 px-2 text-center">High / Critical</th>
                  <th className="py-2 px-2 text-center">Points</th>
                  <th className="py-2 pl-2 text-right">Score impact</th>
                </tr>
              </thead>
              <tbody className="divide-y font-medium">
                {rows.map((r) => (
                  <tr
                    key={r.leader}
                    className={onSelectLeader ? "cursor-pointer hover:bg-muted/50" : undefined}
                    onClick={onSelectLeader ? () => onSelectLeader(r.leader) : undefined}
                  >
                    <td className="py-2.5 pr-2 font-semibold">{r.leader}</td>
                    <td className="py-2.5 px-2 text-muted-foreground">{r.shifts}</td>
                    <td className="py-2.5 px-2 text-center font-mono font-bold">{r.total}</td>
                    <td className="py-2.5 px-2 text-center">
                      <span
                        className={
                          r.paperwork
                            ? "rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-bold text-amber-800"
                            : "text-muted-foreground"
                        }
                      >
                        {r.paperwork} validated
                      </span>
                      {r.paperworkPending > 0 && (
                        // Named as pending rather than folded into the count: it is not
                        // a penalty until Quality has validated it.
                        <span className="ml-1 text-2xs text-muted-foreground">+{r.paperworkPending} pending</span>
                      )}
                    </td>
                    <td
                      className={`py-2.5 px-2 text-center font-mono ${r.highCritical ? "font-bold text-destructive" : "text-muted-foreground"}`}
                    >
                      {r.highCritical}
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono">{r.points}</td>
                    <td
                      className={`py-2.5 pl-2 text-right font-mono font-bold ${
                        r.clean && !r.documentationPenaltyPct ? "text-success-strong" : "text-destructive"
                      }`}
                    >
                      {scoreImpactLabel(r)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default QualityTrackingByLeader;
