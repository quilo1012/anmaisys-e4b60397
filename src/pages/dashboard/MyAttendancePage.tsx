import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { LoadFailed } from "@/components/portal/LoadFailed";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { areaText, fmtDay } from "@/lib/myShiftText";
import { cn } from "@/lib/utils";
import { ShiftTag } from "@/components/ShiftTag";
import { shiftKind } from "@/lib/shiftLook";
import { useMyAttendance } from "@/hooks/useMyAttendance";
import { useMyOvertimeShifts } from "@/hooks/useMyOvertimeShifts";
import { currentShift } from "@/lib/operationalShift";
import { isSharedTabletSession } from "@/lib/sharedTabletSession";
import {
  buildMyDays, summarise, rangeChoices, defaultRange, myShifts, periodAround,
  overtimeOnTheBoardOnly, summariseOvertimeShifts,
  type DayStatus, type MyAttendanceData, type MyDay, type MyShift,
} from "@/lib/myAttendance";

const STATUS: Record<DayStatus, { label: string; cell: string }> = {
  present:   { label: "Present",      cell: "bg-success/15 text-success-strong border-success/30" },
  holiday:   { label: "Holiday",      cell: "bg-primary/10 text-primary border-primary/30" },
  sick:      { label: "Sickness",     cell: "bg-warning/15 text-warning-strong border-warning/30" },
  unpaid:    { label: "Unpaid leave", cell: "bg-muted text-foreground border-border" },
  absent:    { label: "Absent",       cell: "bg-destructive/10 text-destructive border-destructive/30" },
  other:     { label: "Other",        cell: "bg-muted text-foreground border-border" },
  // A day off steps back, so the days that ask something of the person stand out.
  rest:      { label: "Rest day",     cell: "bg-transparent text-muted-foreground/70 border-transparent" },
  scheduled: { label: "Scheduled",    cell: "bg-card text-foreground border-primary/50 border-dashed" },
  no_record: { label: "No record yet", cell: "bg-muted/50 text-muted-foreground border-dashed border-muted-foreground/30" },
};

/** Overtime on a present day gets its own colour, so it is not read as an ordinary day. */
const OVERTIME_CELL = "bg-indigo-500/15 text-indigo-700 border-indigo-500/40 dark:text-indigo-300";

const fmtHours = (h: number | null) => (h == null ? "—" : `${h.toFixed(h % 1 === 0 ? 0 : 2)} h`);
const fmtMin = (m: number | null) => (m == null ? "—" : `${m < 0 ? "−" : ""}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, "0")}`);

/**
 * My Attendance — the signed-in person's own record, and nothing else.
 *
 * Read-only. The figures come from the same functions the finance close and the Leave
 * screen run, over rows the database returns for this login only (`my_attendance`).
 * TimeMoto is imported by hand, so nothing here claims to be live: the top line says
 * how far the clock record reaches, and a rostered day past it is "no record yet".
 */
