import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Plus, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/DateField";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { countResponses, windowLabel, audienceLine, type OvertimeRequest, type OvertimeResponse } from "@/lib/overtimeRequests";
import { askShift, OVERTIME_SHIFTS, type OvertimeShift } from "@/lib/overtimeShifts";
import {
  calendarStatus, monthGrid, weekDays, viewTitle, stepAnchor, isoDate,
  CALENDAR_STATUS_LABEL, CALENDAR_STATUS_BADGE, type CalendarView, type CalendarStatus,
} from "@/lib/overtimeCalendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHIFT_ICON: Record<OvertimeShift, typeof Sun> = { Day: Sun, Night: Moon };
/** The chosen view must read as chosen; the toggle's own "on" is barely off the page colour. */
export const TOGGLE_ON = "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";
/** A month cell shows this many asks; the rest are a "+N more" that opens the day. */
const MONTH_CELL_MAX = 3;

/** The thin bar at the start of each entry. Colour only repeats the label beside it. */
const STATUS_BAR: Record<CalendarStatus, string> = {
  needs: "border-l-warning",
  partial: "border-l-warning",
  full: "border-l-success",
  booked: "border-l-success",
  in_progress: "border-l-primary",
  completed: "border-l-border",
  closed: "border-l-border",
  cancelled: "border-l-border",
};

interface Props {
  view: CalendarView;
  anchor: string;
  onViewChange: (v: CalendarView) => void;
  onAnchorChange: (iso: string) => void;
  asks: OvertimeRequest[];
  responsesByRequest: Map<string, OvertimeResponse[]>;
  mayManage: boolean;
  onSelect: (requestId: string) => void;
  onCreate: (date: string) => void;
}

interface Entry {
  request: OvertimeRequest;
  status: CalendarStatus;
  accepted: number;
  pending: number;
  shift: OvertimeShift;
}

/**
 * Overtime on a calendar: a month to see where people are missing, a week to plan
 * shift by shift, a day to read every ask.
 *
 * Reads the same asks and answers the list does — the panel hands them in — and
 * writes nothing. Pressing an entry opens it in the panel's detail sheet, where the
 * decisions are made; pressing an empty day (or its "+") starts a new ask on it.
 */
