import { format } from "date-fns";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShiftTag } from "@/components/ShiftTag";
import { hoursLabel } from "@/lib/overtimeShifts";
import { localDate } from "@/lib/overtimeRequests";
import {
  buildBoardOvertime, buildPositionTimeline, OUTCOME_LABEL,
  type DatedPosition, type RecordChange,
} from "@/lib/employeePanelHistory";
import { useEmployeeBoardOvertime, useMovements, useRecentPlacements } from "@/hooks/useWorkforce";

const day = (iso: string) => format(new Date(`${iso}T12:00:00`), "dd/MM/yyyy");

interface Q<T> { data?: T; isLoading: boolean; isError: boolean; refetch: () => unknown }

/** Position, shift and rota: one timeline from both sources. */
export function PositionTimelineSection({
  dated, record, patternName,
}: {
  dated: Q<DatedPosition[]>;
  record: Q<RecordChange[]>;
  patternName: (id: string | null) => string;
}) {
  if (dated.isError || record.isError) {
    return (
      <div className="space-y-2 text-sm">
        <p>Employee history could not be loaded.</p>
        <Button variant="outline" onClick={() => { void dated.refetch(); void record.refetch(); }}>Retry</Button>
      </div>
    );
  }
  if (dated.isLoading || record.isLoading) return <Skeleton className="h-24" />;
  const t = buildPositionTimeline(dated.data ?? [], record.data ?? [], patternName);
  return (
    <div className="space-y-2">
      {!t.hasDated && (
        <p className="text-sm text-muted-foreground">No dated changes — the current shift and rota apply to every date.</p>
      )}
      {t.entries.map((e) => (
        <div key={e.key} className="space-y-1 rounded border p-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {e.opening ? "From" : "Changed"} {day(e.date)}
            {e.at && ` · ${format(new Date(e.at), "HH:mm")}`}
          </p>
          {e.lines.map((l) => <p key={l}>{l}</p>)}
          {e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
        </div>
      ))}
      {t.hiddenNoops > 0 && (
        <p className="text-2xs text-muted-foreground">
          {t.hiddenNoops} {t.hiddenNoops === 1 ? "save that changed nothing is" : "saves that changed nothing are"} hidden
        </p>
      )}
      <p className="text-2xs text-muted-foreground">
        Job-title changes are recorded from 18/10/2026; earlier job titles are not known.
      </p>
    </div>
  );
}

/** Where they worked: the board's own recent rows, then the old line-move log if any. */
export function WhereTheyWorkedSection({ employeeId }: { employeeId: string }) {
  const placements = useRecentPlacements(employeeId);
  const { data: movements } = useMovements(employeeId);
  return (
    <div className="space-y-2">
      {placements.isLoading ? <Skeleton className="h-24" /> : placements.isError ? (
        <p className="text-sm text-muted-foreground">The board is not available to your role.</p>
      ) : (placements.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">This person has not been placed on the board yet.</p>
      ) : (
        <ul className="space-y-1" aria-label="Recent placements">
          {(placements.data ?? []).map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded border p-2 text-xs">
              <span className="whitespace-nowrap text-muted-foreground">{day(p.on_date)}</span>
              <ShiftTag shift={p.shift} />
              <span className="min-w-0 flex-1 truncate">{p.area_name ?? "No area"}</span>
              <Badge variant="outline" className="text-2xs capitalize">{p.status}</Badge>
            </li>
          ))}
        </ul>
      )}
      {(movements ?? []).length > 0 && (
        <>
          <h4 className="pt-2 text-xs font-semibold text-muted-foreground">Line moves (older log)</h4>
          {(movements ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded border p-2 text-xs">
              <span className="whitespace-nowrap text-muted-foreground">{format(new Date(m.moved_at), "dd/MM HH:mm")}</span>
              <span className="truncate">{m.from_line ?? "Unassigned"}</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{m.to_line ?? "Unassigned"}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const clockLine = (c: { start_time: string | null; end_time: string | null; worked_minutes: number | null; balance_minutes: number | null }) => {
  const parts: string[] = [];
  // TimeMoto writes "<" / ">" for a shift that runs on from the day before / into the next.
  const t = (v: string | null, edge: string) => (!v ? "?" : v === "<" || v === ">" ? edge : v.slice(0, 5));
  if (c.start_time || c.end_time) parts.push(`${t(c.start_time, "from the day before")}–${t(c.end_time, "into the next day")}`);
  if (c.worked_minutes != null) parts.push(`worked ${hoursLabel(c.worked_minutes)}`);
  if (c.balance_minutes != null && c.balance_minutes !== 0) {
    parts.push(`balance ${c.balance_minutes < 0 ? "−" : "+"}${hoursLabel(Math.abs(c.balance_minutes))}`);
  }
  return parts.join(" · ") || "a row with no times";
};

/** Overtime on the board, with the clock beside each date. Never summed together. */
export function BoardOvertimeSection({ employeeId, today = localDate() }: { employeeId: string; today?: string }) {
  const { board, asks, clock } = useEmployeeBoardOvertime(employeeId);
  if (board.isLoading) return <Skeleton className="h-24" />;
  if (board.isError) {
    return <p className="text-sm text-muted-foreground">The Headcount Board is not available to your role, so board overtime cannot be shown here.</p>;
  }
  const { lines, summary } = buildBoardOvertime(board.data ?? [], asks.data ?? [], clock.data ?? [], today);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2" aria-label="Board overtime summary">
        <div className="rounded border p-2">
          <div className="text-2xs uppercase text-muted-foreground">Last 30 days</div>
          <div className="font-figure text-xl font-bold" data-testid="ot-last30">{summary.last30}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-2xs uppercase text-muted-foreground">All time</div>
          <div className="font-figure text-xl font-bold" data-testid="ot-total">{summary.total}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-2xs uppercase text-muted-foreground">Upcoming</div>
          <div className="font-figure text-xl font-bold" data-testid="ot-upcoming">{summary.upcoming}</div>
        </div>
      </div>
      <p className="text-2xs text-muted-foreground">Overtime shifts on the board. The clock below each date is its own figure and is not counted in.</p>
      {asks.isError && <p className="text-2xs text-muted-foreground">Overtime asks are not available to your role; hours and outcomes are not shown.</p>}
      {clock.isError && <p className="text-2xs text-muted-foreground">The clock (TimeMoto) is not available to your role.</p>}
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">The board holds no overtime shifts for this person.</p>
      ) : (
        <ul className="space-y-1" aria-label="Overtime on the board">
          {lines.map((l) => (
            <li key={l.key} className="space-y-0.5 rounded border p-2 text-xs" data-state={l.state}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="whitespace-nowrap font-medium">{day(l.date)}</span>
                {l.shift && <ShiftTag shift={l.shift} />}
                {l.area && <span className="truncate">{l.area}</span>}
                {l.hours && <span className="text-muted-foreground">{l.hours}</span>}
                {l.booked && <span className="text-2xs text-muted-foreground">(booked {l.booked})</span>}
                <span className="ml-auto flex gap-1">
                  {l.state === "booked" && <Badge variant="outline" className="text-2xs">Booked</Badge>}
                  {l.state === "worked" && !l.outcome && <Badge variant="outline" className="text-2xs">Placed</Badge>}
                  {l.state === "cancelled" && <Badge variant="outline" className="text-2xs">Cancelled</Badge>}
                  {l.outcome && <Badge variant="secondary" className="text-2xs">{OUTCOME_LABEL[l.outcome] ?? l.outcome}</Badge>}
                </span>
              </div>
              {!clock.isError && (
                <div className="text-2xs text-muted-foreground" data-testid="clock-line">
                  Clock (TimeMoto): {l.clock ? clockLine(l.clock) : "nothing recorded"}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