export default function MyAttendancePage() {
  const sharedTablet = isSharedTabletSession();
  const today = currentShift().operationalDate;

  // The pay periods arrive with the first answer, so the page opens on this month and
  // moves to the pay period running today as soon as it knows it.
  const [range, setRange] = useState(() => defaultRange([], today));
  const [picked, setPicked] = useState<string | null>(null);
  const { data: result, isPending: isLoading, isError, refetch } = useMyAttendance(range.from, range.to);
  const periods = result?.state === "ready" ? result.data.periods : null;

  useEffect(() => {
    if (picked || !periods) return;
    const next = defaultRange(periods, today);
    if (next.from !== range.from || next.to !== range.to) setRange(next);
    setPicked("auto");
  }, [periods, picked, today, range.from, range.to]);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <ModuleHeader
          module="Attendance"
          title="My Attendance"
          description="Your own clock record, days off and hours. Nobody else's."
          brand
        />
        {sharedTablet ? (
          <Card><CardContent className="p-4 text-sm">
            This tablet is signed in for the line, not for one person, so it cannot show anybody's
            attendance. Open My Attendance on your own phone, signed in with your badge.
          </CardContent></Card>
        ) : isLoading ? (
          <div role="status" aria-label="Loading your attendance" className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : isError ? (
          <LoadFailed
            message="Your attendance could not be loaded. Check your connection and try again."
            onRetry={() => void refetch()}
          />
        ) : result?.state === "notSetUp" ? (
          <Card><CardContent className="p-4 text-sm">
            My Attendance is being set up. Your record is safe — this page will show it once the update is finished.
          </CardContent></Card>
        ) : result?.state === "unlinked" ? (
          <Card><CardContent className="p-4 text-sm">
            Your account is not linked to your badge yet, so there is no record to show. Open My Overtime and
            enter the number on your badge, or ask your supervisor to link it.
          </CardContent></Card>
        ) : result?.state === "ready" ? (
          <>
          <Attendance
            data={result.data} today={today} range={range}
            onRange={(r, key) => { setPicked(key); setRange(r); }}
            pickedKey={picked}
          />
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

function Attendance({ data, today, range, onRange, pickedKey }: {
  data: MyAttendanceData; today: string; range: { from: string; to: string };
  onRange: (r: { from: string; to: string }, key: string) => void; pickedKey: string | null;
}) {
  const days = useMemo(() => buildMyDays(data, range.from, range.to, today), [data, range, today]);
  // The booked overtime shifts. One that has ended counts as worked — the supervisor only
  // records the exception — and on a day the clock has no hours for yet it goes into the
  // period's overtime, so the figure is not 0 h for overtime that was worked and simply
  // not imported (30/10/2026).
  const { data: otRecords } = useMyOvertimeShifts(data.me.id, range.from, range.to);
  const ot = useMemo(
    () => (otRecords ? summariseOvertimeShifts(otRecords, data.clocks, new Date()) : null),
    [otRecords, data.clocks],
  );
  const s = useMemo(
    () => summarise(data, days, range.from, range.to, today, ot?.notOnClockMinutes ?? 0),
    [data, days, range, today, ot],
  );
  const choices = useMemo(() => rangeChoices(data.periods, today), [data.periods, today]);
  const [selected, setSelected] = useState<MyDay | null>(null);
  const currentKey = choices.find((c) => c.from === range.from && c.to === range.to)?.key ?? "custom";
  const todayDay = days.find((d) => d.date === today) ?? null;
  // Overtime the office placed on the Headcount by hand, from today to the end of the range.
  const boardAhead = useMemo(
    () => (range.to < today ? [] : overtimeOnTheBoardOnly(data, range.from > today ? range.from : today, range.to)),
    [data, range.from, range.to, today],
  );
  const gapShifts = ot ? ot.notOnClock.length : 0;
  const gapWords = gapShifts === 1 ? "1 overtime shift" : `${gapShifts} overtime shifts`;
  const clockReach = data.clocked_to ? `Your clock record reaches ${fmtDay(data.clocked_to)}.` : "No clock record has been imported for you yet.";
  // For the period: the worked shifts are IN the figure, and the note says how much.
  const periodNote = s.settled && s.settled.attendedHours > 0
    ? `${fmtHours(s.settled.clockOvertimeHours ?? 0)} on the clock + ${fmtHours(s.settled.attendedHours)} from ${gapWords} you worked on days the clock has no hours for yet. ${clockReach} Not yet paid; the office's close counts these hours once the clock is imported.`
    : "Worked over your contract across the whole pay period, as the finance close counts it. Recorded on the clock — not yet approved or paid.";
  // For a week or a month there is no settlement: the running balance stays the clock's.
  const balanceGap = gapShifts > 0
    ? ` ${clockReach} ${gapWords} you worked (${fmtHours((ot?.notOnClockMinutes ?? 0) / 60)}) ${gapShifts === 1 ? "is" : "are"} not in this balance yet.`
    : "";

  return (
    <>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-medium">{data.me.full_name}{data.me.employee_ref ? ` · ${data.me.employee_ref}` : ""}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {data.me.shift_group && <ShiftTag shift={data.me.shift_group} noun="crew" />}
              <span>{[data.me.department, data.me.shift_group && !shiftKind(data.me.shift_group) && `${data.me.shift_group} crew`, data.pattern?.name].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="freshness">
            {todayDay && ["holiday", "sick", "unpaid"].includes(todayDay.status)
              ? `Today: ${STATUS[todayDay.status].label}. `
              : ""}
            {data.clocked_to
              ? `Your clock record reaches ${fmtDay(data.clocked_to)}${data.clocks_imported_at ? `, imported ${new Date(data.clocks_imported_at).toLocaleDateString()}` : ""}. Days after that show as "no record yet", not as absences.`
              : "No clock record has been imported for you yet."}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              value={currentKey}
              onValueChange={(k) => {
                if (k === "custom") { onRange(range, "custom"); return; }
                const c = choices.find((x) => x.key === k);
                if (c) onRange({ from: c.from, to: c.to }, k);
              }}
            >
              <SelectTrigger className="w-full sm:w-64" aria-label="Period"><SelectValue /></SelectTrigger>
              <SelectContent>
                {choices.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                <SelectItem value="custom">Custom dates…</SelectItem>
              </SelectContent>
            </Select>
            {(currentKey === "custom" || pickedKey === "custom") && (
              <div className="flex gap-2">
                <Input type="date" aria-label="From" value={range.from} max={range.to}
                  onChange={(e) => e.target.value && onRange({ from: e.target.value, to: range.to }, "custom")} />
                <Input type="date" aria-label="To" value={range.to} min={range.from}
                  onChange={(e) => e.target.value && onRange({ from: range.from, to: e.target.value }, "custom")} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Hours worked" value={fmtHours(s.workedHours)} note="On the clock" />
        <Tile label="Hours scheduled" value={fmtHours(s.scheduledHours)} note="On the days recorded" />
        <Tile label="Days present" value={String(s.daysPresent)} note={s.shiftsDue != null ? `of ${s.shiftsDue} on your rota` : undefined} />
        <Tile label="Holiday" value={`${s.holidayDays} d`} />
        <Tile label="Sickness" value={`${s.sickDays} d`} />
        <Tile label="Absent / other" value={`${s.unpaidDays + s.otherAbsenceDays} d`} note={s.unpaidDays ? `${s.unpaidDays} unpaid` : undefined} />
        <Tile label="No record yet" value={`${s.noRecordDays} d`} note="Not counted as absence" />
      </div>

      <Card data-testid="hours-balance">
        <CardHeader className="pb-2"><CardTitle className="text-base">Hours and overtime</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {s.settled ? (
            <>
              <Row label={`Overtime for ${s.settled.period.name}`} value={fmtHours(s.settled.overtimeHours)}
                note={periodNote} />
              {(s.settled.owedHours ?? 0) > 0 && (
                <Row label="Hours short" value={fmtHours(s.settled.owedHours)} note="Under your contract across the period." />
              )}
              <Row label="Approved by payroll" value={s.payrollHours == null ? "Not recorded yet" : fmtHours(s.payrollHours)}
                note="What payroll has entered for this period. This is the figure that is paid." />
            </>
          ) : (
            <>
              <Row label="Running balance" value={s.balanceHours == null ? "—" : `${s.balanceHours > 0 ? "+" : ""}${fmtHours(s.balanceHours)}`}
                note={`Not overtime yet. Hours settle over the whole pay period, so a later week can cancel this out. Pick a pay period to see the overtime it settles at.${balanceGap}`} />
            </>
          )}
          {ot && <OvertimeShifts ot={ot} boardAhead={boardAhead} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <PeriodNav
            periods={data.periods} range={range} today={today}
            onGo={(p) => onRange({ from: p.start_date, to: p.end_date }, `period:${p.id}`)}
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <Calendar days={days} today={today} onPick={setSelected} selected={selected?.date ?? null} />
          <Legend days={days} />
          {selected && <DayDetail day={selected} shifts={myShifts(data, selected.date, selected.date)} />}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * The pay period, named right above the calendar, with the periods either side one tap
 * away. Moving changes the range the page asks for, so the calendar and the hours above
 * it follow. The periods are the payroll calendar as configured; nothing here makes one.
 */
function PeriodNav({ periods, range, today, onGo }: {
  periods: MyAttendanceData["periods"]; range: { from: string; to: string }; today: string;
  onGo: (p: MyAttendanceData["periods"][number]) => void;
}) {
  const at = periodAround(periods, range, today);
  const dates = `${fmtShort(range.from)} – ${fmtShort(range.to)}`;
  const title = at.exact && at.period
    ? `${at.period.name}${at.current ? " (This Pay Period)" : ""}`
    : dates;
  const sub = at.exact ? dates : at.period ? `Part of ${at.period.name}` : "Outside the pay periods";
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline" size="icon" className="h-11 w-11 shrink-0"
        disabled={!at.prev} onClick={() => at.prev && onGo(at.prev)}
        aria-label={at.prev ? `Previous pay period: ${at.prev.name}` : "No earlier pay period"}
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <div className="min-w-0 flex-1 text-center">
        <h2 className="text-lg font-semibold leading-tight sm:text-xl" aria-live="polite" data-testid="pay-period-title">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <Button
        variant="outline" size="icon" className="h-11 w-11 shrink-0"
        disabled={!at.next} onClick={() => at.next && onGo(at.next)}
        aria-label={at.next ? `Next pay period: ${at.next.name}` : "No later pay period"}
      >
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-figure text-xl tabular-nums">{value}</div>
      {note && <div className="text-2xs text-muted-foreground">{note}</div>}
    </CardContent></Card>
  );
}

function Row({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="font-figure tabular-nums">{value}</span>
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/**
 * The overtime shifts in the range: those worked, and those still booked. A booked shift
 * counts as worked once it has ended; the supervisor records only the exception (no-show,
 * sick, cancelled), and nothing here waits on anybody's approval (30/10/2026).
 */
function OvertimeShifts({ ot, boardAhead }: { ot: ReturnType<typeof summariseOvertimeShifts>; boardAhead: MyShift[] }) {
  const booked = [
    ...ot.booked.map((b) => ({ date: b.date, hours: b.hours, where: null as string | null })),
    ...boardAhead.map((b) => ({ date: b.date, hours: b.hours ?? "", where: "on the Headcount" })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (ot.worked.length === 0 && booked.length === 0) return null;
  const list = (xs: { date: string; hours: string; where?: string | null }[]) => (
    <ul className="mt-1 space-y-0.5 text-xs">
      {xs.map((x, i) => (
        <li key={`${x.date}-${x.hours}-${i}`} className="flex flex-wrap gap-x-2">
          <span className="font-medium">{fmtDay(x.date)}</span>
          {x.hours && <span className="tabular-nums text-muted-foreground">{x.hours}</span>}
          {x.where && <span className="text-muted-foreground">({x.where})</span>}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="rounded-md border px-3 py-2" data-testid="overtime-shifts">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">Overtime shifts worked</span>
        <span className="font-figure tabular-nums">{fmtHours(ot.workedMinutes / 60)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Your booked overtime that has taken place, at each shift's own hours. On a day the clock has no hours for yet, it counts in the overtime above.
      </p>
      {ot.worked.length > 0 && list(ot.worked)}
      {booked.length > 0 && (
        <>
          <p className="mt-2 text-xs font-medium">Booked ahead</p>
          {list(booked)}
        </>
      )}
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const fmtShort = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const monthOf = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short" });

function Calendar({ days, today, onPick, selected }: {
  days: MyDay[]; today: string; onPick: (d: MyDay) => void; selected: string | null;
}) {
  const lead = days.length ? ((new Date(`${days[0].date}T00:00:00Z`).getUTCDay() || 7) - 1) : 0;
  return (
    <div className="grid grid-cols-7 gap-1 text-center sm:gap-1.5">
      {WEEKDAYS.map((w, i) => (
        <div key={w} className={cn("pb-0.5 text-2xs font-medium text-muted-foreground", i >= 5 && "text-muted-foreground/70")}>{w}</div>
      ))}
      {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} />)}
      {days.map((d, i) => {
        const isToday = d.date === today;
        // The month is named where it starts, so "1" after "31" is never a puzzle.
        const month = i === 0 || d.date.endsWith("-01") ? monthOf(d.date) : null;
        return (
          <button
            key={d.date} type="button" onClick={() => onPick(d)}
            aria-label={`${fmtDay(d.date)}: ${STATUS[d.status].label}${d.overtime ? ", overtime" : ""}${d.pending ? ", pending approval" : ""}`}
            aria-current={isToday ? "date" : undefined}
            aria-pressed={selected === d.date}
            className={cn(
              "relative flex min-h-11 flex-col items-center justify-center rounded-md border text-xs transition-colors sm:min-h-14",
              "hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              d.date < today && d.status === "rest" && "opacity-60",
              d.overtime && d.status === "present" ? OVERTIME_CELL : STATUS[d.status].cell,
              isToday && "border-2 border-primary border-solid",
              selected === d.date && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
            )}
          >
            {month && <span className="text-[9px] font-semibold uppercase leading-none tracking-wide opacity-80">{month}</span>}
            <span className={cn("font-figure tabular-nums sm:text-sm", isToday && "font-bold text-primary")}>{Number(d.date.slice(8))}</span>
            {(d.overtime || d.pending || d.boardSays) && (
              <span className="flex gap-0.5 leading-none">
                {d.overtime && <span className="text-[9px] font-semibold">OT</span>}
                {d.pending && <span className="text-[9px] font-semibold">P</span>}
                {d.boardSays && <span className="text-[9px] font-semibold">!</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Only what this calendar shows: a key to colours that are not on screen is noise. */
function Legend({ days }: { days: MyDay[] }) {
  const shown = new Set(days.map((d) => d.status));
  const marks = [
    days.some((d) => d.overtime) && "OT = overtime on a present day",
    days.some((d) => d.pending) && "P = pending approval",
    days.some((d) => d.boardSays) && "! = the board planned something else",
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {(Object.keys(STATUS) as DayStatus[]).filter((k) => shown.has(k)).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("h-3 w-3 shrink-0 rounded-sm border", STATUS[k].cell, k === "rest" && "border-border")} />
            {STATUS[k].label}
          </li>
        ))}
        {days.some((d) => d.overtime && d.status === "present") && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className={cn("h-3 w-3 shrink-0 rounded-sm border", OVERTIME_CELL)} />
            Overtime
          </li>
        )}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm border-2 border-primary" />
          Today
        </li>
      </ul>
      {marks.length > 0 && <p>{marks.join(" · ")}</p>}
      <p>Tap a day to see its details.</p>
    </div>
  );
}

function DayDetail({ day, shifts }: { day: MyDay; shifts: MyShift[] }) {
  const c = day.clock;
  const src = day.source === "clock" ? "TimeMoto" : day.source === "mark" ? "Marked by the office" : day.source === "rota" ? "Your rota" : "Nothing on file";
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="day-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{fmtDay(day.date)}</span>
        <div className="flex gap-1">
          <Badge variant="outline">{day.label && day.status !== "present" ? day.label : STATUS[day.status].label}</Badge>
          {day.overtime && <Badge variant="outline">Overtime</Badge>}
          {day.pending && <Badge variant="outline">Pending approval</Badge>}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Source</dt><dd>{src}</dd>
        <dt className="text-muted-foreground">On your rota</dt><dd>{day.due ? "Yes" : "No"}</dd>
        {c && <>
          <dt className="text-muted-foreground">Clock in / out</dt><dd>{c.start_time ?? "—"} – {c.end_time ?? "—"}</dd>
          <dt className="text-muted-foreground">Worked</dt><dd>{fmtMin(c.worked_minutes)}</dd>
          <dt className="text-muted-foreground">Scheduled</dt><dd>{fmtMin(c.scheduled_minutes)}</dd>
          <dt className="text-muted-foreground">Balance</dt><dd>{fmtMin(c.balance_minutes)}</dd>
        </>}
        {day.board && <>
          <dt className="text-muted-foreground">Board planned</dt><dd className="flex flex-wrap items-center gap-1">{day.board.status}{day.board.half_day ? " (half day)" : ""} <ShiftTag shift={day.board.shift} /></dd>
        </>}
        {shifts.filter((sh) => !["holiday", "sick", "unpaid", "other"].includes(sh.kind)).map((sh, i) => (
          <span key={`wa-${i}`} className="contents">
            <dt className="text-muted-foreground">Work area{shifts.length > 1 ? ` (${sh.shift})` : ""}</dt>
            <dd>{areaText(sh)}{sh.hours ? ` · ${sh.hours}` : ""}</dd>
          </span>
        ))}
        {day.requests.map((r, i) => (
          <span key={i} className="contents">
            <dt className="text-muted-foreground">Leave request</dt>
            <dd>{r.kind}, {r.status}</dd>
          </span>
        ))}
      </dl>
      {day.workedOnLeave && (
        <p className="flex gap-1 text-xs text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0" />
          Booked as {day.label ?? "leave"}, but you clocked in and out. The hours count; the day stays leave on the record.</p>
      )}
      {day.boardSays && (
        <p className="flex gap-1 text-xs text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0" />
          The headcount board planned “{day.boardSays}” for this day. The record above is what was recorded; ask the office if it looks wrong.</p>
      )}
      {day.status === "no_record" && (
        <p className="flex gap-1 text-xs text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0" />
          Nothing has been recorded for this day yet. That usually means the clock data has not been imported — it is not counted as an absence.</p>
      )}
    </div>
  );
}