export function OvertimeCalendar({
  view, anchor, onViewChange, onAnchorChange, asks, responsesByRequest, mayManage, onSelect, onCreate,
}: Props) {
  const today = isoDate(new Date());
  const now = new Date();

  const byDate = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const r of asks) {
      const rs = responsesByRequest.get(r.id) ?? [];
      const c = countResponses(r, rs);
      const e: Entry = {
        request: r,
        status: calendarStatus(r, rs, now),
        accepted: c.accepted,
        pending: rs.filter((x) => x.answer === "yes" && x.decision === null).length,
        shift: askShift(r),
      };
      m.set(r.on_date, [...(m.get(r.on_date) ?? []), e]);
    }
    return m;
    // `now` is read once per render on purpose; the list refetches every mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asks, responsesByRequest]);

  const canCreateOn = (d: string) => mayManage && d >= today;

  return (
    <section aria-label="Overtime calendar" className="space-y-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-9 w-9" aria-label={`Previous ${view}`}
            onClick={() => onAnchorChange(stepAnchor(view, anchor, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => onAnchorChange(today)}>Today</Button>
          <Button size="icon" variant="outline" className="h-9 w-9" aria-label={`Next ${view}`}
            onClick={() => onAnchorChange(stepAnchor(view, anchor, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="order-first w-full font-display text-lg font-semibold tabular-nums sm:order-none sm:w-auto sm:min-w-0 sm:flex-1" aria-live="polite">
          {viewTitle(view, anchor)}
        </h2>
        <DateField value={anchor} onChange={(d) => d && onAnchorChange(d)} aria-label="Go to date" />
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && onViewChange(v as CalendarView)}
          variant="outline" size="sm" aria-label="Calendar view">
          <ToggleGroupItem value="month" className={TOGGLE_ON}>Month</ToggleGroupItem>
          <ToggleGroupItem value="week" className={TOGGLE_ON}>Week</ToggleGroupItem>
          <ToggleGroupItem value="day" className={TOGGLE_ON}>Day</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {view === "month" && (
        <MonthView anchor={anchor} today={today} byDate={byDate} canCreateOn={canCreateOn}
          onSelect={onSelect} onCreate={onCreate}
          onOpenDay={(d) => { onAnchorChange(d); onViewChange("day"); }} />
      )}
      {view === "week" && (
        <WeekView anchor={anchor} today={today} byDate={byDate} canCreateOn={canCreateOn}
          onSelect={onSelect} onCreate={onCreate}
          onOpenDay={(d) => { onAnchorChange(d); onViewChange("day"); }} />
      )}
      {view === "day" && (
        <DayView date={anchor} entries={byDate.get(anchor) ?? []} canCreate={canCreateOn(anchor)}
          onSelect={onSelect} onCreate={onCreate} />
      )}

      <Legend />
    </section>
  );
}

function Legend() {
  const shown: CalendarStatus[] = ["needs", "partial", "full", "in_progress", "completed", "closed", "cancelled"];
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-2xs text-muted-foreground" aria-label="Legend">
      {shown.map((s) => (
        <li key={s} className={cn("border-l-[3px] pl-1.5", STATUS_BAR[s])}>{CALENDAR_STATUS_LABEL[s]}</li>
      ))}
    </ul>
  );
}

/** "3 of 4 filled", or "3 booked" on an ask with no number. */
function filledText(e: Entry): string {
  return e.request.headcount == null ? `${e.accepted} booked` : `${e.accepted} of ${e.request.headcount} filled`;
}

/** One ask as a compact line: hours, filled, status. A button: it opens the detail. */
function EntryChip({ e, onSelect, compact = false }: { e: Entry; onSelect: (id: string) => void; compact?: boolean }) {
  const label = `${windowLabel(e.request.starts_at, e.request.ends_at)}, ${e.shift} shift, `
    + `${filledText(e)}, ${CALENDAR_STATUS_LABEL[e.status]}`;
  return (
    <button
      type="button"
      onClick={(ev) => { ev.stopPropagation(); onSelect(e.request.id); }}
      aria-label={label}
      title={label}
      className={cn(
        "block w-full rounded-md border border-l-[3px] bg-background px-1.5 py-1 text-left text-xs",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        STATUS_BAR[e.status],
        (e.status === "cancelled" || e.status === "completed") && "text-muted-foreground",
        e.status === "cancelled" && "line-through decoration-muted-foreground/60",
      )}
    >
      <span className="flex items-center justify-between gap-1 tabular-nums">
        <span className="truncate font-medium">{e.request.starts_at.slice(0, 5)}</span>
        <span className="shrink-0">{e.request.headcount == null ? `${e.accepted} in` : `${e.accepted}/${e.request.headcount}`}</span>
      </span>
      {!compact && (
        <span className="block truncate text-2xs text-muted-foreground">{CALENDAR_STATUS_LABEL[e.status]}</span>
      )}
    </button>
  );
}

interface GridProps {
  anchor: string;
  today: string;
  byDate: Map<string, Entry[]>;
  canCreateOn: (d: string) => boolean;
  onSelect: (id: string) => void;
  onCreate: (d: string) => void;
  onOpenDay: (d: string) => void;
}

function MonthView({ anchor, today, byDate, canCreateOn, onSelect, onCreate, onOpenDay }: GridProps) {
  const weeks = monthGrid(anchor);
  return (
    <div role="grid" aria-label="Month" className="overflow-hidden rounded-lg border">
      <div role="row" className="grid grid-cols-7 border-b bg-muted/40">
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="px-1 py-1.5 text-center text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div role="row" key={week[0].iso} className="grid grid-cols-7 border-b last:border-b-0">
          {week.map((g) => {
            const entries = byDate.get(g.iso) ?? [];
            const live = entries.filter((e) => e.status !== "cancelled");
            // Only a numbered ask has places "to fill"; one with no number just has nobody yet.
            const short = live.reduce((n, e) => n + (e.request.headcount == null ? 0 : Math.max(0, e.request.headcount - e.accepted)), 0);
            const needsAny = live.some((e) => e.status === "needs" || e.status === "partial");
            return (
              <div
                role="gridcell" key={g.iso} data-date={g.iso}
                aria-label={`${g.iso}: ${entries.length} ${entries.length === 1 ? "ask" : "asks"}`}
                className={cn(
                  "group relative min-h-[4.5rem] border-r p-1 last:border-r-0 sm:min-h-[7rem]",
                  !g.inMonth && "bg-muted/30 text-muted-foreground",
                  g.iso < today && "bg-muted/20",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-1">
                  <button
                    type="button" onClick={() => onOpenDay(g.iso)}
                    aria-label={`Open ${g.iso}`}
                    className={cn(
                      "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums hover:bg-accent",
                      g.iso === today && "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
                    )}
                  >
                    {g.day}
                  </button>
                  {canCreateOn(g.iso) && (
                    <button
                      type="button" onClick={() => onCreate(g.iso)} aria-label={`New ask on ${g.iso}`}
                      className="hidden h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:flex group-hover:flex sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {/* A phone has no room for chips: a count, and the open-gap word if any. */}
                {entries.length > 0 && (
                  <button type="button" onClick={() => onOpenDay(g.iso)}
                    className="block w-full text-left text-2xs leading-tight sm:hidden">
                    <span className="font-semibold tabular-nums">{entries.length}</span> {entries.length === 1 ? "ask" : "asks"}
                    {needsAny && <span className="block text-warning-strong">{short > 0 ? `${short} to fill` : "Nobody yet"}</span>}
                  </button>
                )}
                <div className="hidden space-y-1 sm:block">
                  {entries.slice(0, MONTH_CELL_MAX).map((e) => (
                    <EntryChip key={e.request.id} e={e} onSelect={onSelect} />
                  ))}
                  {entries.length > MONTH_CELL_MAX && (
                    <button type="button" onClick={() => onOpenDay(g.iso)}
                      className="w-full rounded px-1 text-left text-2xs font-medium text-muted-foreground hover:bg-accent">
                      +{entries.length - MONTH_CELL_MAX} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WeekView({ anchor, today, byDate, canCreateOn, onSelect, onCreate, onOpenDay }: GridProps) {
  const days = weekDays(anchor);
  return (
    // Seven columns from a desk; on a phone the days stack, because seven columns of
    // 50px cannot hold a time and a count.
    <div className="grid gap-2 md:grid-cols-7 md:gap-0 md:overflow-hidden md:rounded-lg md:border">
      {days.map((d, i) => {
        const entries = byDate.get(d) ?? [];
        return (
          <div key={d} data-date={d} className={cn(
            "rounded-lg border p-2 md:rounded-none md:border-0 md:border-r md:last:border-r-0",
            d < today && "bg-muted/20",
          )}>
            <div className="mb-2 flex items-center justify-between gap-1">
              <button type="button" onClick={() => onOpenDay(d)}
                className={cn("rounded px-1 text-left text-xs font-semibold hover:bg-accent",
                  d === today && "text-primary")}>
                {WEEKDAYS[i]} <span className="tabular-nums">{Number(d.slice(8))}</span>
              </button>
              {canCreateOn(d) && (
                <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`New ask on ${d}`}
                  onClick={() => onCreate(d)}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {OVERTIME_SHIFTS.map((s) => {
              const Icon = SHIFT_ICON[s];
              const mine = entries.filter((e) => e.shift === s);
              return (
                <div key={s} className="mb-2 last:mb-0">
                  <div className="mb-1 flex items-center gap-1 text-2xs uppercase tracking-wider text-muted-foreground">
                    <Icon className="h-3 w-3" aria-hidden /> {s}
                  </div>
                  {mine.length === 0
                    ? <div className="text-2xs text-muted-foreground/70">—</div>
                    : <div className="space-y-1">{mine.map((e) => <EntryChip key={e.request.id} e={e} onSelect={onSelect} />)}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function DayView({ date, entries, canCreate, onSelect, onCreate }: {
  date: string; entries: Entry[]; canCreate: boolean;
  onSelect: (id: string) => void; onCreate: (d: string) => void;
}) {
  return (
    <div className="space-y-3">
      {OVERTIME_SHIFTS.map((s) => {
        const Icon = SHIFT_ICON[s];
        const mine = entries.filter((e) => e.shift === s);
        return (
          <section key={s} aria-label={`${s} shift, ${date}`} className="space-y-2">
            <h3 className="flex items-center gap-2 border-b pb-1 text-sm font-semibold">
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden /> {s} shift
            </h3>
            {mine.length === 0 ? (
              <p className="text-sm text-muted-foreground">No {s.toLowerCase()}-shift overtime on this day.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {mine.map((e) => (
                  <li key={e.request.id}>
                    <button type="button" onClick={() => onSelect(e.request.id)}
                      className={cn("flex w-full flex-col gap-2 border-l-[3px] p-3 text-left hover:bg-accent sm:flex-row sm:items-center sm:justify-between",
                        STATUS_BAR[e.status])}>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium tabular-nums">{windowLabel(e.request.starts_at, e.request.ends_at)}</span>
                          <StatusBadge status={CALENDAR_STATUS_BADGE[e.status]} label={CALENDAR_STATUS_LABEL[e.status]} size="sm" />
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">For: {audienceLine(e.request)}</span>
                        {e.request.note && <span className="mt-0.5 block truncate text-xs italic">“{e.request.note}”</span>}
                      </span>
                      <span className="grid shrink-0 grid-cols-3 gap-3 text-center text-xs tabular-nums">
                        <span><strong className="block text-base">{e.request.headcount ?? "—"}</strong>needed</span>
                        <span><strong className="block text-base">{e.accepted}</strong>booked</span>
                        <span><strong className="block text-base">{e.pending}</strong>pending</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {canCreate && (
        <Button size="sm" variant="outline" onClick={() => onCreate(date)}>
          <Plus className="mr-1 h-4 w-4" /> New ask on this day
        </Button>
      )}
    </div>
  );
}
