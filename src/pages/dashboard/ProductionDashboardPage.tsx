import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import {
  Users, UserCheck, PlaneTakeoff, UserX, Clock3, HandCoins, Hourglass, CheckCircle2, Ban, Gauge,
  UsersRound, CalendarCheck, CalendarDays, FileBarChart, History, Factory, RefreshCw,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ControlPlate, ControlField } from "@/components/ui/ControlPlate";
import { DateField } from "@/components/ui/DateField";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/reports/KpiCard";
import { DateRangeFilter, getPresetRange, type DateRange, type DateRangePreset } from "@/components/DateRangeFilter";
import { ShiftFilter, type ShiftValue } from "@/components/ShiftFilter";
import { Panel, BarList, AlertList, QuickActions, NotYours, type AlertItem, type Shortcut } from "@/components/dashboards/DashboardParts";
import { TrendColumns } from "@/components/dashboards/TrendColumns";
import { useAuth } from "@/contexts/AuthContext";
import { can } from "@/lib/permissions";
import { currentShift } from "@/lib/operationalShift";
import { tallyBoard, boardTrend, type BoardTally } from "@/lib/boardTally";
import { foldTrainingArea, isTrainingArea } from "@/lib/headcountBlocks";
import { overtimeCoverage } from "@/lib/overtimeCoverage";
import { windowLabel, type OvertimeResponse } from "@/lib/overtimeRequests";
import { askShift } from "@/lib/overtimeShifts";
import { useShiftRoster, useAllocations, useHeadcountAreas, useBoardTrend } from "@/hooks/useHeadcount";
import { useOvertimeRequestsBetween, useOvertimeResponsesFor, useOvertimeOutcomesFor } from "@/hooks/useOvertimeRequests";
import { useReportSummary } from "@/hooks/useReportSummary";
import { useStoppedLinesCount } from "@/hooks/useStoppedLinesCount";
import { useQueryClient } from "@tanstack/react-query";
import { woListHref } from "@/lib/woListLink";

/**
 * Production's own dashboard: the people on the lines, the overtime asked for, and
 * what the lines made — each from the screen that owns it, by that screen's rules.
 *
 * Every section asks for its own permission, because each comes from a screen with
 * its own: the staffing figures are the Headcount board's (`headcount.view`), the
 * overtime is the overtime screen's (`overtime.manage`), the output is RAG Weekly's
 * (`rag.view`). Opening this page grants none of them — a manager who cannot open the
 * board does not read it here either, and the database's policies still decide every
 * row that comes back.
 */

type Shift = "Day" | "Night";
const SHIFTS: Shift[] = ["Day", "Night"];
const iso = (d: Date) => format(d, "yyyy-MM-dd");

const SHORTCUTS: Shortcut[] = [
  { label: "Headcount Board", to: "/dashboard/headcount", icon: UsersRound, action: "headcount.view" },
  { label: "Overtime", to: "/dashboard/overtime", icon: HandCoins, action: "overtime.manage" },
  { label: "Attendance", to: "/dashboard/attendance", icon: CalendarCheck, action: "workforce.view" },
  { label: "Leave", to: "/dashboard/leave", icon: CalendarDays, action: "workforce.view" },
  { label: "RAG Weekly", to: "/dashboard/rag-weekly", icon: Gauge, action: "rag.view" },
  { label: "Production Control", to: "/dashboard/shift-history", icon: History, action: "production.manage" },
  { label: "Reports", to: "/dashboard/reports", icon: FileBarChart, action: "reports.analytics" },
];

