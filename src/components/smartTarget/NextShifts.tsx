import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { invokeFunction } from "@/lib/invokeFunction";
import { previewShifts, shiftAt } from "@/lib/smartTargetAhead";
import { queueRowsFromSections, type ScheduledJobItem } from "@/lib/smartTargetQueue";
import { cleanLabel, type CleaningRule } from "@/lib/smartTargetCleaning";
import { FORECAST_LINES, canonicalQueue, familyWithQueue } from "@/lib/smartTargetHistory";
import type { SkuCatalogue } from "@/lib/lineSku";
import type { LineNo } from "@/lib/smartTargetEngine";
import type { CleanCycle, HistoryShift, LineFactor } from "@/lib/smartTargetRates";

const hm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const dayLabel = (date: string, shift: string) =>
  `${shift === "DAY" ? "Day" : "Night"} ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" })}`;

/**
 * The next two shifts, ahead of time (decided 10/11, Q84): from iTouch's queue as it stands,
 * after what the current shift should still make, with deep and drill cleans charged. A
 * preview. The number that counts is still saved 30 minutes before each shift.
 */
export function NextShifts({
  basis,
  ruleFor,
  catalogue,
  isSample,
}: {
  basis: { cycles: CleanCycle[]; factors: LineFactor[]; history: HistoryShift[] } | null;
  ruleFor: ((line: LineNo) => CleaningRule) | null;
  catalogue: SkuCatalogue;
  isSample: (sku: string) => boolean;
}) {
  // Read only when asked: each read asks iTouch for every line's schedule, and the shift's
  // own read stays the only one a page opens with.
  const [asked, setAsked] = useState(false);
  const live = useQuery({
    queryKey: ["smart_target_live_queue"],
    enabled: asked,
    // Each read asks iTouch for every line's schedule: once every 15 minutes is plenty.
    staleTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const now = shiftAt(Date.now());
      if (!now) return { rows: [], readAt: Date.now(), reason: "No shift now." };
      const { data, error } = await invokeFunction<{ sections?: { line: string; items: ScheduledJobItem[] }[]; skipped?: boolean; reason?: string }>(
        "intouch-list-scheduled-jobs",
        { session_date: now.date, shift: now.shift },
      );
      if (error) throw new Error(error.message ?? String(error));
      if (data?.skipped) return { rows: [], readAt: Date.now(), reason: data.reason ?? "iTouch did not answer." };
      return { rows: queueRowsFromSections(data?.sections ?? []), readAt: Date.now(), reason: null as string | null };
    },
  });

  const shifts = useMemo(() => {
    if (!basis || !live.data?.rows.length) return null;
    // Codes as the product list knows them, iTouch's descriptions for the rest (Q85).
    const queue = canonicalQueue(live.data.rows, catalogue);
    return previewShifts({
      nowMs: live.data.readAt,
      queue,
      cycles: basis.cycles,
      factors: basis.factors,
      history: basis.history,
      familyOf: familyWithQueue(catalogue, queue),
      isSample,
      cleaningFor: ruleFor ?? undefined,
    });
  }, [basis, live.data, ruleFor, catalogue, isSample]);

  return (
    <Card data-testid="smart-target-next-shifts">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Next shifts</CardTitle>
        <p className="text-sm text-muted-foreground">
          A preview from iTouch's queue{live.data ? ` read at ${hm(live.data.readAt)}` : ""}, after what this shift should still make, with deep and drill cleans
          taken off. It changes until each shift's target is saved, 30 minutes before it starts.
        </p>
      </CardHeader>
      <CardContent>
        {!asked ? (
          <Button variant="outline" size="sm" onClick={() => setAsked(true)}>Show the next two shifts</Button>
        ) : live.isLoading ? (
          <p className="text-sm text-muted-foreground">Reading iTouch's queue…</p>
        ) : live.error ? (
          <p className="text-sm text-destructive-strong">iTouch's queue could not be read: {(live.error as Error).message}</p>
        ) : !basis ? (
          <p className="text-sm text-muted-foreground">No line rates yet, so the next shifts cannot be forecast.</p>
        ) : !shifts ? (
          <p className="text-sm text-muted-foreground">{live.data?.reason ?? "iTouch's queue has no jobs for the lines."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Line</th>
                  {shifts.map((s, i) => (
                    <th key={`${s.date}${s.shift}`} className="py-1.5 pr-3 font-medium">
                      {dayLabel(s.date, s.shift)} {i > 0 && <span className="font-normal">(less certain)</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FORECAST_LINES.map((line) => (
                  <tr key={line} className="border-t align-top" data-testid={`next-shifts-line-${line}`}>
                    <td className="py-2 pr-3 font-semibold">Line {line}</td>
                    {shifts.map((s) => {
                      const l = s.lines.find((x) => x.line === line);
                      return (
                        <td key={`${s.date}${s.shift}`} className="py-2 pr-3">
                          {!l || !l.jobs.length ? (
                            <span className="text-muted-foreground">No jobs left in iTouch</span>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-semibold tabular-nums">{l.expectedTotal === null ? "—" : l.expectedTotal.toLocaleString()}</span>
                                <Badge variant="outline" className="text-2xs text-muted-foreground">Preview</Badge>
                              </div>
                              <ul className="mt-1 space-y-0.5 text-xs">
                                {l.jobs.map((j, i) => (
                                  <li key={`${j.sku}${i}`}>
                                    {j.cleaning && (
                                      <span
                                        className="mr-1 rounded bg-warning/15 px-1 py-0.5 font-medium text-warning-strong"
                                        title={`${j.cleaning.reason}; ${j.cleaning.minutesFrom === "line_history" ? "the line's own logged time" : "the plan sheet's time"}`}
                                      >
                                        {cleanLabel(j.cleaning)}
                                      </span>
                                    )}
                                    <span className="font-mono">{j.sku ?? "—"}</span>{" "}
                                    <span className="tabular-nums text-muted-foreground">{j.expected?.toLocaleString() ?? "—"}</span>
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </td>
                      );
                    })}
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
