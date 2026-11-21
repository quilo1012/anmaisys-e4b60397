import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { bayInk } from "@/lib/lineBay";
import {
  MAX_MACHINE_TIME_DAYS,
  formatHours,
  machineTimeTotal,
  type LineMachineTime,
  type StopMinutes,
} from "@/lib/machineTime";

/**
 * Machine time for the search, laid out as iTouching's "OEE Machine by Period": one row
 * per line and a Total row, so the two screens can be read side by side.
 *
 * Produced is Production Control's own figure (what was logged on the sheet), not
 * iTouching's count, so it agrees with the readout above it.
 */

const pctTone = (pct: number | null) =>
  pct == null ? "text-muted-foreground"
    : pct >= 90 ? "text-success-strong"
    : pct >= 75 ? "text-warning-strong"
    : "text-destructive-strong";

const fmtPct = (pct: number | null) => (pct == null ? "—" : `${pct.toFixed(1)}%`);

/** The biggest stops of one kind, as "Breaks 10:35 · Line Preparation 9:50". */
function stopList(stops: StopMinutes[], planned: boolean, max = 5): string {
  return stops
    .filter((s) => s.planned === planned && Math.round(s.minutes) > 0)
    .slice(0, max)
    .map((s) => `${s.label} ${formatHours(s.minutes)}`)
    .join(" · ");
}