export default function ProductionDashboardPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const opened = useMemo(() => currentShift(), []);
  const [day, setDay] = useState(opened.operationalDate);
  const [range, setRange] = useState<DateRange>(() => getPresetRange("7d"));
  const [preset, setPreset] = useState<DateRangePreset>("7d");
  const [shift, setShift] = useState<ShiftValue>("ALL");

  const from = iso(range.from ?? parseISO(day));
  const to = iso(range.to ?? parseISO(day));
  const shifts: Shift[] = shift === "DAY" ? ["Day"] : shift === "NIGHT" ? ["Night"] : SHIFTS;

  const mayStaff = can(role, "headcount.view");
  const mayOvertime = can(role, "overtime.manage");
  const mayOutput = can(role, "rag.view");

  return (
    <DashboardLayout>
      <PageHeader
        module="Production"
        title="Production Dashboard"
        description="Who is on the lines, the overtime asked for, and what the lines made."
        icon={<Factory />}
      />

      {/* The two dates answer different questions, so they are two controls with their
          own labels: the board is one day; trends, overtime and output are a period.
          On a phone they sit in a two-column plate — day and period side by side, the
          shift full width under them with Refresh — instead of three stacked rows of
          different widths that took the first screen before a single figure. */}
      <ControlPlate className="mb-4 grid grid-cols-2 gap-x-3 gap-y-3 sm:flex">
        <ControlField label="Board day" className="min-w-0">
          <DateField value={day} onChange={(d) => d && setDay(d)} aria-label="Board day" className="w-full sm:w-[8.5rem]" />
        </ControlField>
        <ControlField label="Period" className="min-w-0">
          <DateRangeFilter value={range} preset={preset} onChange={(r, p) => { setRange(r); setPreset(p); }} className="h-10 w-full sm:w-auto" />
        </ControlField>
        <ControlField label="Shift" className="col-span-2 min-w-0 sm:col-span-1">
          <div className="flex items-center gap-2">
            <ShiftFilter value={shift} onChange={setShift} fill className="sm:w-auto" />
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0 sm:hidden"
              onClick={() => void qc.invalidateQueries()}
              aria-label="Refresh all figures"
              title="Refresh all figures"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </ControlField>
        <Button
          variant="outline"
          className="hidden h-10 gap-1.5 self-end sm:ml-auto sm:inline-flex"
          onClick={() => void qc.invalidateQueries()}
          aria-label="Refresh all figures"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </ControlPlate>

      <div className="space-y-6">
        <section aria-label="Needs attention">
          <Panel title="Needs attention" description="What somebody should look at now.">
            <div className="space-y-1">
              {mayStaff && <StaffingAlerts day={day} shifts={shifts} />}
              {mayOvertime && <OvertimeAlerts today={opened.operationalDate} />}
              <LineAlerts />
            </div>
          </Panel>
        </section>

        <section className="space-y-3" aria-labelledby="staffing-h">
          <SectionHeading><span id="staffing-h">Staffing — {format(parseISO(day), "EEE dd/MM")}</span></SectionHeading>
          {mayStaff
            ? <Staffing day={day} shifts={shifts} from={from} to={to} />
            : <NotYours what="Staffing" />}
        </section>

        <section className="space-y-3" aria-labelledby="ot-h">
          <SectionHeading><span id="ot-h">Overtime — {fmtRange(from, to)}</span></SectionHeading>
          {mayOvertime ? <Overtime from={from} to={to} shifts={shifts} /> : <NotYours what="Overtime" />}
        </section>

        <section className="space-y-3" aria-labelledby="out-h">
          <SectionHeading><span id="out-h">Output — {fmtRange(from, to)}</span></SectionHeading>
          {mayOutput ? <Output from={from} to={to} shift={shift} /> : <NotYours what="Output against plan" />}
        </section>

        <section className="space-y-3" aria-labelledby="qa-h">
          <SectionHeading><span id="qa-h">Go to</span></SectionHeading>
          <QuickActions items={SHORTCUTS} />
        </section>
      </div>
    </DashboardLayout>
  );
}

function fmtRange(from: string, to: string) {
  const f = format(parseISO(from), "dd/MM");
  const t = format(parseISO(to), "dd/MM");
  return f === t ? f : `${f} – ${t}`;
}

/** The Headcount board's own figures for one shift on one day. */
function useBoardTally(shift: Shift, day: string) {
  const { data: roster = [], boardById, isLoading: rl } = useShiftRoster(shift, day);
  const { data: allocations = [], isLoading: al, error } = useAllocations(day, shift);
  const { data: allAreas = [], isLoading: ar } = useHeadcountAreas();
  // The board reads the Training area as the Training column (`foldTrainingArea`), so
  // this reads it the same way — or the dashboard would count them on a line.
  const areas = useMemo(() => allAreas.filter((a) => !isTrainingArea(a)), [allAreas]);
  const tally = useMemo(
    () => tallyBoard({
      allocations: foldTrainingArea(allocations, allAreas), areas, roster, drawable: (id) => boardById.has(id),
    }),
    [allocations, allAreas, areas, roster, boardById],
  );
  return { tally, areas, isLoading: rl || al || ar, error };
}

function sumTallies(ts: BoardTally[]) {
  const s = { onRota: 0, working: 0, onLines: 0, support: 0, overtime: 0, training: 0, notPlaced: 0, sick: 0, holiday: 0, unpaid: 0, away: 0 };
  for (const t of ts) {
    s.onRota += t.onRota; s.working += t.working; s.onLines += t.onLines; s.support += t.support;
    s.overtime += t.overtime; s.training += t.training; s.notPlaced += t.notPlaced;
    s.sick += t.away.sick; s.holiday += t.away.holiday; s.unpaid += t.away.unpaid; s.away += t.away.total;
  }
  return s;
}