export interface MachineTimePanelProps {
  lines: LineMachineTime[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  tooLong: boolean;
  producedByLine: Map<string, number>;
  /** Filters that narrow the sheet but not the machine (leader, SKU). */
  narrowedBy: string[];
  order?: (a: string, b: string) => number;
}

export function MachineTimePanel({
  lines, isLoading, isError, error, onRetry, tooLong, producedByLine, narrowedBy, order,
}: MachineTimePanelProps) {
  const sorted = [...(lines ?? [])].sort((a, b) => (order ? order(a.line, b.line) : a.line.localeCompare(b.line)));
  const total = machineTimeTotal(sorted);
  const showTotal = sorted.length > 1;
  const produced = (line: string) => producedByLine.get(line);
  const producedTotal = sorted.reduce((s, l) => s + (produced(l.line) ?? 0), 0);
  const unplannedStops = stopList(total.stops, false);
  const plannedStops = stopList(total.stops, true);

  const th = "px-3 py-2 border-b font-display text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground whitespace-nowrap";
  const td = "px-3 py-2 border-b font-figure text-right whitespace-nowrap";

  return (
    <Card role="region" aria-label="Machine time">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 pt-3 pb-2">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.12em]">
            Machine time <span className="font-sans font-normal normal-case tracking-normal text-muted-foreground">· from iTouching</span>
          </h2>
          <p className="text-2xs text-muted-foreground">
            Available = Total − Planned · Availability = Run ÷ Available
          </p>
        </div>

        {tooLong ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">
            Machine time is worked out for up to {MAX_MACHINE_TIME_DAYS} days — narrow the period to see it.
          </p>
        ) : isLoading ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground" role="status">Reading the machine log…</p>
        ) : isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 px-3 pb-3 text-sm text-destructive-strong">
            <span>Could not read the machine log: {(error as Error)?.message ?? "unknown error"}</span>
            {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}
          </div>
        ) : sorted.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">No iTouching machine readings for this period.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead className="bg-muted">
                  <tr>
                    <th className={cn(th, "text-left")}>Line</th>
                    <th className={cn(th, "text-right")}>Total time</th>
                    <th className={cn(th, "text-right")}>Planned down</th>
                    <th className={cn(th, "text-right")}>Available</th>
                    <th className={cn(th, "text-right")}>Run time</th>
                    <th className={cn(th, "text-right")}>Unplanned down</th>
                    <th className={cn(th, "text-right")}>Availability</th>
                    <th className={cn(th, "text-right")}>Produced</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((l) => (
                    <tr key={l.line}>
                      <td className="px-3 py-2 border-b whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: bayInk(l.line) }} aria-hidden />
                          {l.line}
                        </span>
                      </td>
                      <td className={td}>{formatHours(l.totalMin)}</td>
                      <td className={td}>{formatHours(l.plannedMin)}</td>
                      <td className={td}>{formatHours(l.availableMin)}</td>
                      <td className={cn(td, "font-semibold")}>{formatHours(l.runMin)}</td>
                      <td className={td}>{formatHours(l.unplannedMin)}</td>
                      <td className={cn(td, "font-semibold", pctTone(l.availabilityPct))}>{fmtPct(l.availabilityPct)}</td>
                      <td className={td}>{produced(l.line) != null ? Math.round(produced(l.line)!).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                  {showTotal && (
                    <tr className="font-bold">
                      <td className="px-3 py-2 border-b">Total</td>
                      <td className={td}>{formatHours(total.totalMin)}</td>
                      <td className={td}>{formatHours(total.plannedMin)}</td>
                      <td className={td}>{formatHours(total.availableMin)}</td>
                      <td className={td}>{formatHours(total.runMin)}</td>
                      <td className={td}>{formatHours(total.unplannedMin)}</td>
                      <td className={cn(td, pctTone(total.availabilityPct))}>{fmtPct(total.availabilityPct)}</td>
                      <td className={td}>{Math.round(producedTotal).toLocaleString()}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="space-y-1 px-3 py-2 text-2xs text-muted-foreground">
              {unplannedStops && <p><span className="font-semibold text-foreground">Unplanned:</span> {unplannedStops}</p>}
              {plannedStops && <p><span className="font-semibold text-foreground">Planned:</span> {plannedStops}</p>}
              {total.noDataMin >= 1 && (
                <p>{formatHours(total.noDataMin)} of the period has no machine reading yet, so it is in Total and Available but not in Run or Unplanned.</p>
              )}
              {narrowedBy.length > 0 && (
                <p>Machine time is for the whole line — the {narrowedBy.join(" and ")} filter narrows the sheet below, not the machine.</p>
              )}
              <p>Read from the iTouching machine log every few minutes, so it can sit a little off iTouching's own OEE report.</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The same table for the printed sheet: black on white, no colour, no buttons. */
export function MachineTimePrintTable({
  lines, producedByLine, order,
}: {
  lines: LineMachineTime[];
  producedByLine: Map<string, number>;
  order?: (a: string, b: string) => number;
}) {
  if (!lines.length) return null;
  const sorted = [...lines].sort((a, b) => (order ? order(a.line, b.line) : a.line.localeCompare(b.line)));
  const total = machineTimeTotal(sorted);
  const th = "border-b border-black px-1.5 pb-[3px] text-right font-display text-[6pt] font-bold uppercase tracking-[0.1em] text-black/70";
  const td = "px-1.5 py-[3px] text-right font-figure whitespace-nowrap";
  const row = (l: LineMachineTime, produced: number | undefined, bold = false) => (
    <tr key={l.line} className={bold ? "pc-total font-bold" : undefined}>
      <td className="px-1.5 py-[3px] text-left">{l.line}</td>
      <td className={td}>{formatHours(l.totalMin)}</td>
      <td className={td}>{formatHours(l.plannedMin)}</td>
      <td className={td}>{formatHours(l.availableMin)}</td>
      <td className={td}>{formatHours(l.runMin)}</td>
      <td className={td}>{formatHours(l.unplannedMin)}</td>
      <td className={td}>{fmtPct(l.availabilityPct)}</td>
      <td className={td}>{produced != null ? Math.round(produced).toLocaleString() : "—"}</td>
    </tr>
  );
  return (
    <div className="mb-4">
      <div className="mb-1 font-display text-[6pt] font-bold uppercase leading-none tracking-[0.12em] text-black/60">
        Machine time · iTouching
      </div>
      <table className="text-[7.5pt] leading-[1.25]">
        <thead>
          <tr>
            <th className={`${th} text-left`}>Line</th>
            <th className={th}>Total time</th>
            <th className={th}>Planned down</th>
            <th className={th}>Available</th>
            <th className={th}>Run time</th>
            <th className={th}>Unplanned down</th>
            <th className={th}>Availability</th>
            <th className={th}>Produced</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((l) => row(l, producedByLine.get(l.line)))}
          {sorted.length > 1 && row(total, sorted.reduce((s, l) => s + (producedByLine.get(l.line) ?? 0), 0), true)}
        </tbody>
      </table>
    </div>
  );
}