function Staffing({ day, shifts, from, to }: { day: string; shifts: Shift[]; from: string; to: string }) {
  const navigate = useNavigate();
  const dayBoard = useBoardTally("Day", day);
  const nightBoard = useBoardTally("Night", day);
  const boards = { Day: dayBoard, Night: nightBoard };
  const shown = shifts.map((s) => boards[s]);
  const loading = shown.some((b) => b.isLoading);
  const failed = shown.find((b) => b.error)?.error;
  const t = sumTallies(shown.map((b) => b.tally));
  const boardLink = (s?: Shift) => `/dashboard/headcount?date=${day}&shift=${s ?? (shifts.length === 1 ? shifts[0] : "Split")}`;

  const trend = useBoardTrend(from, to, true);
  const trendDays = useMemo(
    () => (trend.data ? boardTrend(trend.data.rows, from, to, trend.data.drawableOn) : []),
    [trend.data, from, to],
  );
  const absences = useMemo(() => {
    const sum = { sick: 0, holiday: 0, unpaid: 0, training: 0 };
    for (const d of trendDays) { sum.sick += d.sick; sum.holiday += d.holiday; sum.unpaid += d.unpaid; sum.training += d.training; }
    return [
      { label: "Sick", count: sum.sick },
      { label: "Holiday", count: sum.holiday },
      { label: "Unpaid absence", count: sum.unpaid },
      { label: "Training", count: sum.training, hint: "Here and paid — not counted as away" },
    ].filter((x) => x.count > 0);
  }, [trendDays]);

  if (failed) {
    return <Panel title="Staffing" error={failed}>{null}</Panel>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Due in" value={t.onRota} loading={loading} icon={<Users className="h-4 w-4" />}
          sublabel="On the rota for this day" accent="muted" onClick={() => navigate(boardLink())} />
        <KpiCard label="Working" value={t.working} loading={loading} icon={<UserCheck className="h-4 w-4" />}
          sublabel={`${t.onLines} on lines · ${t.support} support`} accent="info" onClick={() => navigate(boardLink())} />
        <KpiCard label="Away" value={t.away} loading={loading} icon={<PlaneTakeoff className="h-4 w-4" />}
          sublabel={`${t.sick} sick · ${t.holiday} holiday · ${t.unpaid} unpaid`}
          accent={t.away ? "warning" : "ok"} toneValue onClick={() => navigate(boardLink())} />
        <KpiCard label="Not placed" value={t.notPlaced} loading={loading} icon={<UserX className="h-4 w-4" />}
          sublabel="Due in, on no row of the board" accent={t.notPlaced ? "warning" : "ok"} toneValue
          onClick={() => navigate(boardLink())} />
        <KpiCard label="On overtime" value={t.overtime} loading={loading} icon={<Clock3 className="h-4 w-4" />}
          sublabel="People on an overtime row" accent="purple" onClick={() => navigate(boardLink())} />
        <KpiCard label="Training" value={t.training} loading={loading} icon={<CheckCircle2 className="h-4 w-4" />}
          sublabel="Here, not on a line" accent="muted" onClick={() => navigate(boardLink())} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Day against night" description="Working / due in, per board." loading={loading} to={boardLink("Day")} toLabel="Board">
          <BarList
            empty="Nobody is due in on either board."
            items={shifts.map((s) => ({
              label: `${s} shift`,
              count: boards[s].tally.working,
              hint: `${boards[s].tally.working} of ${boards[s].tally.onRota} due in working · ${boards[s].tally.away.total} away · ${boards[s].tally.notPlaced} not placed`,
              to: boardLink(s),
            }))}
          />
        </Panel>
        <AreaTable boards={boards} shifts={shifts} loading={loading} day={day} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="People working each day" description={`${fmtRange(from, to)}, both shifts`}
          loading={trend.isLoading} error={trend.error} onRetry={() => void trend.refetch()}>
          <TrendColumns
            title="People working each day"
            unit="working"
            points={trendDays.map((d) => ({
              on_date: d.on_date,
              value: d.working,
              detail: [`${d.overtime} on overtime`, `${d.sick + d.holiday + d.unpaid} away`],
            }))}
          />
        </Panel>
        <Panel title="Absence in the period" description="Person-days marked on the boards." loading={trend.isLoading}
          error={trend.error} onRetry={() => void trend.refetch()} to="/dashboard/attendance" toLabel="Attendance">
          <BarList items={absences} empty="No absence marked on the boards in this period." unit={(n) => `${n} day${n === 1 ? "" : "s"}`} />
        </Panel>
      </div>
    </div>
  );
}

function AreaTable({ boards, shifts, loading, day }: {
  boards: Record<Shift, ReturnType<typeof useBoardTally>>; shifts: Shift[]; loading: boolean; day: string;
}) {
  const areas = boards.Day.areas;
  const rows = areas
    .map((a) => ({
      area: a,
      cells: shifts.map((s) => boards[s].tally.byArea.get(a.id) ?? { working: 0, overtime: 0 }),
    }))
    .filter((r) => r.cells.some((c) => c.working + c.overtime > 0));
  return (
    <Panel title="Headcount by line and area" description="Working (+ overtime) per board column." loading={loading}
      to={`/dashboard/headcount?date=${day}&shift=Split`} toLabel="Board">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody is placed on a line or area on this day.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-medium">Area</th>
                {shifts.map((s) => <th key={s} className="py-1 text-right font-medium">{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ area, cells }) => (
                <tr key={area.id} className="border-t">
                  <td className="py-1 pr-2">
                    {area.name}
                    {area.kind !== "production" && <span className="ml-1 text-xs text-muted-foreground">support</span>}
                  </td>
                  {cells.map((c, i) => (
                    <td key={shifts[i]} className="py-1 text-right">
                      {c.working}{c.overtime > 0 && <span className="text-xs text-muted-foreground"> +{c.overtime} OT</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function useCoverage(from: string, to: string) {
  const asks = useOvertimeRequestsBetween(from, to);
  const ids = useMemo(() => (asks.data ?? []).map((r) => r.id), [asks.data]);
  const responses = useOvertimeResponsesFor(ids);
  const responseIds = useMemo(() => (responses.data ?? []).map((r) => r.id), [responses.data]);
  const outcomes = useOvertimeOutcomesFor(responseIds);
  const coverage = useMemo(() => {
    const byRequest = new Map<string, OvertimeResponse[]>();
    for (const r of responses.data ?? []) byRequest.set(r.request_id, [...(byRequest.get(r.request_id) ?? []), r]);
    const outcomeById = new Map((outcomes.data ?? []).map((o) => [o.response_id, o.outcome as string]));
    return overtimeCoverage(asks.data ?? [], byRequest, (id) => outcomeById.get(id));
  }, [asks.data, responses.data, outcomes.data]);
  return {
    coverage,
    isLoading: asks.isLoading || (ids.length > 0 && responses.isLoading),
    error: asks.error ?? responses.error,
    refetch: () => void asks.refetch(),
  };
}

function Overtime({ from, to, shifts }: { from: string; to: string; shifts: Shift[] }) {
  const navigate = useNavigate();
  const { coverage: c, isLoading, error, refetch } = useCoverage(from, to);
  if (error) return <Panel title="Overtime" error={error} onRetry={refetch}>{null}</Panel>;
  const go = () => navigate("/dashboard/overtime");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="People booked" value={c.booked} loading={isLoading}
          icon={<HandCoins className="h-4 w-4" />} sublabel={`On ${c.asks} ask${c.asks === 1 ? "" : "s"}`} accent="info" onClick={go} />
        <KpiCard label="Nobody yet" value={c.unfilled.length} loading={isLoading} icon={<Hourglass className="h-4 w-4" />}
          sublabel={c.stillToFill ? `Open asks still short · ${c.stillToFill} numbered places free` : "Open asks nobody has said yes to"}
          accent={c.unfilled.length ? "warning" : "ok"} toneValue onClick={go} />
        <KpiCard label="Awaiting a decision" value={c.awaitingDecision} loading={isLoading} icon={<Users className="h-4 w-4" />}
          sublabel="Said yes, nobody has accepted or declined" accent={c.awaitingDecision ? "warning" : "muted"} toneValue onClick={go} />
        <KpiCard label="Worked" value={c.worked} loading={isLoading} icon={<CheckCircle2 className="h-4 w-4" />}
          sublabel="Marked as attended" accent="ok" onClick={go} />
        <KpiCard label="Cancelled" value={c.cancelled} loading={isLoading} icon={<Ban className="h-4 w-4" />}
          sublabel="Asks called off" accent="muted" onClick={go} />
      </div>
      <Panel title="Booked by shift" description="People booked on overtime, by the board it lands on." loading={isLoading} to="/dashboard/overtime" toLabel="Overtime">
        <BarList
          empty="Nobody is booked on overtime in this period."
          items={shifts.filter((s) => c.byShift[s].booked > 0).map((s) => ({
            label: `${s} shift`,
            count: c.byShift[s].booked,
            hint: c.byShift[s].wanted > 0 ? `${c.byShift[s].filled} of ${c.byShift[s].wanted} numbered places filled` : undefined,
          }))}
        />
      </Panel>
    </div>
  );
}

function Output({ from, to, shift }: { from: string; to: string; shift: ShiftValue }) {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useReportSummary(from, to, shift);
  if (error) return <Panel title="Output" error={error} onRetry={() => void refetch()}>{null}</Panel>;
  const p = data?.production;
  const empty = !isLoading && p && p.plan === 0 && p.actual === 0;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <KpiCard label="Made against plan" loading={isLoading} icon={<Gauge className="h-4 w-4" />}
        value={p?.efficiencyPct == null ? "—" : `${p.efficiencyPct}%`}
        sublabel={empty ? "Nothing entered in RAG Weekly for this period" : `${(p?.actual ?? 0).toLocaleString()} of ${(p?.plan ?? 0).toLocaleString()} planned`}
        accent={p?.efficiencyPct == null ? "muted" : p.efficiencyPct >= 95 ? "ok" : p.efficiencyPct >= 85 ? "warning" : "danger"}
        toneValue onClick={() => navigate("/dashboard/rag-weekly")} />
      <KpiCard label="Days with entries" loading={isLoading} icon={<CalendarDays className="h-4 w-4" />}
        value={p?.days ?? 0} sublabel="Days RAG Weekly has a plan or an actual for" accent="muted"
        onClick={() => navigate("/dashboard/rag-weekly")} />
    </div>
  );
}

function StaffingAlerts({ day, shifts }: { day: string; shifts: Shift[] }) {
  const today = useBoardTally("Day", day);
  const tonight = useBoardTally("Night", day);
  const next = iso(addDays(parseISO(day), 1));
  const tomorrowDay = useBoardTally("Day", next);
  const tomorrowNight = useBoardTally("Night", next);
  const boards = { Day: today, Night: tonight };
  const tomorrow = { Day: tomorrowDay, Night: tomorrowNight };
  const items: AlertItem[] = [];
  for (const s of shifts) {
    const t = boards[s].tally;
    if (boards[s].isLoading) continue;
    if (t.notPlaced > 0) {
      items.push({ tone: "hold", text: `${s}: ${t.notPlaced} due in and not placed`,
        detail: `${t.working} of ${t.onRota} working on ${format(parseISO(day), "EEE dd/MM")}`, to: `/dashboard/headcount?date=${day}&shift=${s}` });
    }
    const unplanned = t.away.sick + t.away.unpaid;
    if (unplanned > 0) {
      items.push({ tone: "hold", text: `${s}: ${unplanned} off sick or unpaid`,
        detail: "Absences nobody booked ahead", to: `/dashboard/headcount?date=${day}&shift=${s}` });
    }
    const tm = tomorrow[s].tally;
    if (!tomorrow[s].isLoading && tm.onRota > 0 && tm.working + tm.away.total + tm.training < tm.onRota) {
      items.push({ tone: "info", text: `${s} tomorrow: ${tm.working} of ${tm.onRota} due in are placed`,
        to: `/dashboard/headcount?date=${next}&shift=${s}` });
    }
  }
  return <AlertList items={items} clear="Every board for this day is planned, with no unbooked absence." />;
}

function OvertimeAlerts({ today }: { today: string }) {
  const { coverage, isLoading } = useCoverage(today, iso(addDays(parseISO(today), 7)));
  if (isLoading) return null;
  const items: AlertItem[] = coverage.unfilled.slice(0, 5).map(({ request: r, left }) => ({
    tone: "hold",
    text: left == null
      ? `Nobody has said yes yet — ${format(parseISO(r.on_date), "EEE dd/MM")}, ${askShift(r)}`
      : `${left} overtime place${left === 1 ? "" : "s"} to fill — ${format(parseISO(r.on_date), "EEE dd/MM")}, ${askShift(r)}`,
    detail: windowLabel(r.starts_at, r.ends_at),
    to: "/dashboard/overtime",
  }));
  return <AlertList items={items} clear="Every overtime ask in the next 7 days has somebody booked." />;
}

function LineAlerts() {
  const { role } = useAuth();
  const { data: stopped } = useStoppedLinesCount();
  // The count is only read for the roles the hook serves; for anyone else it is unknown,
  // and unknown is said by saying nothing rather than by a zero.
  if (stopped === undefined || !can(role, "wo.view")) return null;
  const items: AlertItem[] = stopped > 0
    ? [{ tone: "stop", text: `${stopped} line${stopped === 1 ? "" : "s"} stopped, waiting on maintenance`,
        to: woListHref({ status: "active", range: "all" }) }]
    : [];
  return <AlertList items={items} clear="No line is stopped waiting on maintenance." />;
}
