import { announceSummary } from "@/lib/overtimeAnnounce";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/DateField";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { Figure } from "@/components/ui/Figure";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Plus, Check, Clock, X, UserPlus, Loader2, Pencil, AlertTriangle, Ban, Sun, Moon, RotateCcw, CalendarDays, List,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { can } from "@/lib/permissions";
import {
  useOvertimeRequests, useOvertimeResponsesFor, useOvertimeOutcomesFor, useOvertimeReliability,
  useOvertimeMutations, useOvertimeRoster, useOvertimeBoardRows, useOvertimeScheduleClashes, type RosterName,
  useOvertimeRequestsBetween, asksOnDates,
} from "@/hooks/useOvertimeRequests";
import {
  countResponses, sortCandidates, reliabilityTone, reliabilityLabel, attendedLabel, blockedLabel,
  windowLabel, audienceLine, deskCandidates, type OvertimeRequest, type OvertimeResponse,
  type OvertimeOutcome, type Candidate, type Reliability, hoursBetween, placesTaken,
} from "@/lib/overtimeRequests";
import {
  askShift, askState, ASK_STATE_LABEL, summarise, filterAsks, clashesFor, boardDatesFor, duplicateNames,
  hoursLabel, DEFAULT_FILTERS, OVERTIME_SHIFTS,
  type OvertimeShift, type AskFilters, type AskState, type BoardRow, type Clash, type ShiftSummary,
} from "@/lib/overtimeShifts";
import { ShiftTag } from "@/components/ShiftTag";
import { shiftCard } from "@/lib/shiftLook";
import { OvertimeRulesDialog } from "@/components/workforce/OvertimeRulesDialog";
import { answeredForDifferentHours, countStale, windowAnswered } from "@/lib/staleOvertimeAnswer";
import { OvertimeCalendar, TOGGLE_ON } from "@/components/workforce/OvertimeCalendar";
import { viewRange, viewTitle, duplicateOf, type CalendarView } from "@/lib/overtimeCalendar";

const fmtDate = (d: string) => d.split("-").reverse().join("/");
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const TONE_CLASS = {
  good: "bg-success/15 text-success border-success/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  bad: "bg-destructive/15 text-destructive border-destructive/30",
} as const;

const OUTCOMES: { value: OvertimeOutcome; label: string }[] = [
  { value: "attended", label: "Turned up" },
  { value: "called_sick", label: "Called sick" },
  { value: "no_show", label: "No show" },
  // One "Cancelled": the clock and the rule decide whether it was in time or late.
  { value: "cancelled", label: "Cancelled" },
];
// What the database stored, when it was one of the two it decides between.
const STORED_LABEL: Record<string, string> = {
  cancelled_in_time: "Cancelled in time", cancelled_late: "Cancelled late",
};

/** StatusBadge's palette, one restrained colour per state. */
const STATE_BADGE: Record<AskState, string> = {
  open: "warning", filled: "success", closed: "default", cancelled: "cancelled",
};

const SHIFT_ICON: Record<OvertimeShift, typeof Sun> = { Day: Sun, Night: Moon };
const SHIFT_HOURS: Record<OvertimeShift, { starts: string; ends: string }> = {
  Day: { starts: "06:00", ends: "18:00" }, Night: { starts: "18:00", ends: "06:00" },
};

const OVERTIME_LENGTHS = [8, 12] as const;
type OvertimeLength = (typeof OVERTIME_LENGTHS)[number];

/** The 8-hour windows, on the same two shift buttons as the 12-hour ones. */
const SHIFT_HOURS_8: Record<OvertimeShift, { starts: string; ends: string }> = {
  Day: { starts: "06:00", ends: "14:00" }, Night: { starts: "18:00", ends: "02:00" },
};

const RANGE_LABEL: Record<AskFilters["range"], string> = {
  upcoming: "Upcoming", today: "Today", tomorrow: "Tomorrow", next7: "Next 7 days",
  past14: "Past 14 days", date: "Pick a date…",
};

type ShiftTab = "all" | OvertimeShift;
type Mode = "calendar" | "list";

/** Calendar or list, remembered per browser. A convenience only: unreadable storage means calendar. */
const MODE_KEY = "overtime.mode";
const readMode = (): Mode => {
  try { return window.localStorage.getItem(MODE_KEY) === "list" ? "list" : "calendar"; } catch { return "calendar"; }
};
const saveMode = (m: Mode) => { try { window.localStorage.setItem(MODE_KEY, m); } catch { /* not kept */ } };

/**
 * Overtime Management: ask, choose, then say what happened — split by the shift the
 * overtime is for.
 *
 * The shift comes from the ask's hours (`askShift`), which is the same rule the
 * database uses to put an accepted answer on the board. The person's own crew is shown
 * beside their name and never moves the ask: a day-crew packer on a night ask is
 * night overtime.
 *
 * The rows still carry the number beside the name that this module exists to show —
 * how many times this month the person did not turn up — and, now, anything on the
 * board that stands in the way of the ask: already rostered on that shift, on holiday,
 * or no rest either side.
 */
export function OvertimeRequestsPanel() {
  const { role } = useAuth();
  const mayManage = can(role, "overtime.manage");
  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => { setModeState(m); saveMode(m); };
  const [calView, setCalView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(() => iso(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOn, setCreateOn] = useState<string | null>(null);
  const range = viewRange(calView, anchor);
  // The list keeps its own read (today on, plus fourteen days back); the calendar
  // reads whatever dates it is showing. Only the one on screen is fetched.
  const listQuery = useOvertimeRequests();
  const calQuery = useOvertimeRequestsBetween(range.from, range.to, mode === "calendar");
  const { data: requests = [], isLoading, isError, error, refetch } = mode === "calendar" ? calQuery : listQuery;
  const { data: roster = [] } = useOvertimeRoster();
  const { data: reliability } = useOvertimeReliability();
  const { data: responses = [], isLoading: responsesLoading } = useOvertimeResponsesFor(requests.map((r) => r.id));
  const chosenIds = responses.filter((r) => r.decision === "accepted" || r.decision === "reserve").map((r) => r.id);
  const { data: outcomes = [] } = useOvertimeOutcomesFor(chosenIds);

  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState<AskFilters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<ShiftTab>("all");
  const today = iso(new Date());

  const responsesByRequest = useMemo(() => {
    const m = new Map<string, OvertimeResponse[]>();
    for (const r of responses) m.set(r.request_id, [...(m.get(r.request_id) ?? []), r]);
    return m;
  }, [responses]);
  const outcomeByResponse = useMemo(
    () => new Map(outcomes.map((o) => [o.response_id, o.outcome])),
    [outcomes],
  );
  const outcomeOf = useCallback((id: string) => outcomeByResponse.get(id), [outcomeByResponse]);

  // On the calendar the dates are the calendar's; the date filter is the list's.
  const filtered = useMemo(
    () => filterAsks(requests, responsesByRequest,
      mode === "calendar" ? { ...filters, range: "date", date: "" } : filters, today),
    [requests, responsesByRequest, filters, today, mode],
  );
  const byShift = useMemo(() => {
    const m: Record<OvertimeShift, OvertimeRequest[]> = { Day: [], Night: [] };
    for (const r of filtered) m[askShift(r)].push(r);
    return m;
  }, [filtered]);

  const total = summarise(filtered, responsesByRequest, outcomeByResponse);
  const perShift: Record<OvertimeShift, ShiftSummary> = {
    Day: summarise(byShift.Day, responsesByRequest, outcomeByResponse),
    Night: summarise(byShift.Night, responsesByRequest, outcomeByResponse),
  };
  const summaryShown = tab === "all" ? total : perShift[tab];

  const { data: board = [] } = useOvertimeBoardRows(boardDatesFor(filtered));
  const { data: schedule } = useOvertimeScheduleClashes(filtered.map((r) => r.id));
  const others = useMemo(
    () => requests.map((r) => ({ request: r, responses: responsesByRequest.get(r.id) ?? [] })),
    [requests, responsesByRequest],
  );
  const departments = useMemo(() => Array.from(new Set([
    ...roster.map((e) => e.department), ...requests.map((r) => r.department),
  ].filter(Boolean) as string[])).sort(), [roster, requests]);

  const dupNames = useMemo(() => duplicateNames(roster), [roster]);

  const filtersChanged = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const rangeLabel = mode === "calendar"
    ? viewTitle(calView, anchor)
    : filters.range === "date"
      ? (filters.date ? fmtDate(filters.date) : "Any date")
      : RANGE_LABEL[filters.range];
  const selected = selectedId ? requests.find((r) => r.id === selectedId) ?? null : null;
  const calendarAsks = tab === "all" ? filtered : byShift[tab];
  const loading = isLoading || (requests.length > 0 && responsesLoading);

  const ctx: CardContext = {
    roster, reliability, outcomeByResponse, responsesByRequest, others, board, schedule, dupNames,
  };

  return (
    <div className="space-y-4">
      <ModuleHeader
        title="Overtime Management"
        description="Manage overtime requests, approvals and shift coverage."
      >
        {mayManage && (
          <Button size="sm" variant="secondary" onClick={() => { setCreateOn(null); setCreating(true); }}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">New overtime ask</span><span className="sm:hidden">New ask</span>
          </Button>
        )}
      </ModuleHeader>

      {/* The four counts, each over a different kind of row so none is counted twice:
          asks, undecided answers, accepted answers, and the hours of those. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure lead label="Awaiting decision" value={String(summaryShown.awaitingDecision)}
          unit={summaryShown.awaitingDecision === 1 ? "answer" : "answers"}
          tone={summaryShown.awaitingDecision > 0 ? "owed" : "neutral"}
          hint="Said yes, nobody has accepted or declined them yet" />
        <Figure label="Asks needing people" value={String(summaryShown.needsPeople)}
          hint="Open, with places still to fill" />
        <Figure label="Confirmed" value={String(summaryShown.confirmed)}
          unit={summaryShown.confirmed === 1 ? "person" : "people"}
          hint="Accepted and not dropped out" />
        <Figure label="Scheduled overtime" value={hoursLabel(summaryShown.scheduledMinutes)}
          hint={`${tab === "all" ? "Both shifts" : `${tab} shift`} · ${rangeLabel.toLowerCase()}`} />
      </div>

      {/* Filters. Compact, one row on a desk, wrapping on a phone. */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3" role="group" aria-label="Filters">
        <div className="grid gap-1">
          <span className="text-2xs uppercase tracking-wider text-muted-foreground">View</span>
          <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as Mode)}
            variant="outline" size="sm" aria-label="Calendar or list">
            <ToggleGroupItem value="calendar" className={cn("h-9 gap-1.5", TOGGLE_ON)}><CalendarDays className="h-4 w-4" aria-hidden />Calendar</ToggleGroupItem>
            <ToggleGroupItem value="list" className={cn("h-9 gap-1.5", TOGGLE_ON)}><List className="h-4 w-4" aria-hidden />List</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {mode === "list" && (<>
        <div className="grid gap-1">
          <Label htmlFor="ot-f-range" className="text-2xs uppercase tracking-wider text-muted-foreground">Date</Label>
          <Select value={filters.range} onValueChange={(v) => setFilters((f) => ({ ...f, range: v as AskFilters["range"] }))}>
            <SelectTrigger id="ot-f-range" className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(RANGE_LABEL) as AskFilters["range"][]).map((k) => (
                <SelectItem key={k} value={k}>{RANGE_LABEL[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filters.range === "date" && (
          <div className="grid gap-1">
            <Label className="text-2xs uppercase tracking-wider text-muted-foreground">On</Label>
            <DateField value={filters.date} onChange={(d) => setFilters((f) => ({ ...f, date: d }))} aria-label="Overtime date" />
          </div>
        )}
        </>)}
        <div className="grid gap-1">
          <Label htmlFor="ot-f-state" className="text-2xs uppercase tracking-wider text-muted-foreground">Status</Label>
          <Select value={filters.state} onValueChange={(v) => setFilters((f) => ({ ...f, state: v as AskFilters["state"] }))}>
            <SelectTrigger id="ot-f-state" className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(ASK_STATE_LABEL) as AskState[]).map((s) => (
                <SelectItem key={s} value={s}>{ASK_STATE_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ot-f-dept" className="text-2xs uppercase tracking-wider text-muted-foreground">Department</Label>
          <Select value={filters.department} onValueChange={(v) => setFilters((f) => ({ ...f, department: v }))}>
            <SelectTrigger id="ot-f-dept" className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {filtersChanged && (
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setFilters(DEFAULT_FILTERS)}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
          </Button>
        )}
        <div className="ml-auto">{mayManage && <OvertimeRulesDialog />}</div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ShiftTab)}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-auto" aria-label="Shift">
          <TabsTrigger value="all">All shifts</TabsTrigger>
          {OVERTIME_SHIFTS.map((s) => {
            const Icon = SHIFT_ICON[s];
            const pending = perShift[s].awaitingDecision + perShift[s].needsPeople;
            return (
              <TabsTrigger key={s} value={s} className="gap-1.5">
                <Icon className="h-4 w-4" aria-hidden /> {s} shift
                {pending > 0 && (
                  <span className="rounded-full bg-warning/15 px-1.5 text-2xs font-semibold tabular-nums text-warning-strong"
                    aria-label={`${pending} pending`}>
                    {pending}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {isError ? (
        <Card><CardContent className="flex flex-wrap items-center justify-between gap-2 py-6 text-sm">
          <span className="text-destructive">Could not load overtime: {(error as Error)?.message ?? "unknown error"}</span>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button>
        </CardContent></Card>
      ) : loading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl border bg-muted/40" />)}
        </div>
      ) : mode === "calendar" ? (
        <OvertimeCalendar
          view={calView} anchor={anchor} onViewChange={setCalView} onAnchorChange={setAnchor}
          asks={calendarAsks} responsesByRequest={responsesByRequest} mayManage={mayManage}
          outcomeOf={outcomeOf}
          onSelect={setSelectedId}
          onCreate={(d) => { setCreateOn(d); setCreating(true); }}
        />
      ) : (
        (tab === "all" ? OVERTIME_SHIFTS : [tab]).map((s) => (
          <ShiftSection
            key={s} shift={s} asks={byShift[s]} summary={perShift[s]} rangeLabel={rangeLabel}
            ctx={ctx} mayManage={mayManage}
            onCreate={() => { setTab(s); setCreateOn(null); setCreating(true); }}
          />
        ))
      )}

      {/* The calendar's detail: the same card the list shows, with every decision on it. */}
      <Sheet open={selected !== null} onOpenChange={(v) => { if (!v) setSelectedId(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="mb-3">
            <SheetTitle>Overtime ask</SheetTitle>
            <SheetDescription>Who said yes, who is picked, and what is still to fill.</SheetDescription>
          </SheetHeader>
          {selected && <RequestCard request={selected} ctx={ctx} mayManage={mayManage} />}
        </SheetContent>
      </Sheet>

      <NewRequestDialog
        open={creating} onOpenChange={setCreating}
        defaultShift={tab === "all" ? "Day" : tab} defaultDate={createOn} roster={roster}
      />
    </div>
  );
}

interface CardContext {
  roster: RosterName[];
  reliability: Map<string, Reliability> | undefined;
  outcomeByResponse: Map<string, OvertimeOutcome>;
  responsesByRequest: Map<string, OvertimeResponse[]>;
  others: { request: OvertimeRequest; responses: OvertimeResponse[] }[];
  board: BoardRow[];
  /** The database's reading of each person's own hours, by `scheduleClashKey`. */
  schedule: Map<string, string> | undefined;
  dupNames: Set<string>;
}

function ShiftSection({ shift, asks, summary, rangeLabel, ctx, mayManage, onCreate }: {
  shift: OvertimeShift; asks: OvertimeRequest[]; summary: ShiftSummary; rangeLabel: string;
  ctx: CardContext; mayManage: boolean; onCreate: () => void;
}) {
  const Icon = SHIFT_ICON[shift];
  const headingId = `ot-shift-${shift}`;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
        <h2 id={headingId} className="flex items-center gap-2 font-display text-lg font-semibold">
          <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
          {shift} shift
          <span className="text-sm font-normal text-muted-foreground">
            {SHIFT_HOURS[shift].starts}–{SHIFT_HOURS[shift].ends} · {rangeLabel}
          </span>
        </h2>
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
          <span><strong className="text-foreground">{summary.needsPeople}</strong> needing people</span>
          <span><strong className="text-foreground">{summary.awaitingDecision}</strong> awaiting decision</span>
          <span><strong className="text-foreground">{summary.confirmed}</strong> confirmed · {hoursLabel(summary.scheduledMinutes)}</span>
        </div>
      </div>
      {asks.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          <span>No {shift.toLowerCase()}-shift overtime for {rangeLabel.toLowerCase()} with these filters.</span>
          {mayManage && (
            <Button size="sm" variant="outline" onClick={onCreate}>
              <Plus className="mr-1 h-4 w-4" /> Ask for {shift.toLowerCase()} shift
            </Button>
          )}
        </div>
      ) : (
        asks.map((r) => <RequestCard key={r.id} request={r} ctx={ctx} mayManage={mayManage} />)
      )}
    </section>
  );
}

function NewRequestDialog({ open, onOpenChange, defaultShift, defaultDate, roster }: {
  open: boolean; onOpenChange: (v: boolean) => void; defaultShift: OvertimeShift;
  /** The day pressed on the calendar, or null for tomorrow. */
  defaultDate: string | null; roster: RosterName[];
}) {
  const { createRequest } = useOvertimeMutations();
  const [onDate, setOnDate] = useState(iso(new Date(Date.now() + 86_400_000)));
  const [startsAt, setStartsAt] = useState(SHIFT_HOURS[defaultShift].starts);
  const [endsAt, setEndsAt] = useState(SHIFT_HOURS[defaultShift].ends);
  /** 12 keeps the two shift presets exactly as before; 8 takes any start time and ends 8 h later. */
  const [length, setLength] = useState<OvertimeLength>(12);
  /** Optional. Empty: every yes is booked. A number: the first that many, then reserve. */
  const [headcount, setHeadcount] = useState("");
  const [department, setDepartment] = useState<string>("all");
  const [shiftGroup, setShiftGroup] = useState<string>("all");
  const [note, setNote] = useState("");
  const [seenDefault, setSeenDefault] = useState<string | null>(null);
  /** More dates with the same hours and people — one ask each. */
  const [extraDates, setExtraDates] = useState<string[]>([]);
  const [pickDate, setPickDate] = useState("");
  /** The review before several asks go out: each date, and any duplicate found. */
  const [review, setReview] = useState<{ date: string; duplicate: boolean }[] | null>(null);
  const [publishing, setPublishing] = useState(false);

  // Opening from the Night tab starts on the night's hours, and from a calendar day on
  // that day. Only on opening: once the supervisor has typed a time, switching tabs
  // behind the dialog must not undo it.
  const openKey = `${defaultShift}|${defaultDate ?? ""}`;
  if (open && seenDefault !== openKey) {
    setSeenDefault(openKey);
    setStartsAt(SHIFT_HOURS[defaultShift].starts);
    setEndsAt(SHIFT_HOURS[defaultShift].ends);
    if (defaultDate) setOnDate(defaultDate);
    setExtraDates([]); setReview(null);
  }
  if (!open && seenDefault !== null) setSeenDefault(null);

  const departments = useMemo(
    () => Array.from(new Set(roster.map((e) => e.department).filter(Boolean) as string[])).sort(),
    [roster],
  );
  const shiftGroups = useMemo(
    () => Array.from(new Set(roster.map((e) => e.shift_group).filter(Boolean) as string[])).sort(),
    [roster],
  );
  const target = /^\d{2}:\d{2}/.test(startsAt) ? askShift({ starts_at: startsAt }) : null;
  const today = iso(new Date());
  const allDates = Array.from(new Set([onDate, ...extraDates].filter(Boolean))).sort();

  const payload = (date: string) => ({
    // No number: the ask books everybody who says yes (BLOCO 102).
    on_date: date, starts_at: startsAt, ends_at: endsAt, headcount: headcount.trim() ? Number(headcount) : null,
    department: department === "all" ? null : department,
    shift_group: shiftGroup === "all" ? null : shiftGroup,
    note: note.trim() || null,
  });

  const validate = (): boolean => {
    if (!onDate) { toast.error("Pick a date."); return false; }
    if (allDates.some((d) => d < today)) { toast.error("Overtime cannot be asked for a day that has passed."); return false; }
    if (headcount.trim() && (!Number.isInteger(Number(headcount)) || Number(headcount) <= 0)) {
      toast.error("People needed: leave it empty, or a whole number above zero."); return false;
    }
    if (startsAt === endsAt) { toast.error("Start and end cannot be the same time."); return false; }
    return true;
  };

  /** Always show the summary first: the wrong date or shift is the mistake this form exists to stop. */
  const submit = () => {
    if (!validate()) return;
    void prepareReview();
  };

  /** Read what is already on those dates, fresh, and show the list before anything is written. */
  const prepareReview = async () => {
    try {
      const existing = await asksOnDates(allDates);
      setReview(allDates.map((date) => ({
        date,
        duplicate: duplicateOf({ on_date: date, starts_at: startsAt, ends_at: endsAt,
          department: department === "all" ? null : department }, existing) !== null,
      })));
    } catch (e) {
      toast.error((e as Error).message || "Could not check the dates");
    }
  };

  /**
   * One ask per date, one after another, skipping the duplicates. Each is its own
   * write with its own announcement — the same path a single ask takes — so a
   * failure part-way says which dates went out and which did not.
   */
  const publishAll = async () => {
    if (!review) return;
    setPublishing(true);
    const done: string[] = []; const failed: string[] = [];
    let lastPush: Awaited<ReturnType<typeof createRequest.mutateAsync>>["push"] | undefined;
    for (const row of review) {
      if (row.duplicate) continue;
      try { lastPush = (await createRequest.mutateAsync(payload(row.date))).push; done.push(row.date); }
      catch { failed.push(row.date); }
    }
    setPublishing(false);
    const skipped = review.filter((r) => r.duplicate).length;
    if (done.length === 1 && !failed.length && !skipped) {
      // One ask: say only what is known about the phone alert, as a single ask always has.
      const { tone, text } = announceSummary(`Published for ${fmtDate(done[0])}`, lastPush);
      (tone === "warning" ? toast.warning : toast.success)(text, { duration: 8000 });
      onOpenChange(false); setNote(""); setExtraDates([]); setReview(null);
      return;
    }
    const parts = [`Published ${done.length} ${done.length === 1 ? "ask" : "asks"}`];
    if (skipped) parts.push(`${skipped} skipped as duplicates`);
    if (failed.length) parts.push(`failed: ${failed.map(fmtDate).join(", ")}`);
    (failed.length ? toast.error : toast.success)(parts.join(" · "), { duration: 10000 });
    if (!failed.length) { onOpenChange(false); setNote(""); setExtraDates([]); setReview(null); }
    else setReview(review.filter((r) => failed.includes(r.date)).map((r) => ({ ...r, duplicate: false })));
  };

  const toPublish = review?.filter((r) => !r.duplicate).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{review ? "Review before publishing" : "New overtime ask"}</DialogTitle>
          <DialogDescription>
            {review
              ? "Each date becomes its own ask, and everyone it applies to is told. Nothing is published until you confirm."
              : "Say when. Everyone it applies to will see it. Whoever says yes is booked, and you get an alert."}
          </DialogDescription>
        </DialogHeader>
        {review ? (
          <div className="grid gap-3">
            <ul className="divide-y rounded-lg border text-sm" aria-label="Asks to publish">
              {review.map((r) => (
                <li key={r.date} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="tabular-nums">
                    <strong>{fmtDate(r.date)}</strong> · {windowLabel(startsAt, endsAt)} · <ShiftTag shift={target} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.duplicate
                      ? <span className="font-medium text-warning-strong">Already asked — skipped</span>
                      : <>{headcount.trim() ? `${headcount} needed · ` : ""}{department === "all" ? "Everyone" : department}</>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReview(null)} disabled={publishing}>Back</Button>
              <Button onClick={() => void publishAll()} disabled={publishing || toPublish === 0}>
                {publishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Publish {toPublish} {toPublish === 1 ? "ask" : "asks"}
              </Button>
            </div>
          </div>
        ) : (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Date</Label>
            <DateField value={onDate} onChange={setOnDate} min={today} aria-label="Date" />
          </div>
          {/* The same ask on other days: one ask per date, reviewed before anything goes out. */}
          <div className="grid gap-1.5">
            <Label>Also on (optional)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <DateField value={pickDate} onChange={setPickDate} min={today} aria-label="Another date" />
              <Button type="button" size="sm" variant="outline" disabled={!pickDate || allDates.includes(pickDate)}
                onClick={() => { setExtraDates((d) => [...d, pickDate]); setPickDate(""); }}>
                <Plus className="mr-1 h-4 w-4" /> Add date
              </Button>
            </div>
            {extraDates.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Other dates">
                {[...extraDates].sort().map((d) => (
                  <li key={d}>
                    <Badge variant="outline" className="gap-1 font-normal tabular-nums">
                      {fmtDate(d)}
                      <button type="button" aria-label={`Remove ${fmtDate(d)}`}
                        onClick={() => setExtraDates((xs) => xs.filter((x) => x !== d))}>
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Overtime length</Label>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Overtime length">
              {OVERTIME_LENGTHS.map((h) => (
                <Button key={h} type="button" variant="outline" aria-pressed={length === h}
                  className={cn("h-auto py-2 font-semibold", length === h ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "")}
                  onClick={() => {
                    setLength(h);
                    const win = h === 8 ? SHIFT_HOURS_8.Day : SHIFT_HOURS.Day;
                    setStartsAt(win.starts); setEndsAt(win.ends);
                  }}>
                  {h} hours
                </Button>
              ))}
            </div>
          </div>
          {/* Same two shift buttons for 8 and 12 hours; only the window changes. */}
          <div className="grid gap-1.5">
            <Label>Shift ({length} hours)</Label>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Shift">
              {OVERTIME_SHIFTS.map((sh) => {
                const Icon = SHIFT_ICON[sh];
                const win = length === 8 ? SHIFT_HOURS_8[sh] : SHIFT_HOURS[sh];
                const on = startsAt === win.starts && endsAt === win.ends;
                const look = sh === "Day"
                  ? (on ? "border-shift-day bg-shift-day text-white hover:bg-shift-day/90" : "border-shift-day/40 text-shift-day-strong hover:bg-shift-day/10")
                  : (on ? "border-shift-night bg-shift-night text-white hover:bg-shift-night/90" : "border-shift-night/40 text-shift-night-strong hover:bg-shift-night/10");
                return (
                  <Button key={sh} type="button" variant="outline" aria-pressed={on}
                    className={cn("h-auto flex-col gap-0.5 py-2 font-semibold", look)}
                    onClick={() => { setStartsAt(win.starts); setEndsAt(win.ends); }}>
                    <span className="flex items-center gap-1.5"><Icon className="h-4 w-4" aria-hidden /> {sh.toUpperCase()} SHIFT</span>
                    <span className="text-xs font-normal tabular-nums">{win.starts}–{win.ends}</span>
                  </Button>
                );
              })}
            </div>
          </div>
          {/* The board this lands on is decided by the start time — the same rule the
              database uses. Said out loud so a 17:00 start is not a surprise. */}
          {target && (
            <p className="text-xs text-muted-foreground" data-testid="ot-target-board">
              Goes on the <strong className="text-foreground">{target}</strong> board of {fmtDate(onDate)} · {hoursBetween(startsAt, endsAt)}.
              The crew only decides who is asked; you can still add anybody from any crew.
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="ot-n">People needed <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="ot-n" type="number" min={1} inputMode="numeric" placeholder="Everyone who says yes"
              value={headcount} onChange={(e) => setHeadcount(e.target.value)} aria-describedby="ot-n-hint" />
            <p id="ot-n-hint" className="text-xs text-muted-foreground">
              {headcount.trim()
                ? `The first ${headcount} to say yes are booked; anyone after goes on the reserve list.`
                : "Empty: everyone who says yes is booked, and you get an alert for each."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger aria-label="Department"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              {/* Who is asked on their phone, by their own crew. Not the shift the
                  overtime is on — that is the time above. */}
              <Label>Crew asked</Label>
              <Select value={shiftGroup} onValueChange={setShiftGroup}>
                <SelectTrigger aria-label="Crew asked"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every crew</SelectItem>
                  {shiftGroups.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ot-note">Note (optional)</Label>
            <Textarea id="ot-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Line 3, packing. Bring safety boots." />
          </div>
          <Button onClick={submit} disabled={createRequest.isPending}>
            {createRequest.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {allDates.length > 1 ? `Review ${allDates.length} asks` : "Review the ask"}
          </Button>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Daniel" alone, or "Daniel · Packing, Night crew" when another active Daniel exists.
 *
 * Not the badge number: `overtime_roster` hands out name, department and crew only,
 * and the employees table itself is admin-only (theRosterFollowsItsScreen). The row
 * underneath still carries the employee id; this is what the eye needs to tell them apart.
 */
function displayName(e: RosterName, ctx: Pick<CardContext, "dupNames">): string {
  if (!ctx.dupNames.has(e.full_name.trim().toLowerCase())) return e.full_name;
  const tag = [e.department, e.shift_group && `${e.shift_group} crew`].filter(Boolean).join(", ");
  return tag ? `${e.full_name} · ${tag}` : e.full_name;
}

function ClashList({ clashes }: { clashes: Clash[] }) {
  if (clashes.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {clashes.map((c, i) => (
        <li key={i} className={cn("flex items-center gap-1 text-xs font-normal",
          c.severity === "block" ? "text-destructive" : "text-warning-strong")}>
          {c.severity === "block"
            ? <Ban className="h-3 w-3 shrink-0" aria-hidden />
            : <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />}
          {c.text}
        </li>
      ))}
    </ul>
  );
}

function RequestCard({ request, ctx, mayManage }: { request: OvertimeRequest; ctx: CardContext; mayManage: boolean }) {
  const { roster, reliability, outcomeByResponse } = ctx;
  const responses = useMemo(() => ctx.responsesByRequest.get(request.id) ?? [], [ctx.responsesByRequest, request.id]);
  const { setRequestStatus, deleteRequest, editRequest, decide, recordOutcome, answerFor, removeAnswer } = useOvertimeMutations();
  // Corrigir a data e as horas de um pedido já feito. Ver `editRequest` para porque não
  // apaga respostas.
  const [editing, setEditing] = useState(false);
  const [edDate, setEdDate] = useState(request.on_date);
  const [edStart, setEdStart] = useState(request.starts_at.slice(0, 5));
  const [edEnd, setEdEnd] = useState(request.ends_at.slice(0, 5));
  const [edCount, setEdCount] = useState(request.headcount == null ? "" : String(request.headcount));
  const openEdit = () => {
    setEdDate(request.on_date);
    setEdStart(request.starts_at.slice(0, 5));
    setEdEnd(request.ends_at.slice(0, 5));
    setEdCount(request.headcount == null ? "" : String(request.headcount));
    setEditing(true);
  };
  const [addingFor, setAddingFor] = useState<string>("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  /**
   * Open, close or cancel — and say so when the write is refused.
   *
   * The mutation throws when RLS matched no row. That only helps if somebody is
   * listening: a `mutate` with no `onError` leaves the message in react-query's
   * state, where the person who pressed the button never sees it.
   */
  const changeStatus = (status: OvertimeRequest["status"]) =>
    setRequestStatus.mutate(
      { id: request.id, status },
      {
        onSuccess: () => toast.success(
          status === "cancelled" ? "Ask cancelled" : status === "closed" ? "Ask closed" : "Ask reopened",
        ),
        onError: (e) => toast.error((e as Error).message || "Could not change the ask"),
      },
    );

  const byId = useMemo(() => new Map(roster.map((e) => [e.id, e])), [roster]);
  // `short` from the places still held, as the database counts them: "4 of 4" in
  // green with somebody off sick told the supervisor there was nothing left to do.
  const counts = countResponses(request, responses, (id) => outcomeByResponse.get(id));
  // Places held by people still coming — the number the database refuses an accept on
  // (BLOCO 101). Not `counts.accepted`: that keeps somebody who called in sick, whose
  // place the reserve, or the next accept, is meant to take.
  const taken = placesTaken(responses, (id) => outcomeByResponse.get(id));
  // Only an ask that kept a number (from before BLOCO 102) can be full.
  const full = request.headcount != null && taken >= request.headcount;
  const edBadCount = !!edCount.trim() && (!Number.isInteger(Number(edCount)) || Number(edCount) <= 0);
  const edBelowTaken = !!edCount.trim() && Number(edCount) < taken;
  const state = askState(request, responses);
  const shift = askShift(request);
  const isPast = request.on_date < iso(new Date());

  const candidates: Candidate<RosterName>[] = useMemo(() => sortCandidates(
    responses
      .filter((r) => r.answer === "yes" && byId.has(r.employee_id))
      .map((r) => ({ employee: byId.get(r.employee_id)!, response: r, reliability: reliability?.get(r.employee_id) })),
  ), [responses, byId, reliability]);

  const saidNo = responses.filter((r) => r.answer === "no")
    .map((r) => byId.get(r.employee_id)).filter(Boolean).map((e) => displayName(e!, ctx));

  const clashOf = (employeeId: string) =>
    clashesFor(employeeId, request, ctx.others, ctx.board, ctx.schedule, (id) => ctx.outcomeByResponse.get(id));

  // Not narrowed by the ask's crew or department: those say who is asked, and a
  // supervisor may add anybody — a Day person on Night overtime included. Those
  // outside the ask get their own group, so it is a choice and never an accident.
  const desk = deskCandidates(request, roster, new Set(responses.map((r) => r.employee_id)));
  const inAudience = desk.filter((d) => !d.outside).map((d) => d.employee);
  const outsideAudience = desk.filter((d) => d.outside).map((d) => d.employee);
  const addOption = (e: RosterName) => {
    const blocked = blockedLabel(reliability?.get(e.id));
    const clash = clashOf(e.id)[0];
    const extra = [e.shift_group && `${e.shift_group} crew`, blocked, clash?.text].filter(Boolean).join(" · ");
    return (
      <SelectItem key={e.id} value={e.id}>
        {displayName(e, ctx)}{extra ? <span className="text-muted-foreground"> — {extra}</span> : null}
      </SelectItem>
    );
  };

  const onDecide = (responseId: string, decision: "accepted" | "reserve" | "declined" | null) =>
    decide.mutate({ responseId, decision }, { onError: (e) => toast.error((e as Error).message) });

  return (
    <>
    <Card className={cn(shiftCard(shift), request.status !== "open" && "opacity-80")}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span className="tabular-nums">{fmtDate(request.on_date)} · {windowLabel(request.starts_at, request.ends_at)}</span>
              <ShiftTag shift={shift} />
              <span className="text-xs font-normal text-muted-foreground">{hoursBetween(request.starts_at, request.ends_at)}</span>
              <StatusBadge status={STATE_BADGE[state]} label={ASK_STATE_LABEL[state]} size="sm" />
            </CardTitle>
            {/* Who can see it, as a sentence. The note is on its own line below: it
                is the only thing on this card somebody typed. */}
            <div className="mt-1 text-xs text-muted-foreground">For: {audienceLine(request)}</div>
            {request.note && (
              <p className="mt-1 text-xs italic text-foreground/80">“{request.note}”</p>
            )}
          </div>
          {/* The one question this card is for: who is coming. An ask with a number
              (from before BLOCO 102) also says how far it is from full. */}
          <div className="w-full min-w-[11rem] text-sm sm:w-auto">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium tabular-nums">
                {/* Places still held, not every 'accepted' given: a cancelled booking keeps
                    its decision as the record but the person is not coming. */}
                {counts.headcount == null
                  ? `${taken} ${taken === 1 ? "person" : "people"} booked`
                  : `${taken} of ${counts.headcount} picked`}
              </span>
              {counts.short != null && counts.short > 0 && request.status === "open" && (
                <span className="text-xs font-medium text-warning-strong">{counts.short} to go</span>
              )}
            </div>
            {counts.headcount != null && (
              <div
                className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${taken} of ${counts.headcount} picked`}
              >
                <div
                  className={cn("h-full rounded-full transition-[width]",
                    counts.short === 0 ? "bg-success" : "bg-warning")}
                  style={{ width: `${Math.min(100, (taken / Math.max(1, counts.headcount)) * 100)}%` }}
                />
              </div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              {counts.interested} said yes{counts.reserve ? `, ${counts.reserve} on reserve` : ""}
            </div>
            {/* O número que manda alguém pegar no telefone. */}
            {countStale(responses, request) > 0 && (
              <div className="mt-1 flex items-center gap-1 text-xs font-medium text-warning-strong">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {countStale(responses, request)} to re-confirm — the shift changed
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {candidates.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nobody has said yes yet.</div>
        ) : (
          // A list rather than a table: six columns do not fit a phone, and a table that
          // scrolls sideways hides the decision buttons off the edge.
          <ul className="divide-y rounded-lg border">
            {candidates.map(({ employee, response, reliability: rel }) => {
              const tone = reliabilityTone(rel);
              const clashes = clashOf(employee.id);
              const blockedBy = clashes.find((c) => c.severity === "block");
              return (
                <li key={response.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {/* The crew and department beside it are what tell two Daniels apart. */}
                      <span className="font-medium">{employee.full_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {[employee.shift_group && `${employee.shift_group} crew`, employee.department].filter(Boolean).join(" · ") || "No crew set"}
                      </span>
                      {response.decision === null && (
                        <StatusBadge status="pending" label="Awaiting decision" size="sm" />
                      )}
                    </div>
                    {/* Disse que sim a outro turno. Não se apaga a resposta — diz-se a quem
                        é preciso telefonar, e a que horas ela respondeu. */}
                    {answeredForDifferentHours(response, request) && (() => {
                      const seen = windowAnswered(response)!;
                      return (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-warning-strong">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          said yes to {fmtDate(seen.on_date)} · {windowLabel(seen.starts_at, seen.ends_at)}
                        </span>
                      );
                    })()}
                    <ClashList clashes={clashes} />
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className={cn("font-normal", TONE_CLASS[tone])}>{reliabilityLabel(rel)}</Badge>
                      {blockedLabel(rel) && (
                        <Badge variant="outline" className="border-destructive/40 bg-destructive/10 font-normal text-destructive">{blockedLabel(rel)}</Badge>
                      )}
                      <span>60 days: {attendedLabel(rel)}</span>
                      <span aria-hidden>·</span>
                      <span>
                        Answered {new Date(response.answered_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 md:shrink-0 md:items-end">
                    {/* Wrong day or hours picked: remove the answer, then add the right one
                        on the correct ask ("Add a yes given at the desk"). */}
                    {mayManage && request.status === "open" && (
                      <Button size="sm" variant="ghost"
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                        aria-label={`Remove answer — ${employee.full_name}`}
                        title="Wrong day or hours? Remove this answer, then add the right one."
                        disabled={removeAnswer.isPending}
                        onClick={() => {
                          if (!window.confirm(`Remove ${employee.full_name}'s answer for ${fmtDate(request.on_date)}? You can add the right one afterwards.`)) return;
                          removeAnswer.mutate({ responseId: response.id }, {
                            onSuccess: () => toast.success(`${employee.full_name}'s answer removed.`),
                            onError: (e) => toast.error((e as Error).message),
                          });
                        }}>
                        <X className="mr-1 h-3.5 w-3.5" aria-hidden /> Wrong answer
                      </Button>
                    )}
                    {/* Once somebody is in (or on reserve), what matters is whether they turn
                        up — and that is known before the day as often as after. A drop-out on
                        an open ask promotes the reserve by itself. */}
                    {response.decision === "accepted" || response.decision === "reserve" ? (
                      <div className="flex items-center gap-1 md:justify-end">
                        <StatusBadge status={response.decision === "accepted" ? "success" : "info"}
                          label={response.decision === "accepted" ? "Accepted" : "Reserve"} size="sm" />
                        <Select
                          value={outcomeByResponse.get(response.id) ?? ""}
                          disabled={!mayManage}
                          onValueChange={(v) => recordOutcome.mutate(
                            { responseId: response.id, outcome: v as OvertimeOutcome },
                            {
                              onSuccess: ({ promotedEmployeeId, push }) => {
                                if (!promotedEmployeeId) return;
                                const who = byId.get(promotedEmployeeId)?.full_name ?? "the reserve";
                                toast.success(`${who} moved up from reserve${push?.notified ? " and was told" : ""}.`);
                              },
                              onError: (e) => toast.error((e as Error).message),
                            },
                          )}
                        >
                          <SelectTrigger className="h-8 w-[150px]" aria-label={`What happened — ${employee.full_name}`}>
                            <SelectValue placeholder={isPast ? "What happened?" : response.decision === "accepted" ? "Still coming" : "On reserve"} />
                          </SelectTrigger>
                          <SelectContent>
                            {(() => {
                              // A reserve was never booked, so a no-show or a sick call cannot be
                              // held against them (the database refuses it, BLOCO 130).
                              const offered = OUTCOMES.filter((o) => response.decision === "accepted" || (o.value !== "no_show" && o.value !== "called_sick"));
                              const v = outcomeByResponse.get(response.id);
                              // What is already stored stays readable even when it is not offered.
                              const stored = v && !offered.some((o) => o.value === v)
                                ? STORED_LABEL[v] ?? OUTCOMES.find((o) => o.value === v)?.label ?? v : null;
                              return (
                                <>
                                  {offered.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                  {stored && <SelectItem value={v!} disabled>{stored}</SelectItem>}
                                </>
                              );
                            })()}
                          </SelectContent>
                        </Select>
                        {mayManage && request.status === "open" && !outcomeByResponse.has(response.id) && (
                          <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground"
                            aria-label={`Undo decision for ${employee.full_name}`} title="Undo decision"
                            disabled={decide.isPending} onClick={() => onDecide(response.id, null)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <DecisionButtons
                        name={employee.full_name}
                        decision={response.decision}
                        disabled={!mayManage || request.status !== "open" || decide.isPending}
                        acceptBlockedBy={blockedBy?.text
                          ?? (full ? `${request.headcount === 1 ? "the only place is" : `all ${request.headcount} places are`} filled — put them on reserve, or raise the number needed` : null)}
                        onDecide={(d) => onDecide(response.id, d)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {saidNo.length > 0 && (
          <div className="text-xs text-muted-foreground">Declined the offer: {saidNo.join(", ")}</div>
        )}

        {mayManage && request.status === "open" && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden />
              <Select value={addingFor} onValueChange={setAddingFor}>
                <SelectTrigger className="h-8 w-[260px] max-w-full" aria-label="Add a yes given at the desk">
                  <SelectValue placeholder="Add a yes given at the desk…" />
                </SelectTrigger>
                <SelectContent>
                  {inAudience.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>For this ask</SelectLabel>
                      {inAudience.map(addOption)}
                    </SelectGroup>
                  )}
                  {outsideAudience.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Other crews and departments</SelectLabel>
                      {outsideAudience.map(addOption)}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              <Button
                size="sm" variant="outline" disabled={!addingFor || answerFor.isPending}
                onClick={() => answerFor.mutate({
                  requestId: request.id, employeeId: addingFor,
                  window: { on_date: request.on_date, starts_at: request.starts_at, ends_at: request.ends_at },
                },
                  { onSuccess: () => setAddingFor(""), onError: (e) => toast.error((e as Error).message) })}
              >
                Add
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* As horas são escritas à mão, por isso um engano fica lá. Corrigir não
                  apaga respostas: quem já tinha dito que sim fica assinalado acima. */}
              <Button size="sm" variant="ghost" onClick={openEdit}>
                <Pencil className="mr-1 h-4 w-4" /> Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
                Cancel ask
              </Button>
              {/* Só para um pedido que ninguém tocou. Com respostas, a base recusa e
                  a saída é cancelar. */}
              {responses.length === 0 && (
                <Button size="sm" variant="ghost" className="text-destructive-strong"
                  disabled={deleteRequest.isPending}
                  onClick={() => {
                    if (!window.confirm("Delete this ask? Nobody has answered it, so nothing is lost.")) return;
                    deleteRequest.mutate(request.id, {
                      onSuccess: () => toast.success("Ask deleted"),
                      onError: (e) => toast.error((e as Error).message || "Could not delete the ask"),
                    });
                  }}>
                  Delete
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => changeStatus("closed")}>
                Close ask
              </Button>
            </div>
          </div>
        )}
        {mayManage && request.status !== "open" && !isPast && (
          <div className="border-t pt-3">
            <Button size="sm" variant="ghost" onClick={() => changeStatus("open")}>
              Reopen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>

      {/* Cancelling takes the shift away from everyone already picked, and their rows
          off the board, so it is asked twice — with the count of who it touches. */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this ask?</AlertDialogTitle>
            <AlertDialogDescription>
              {fmtDate(request.on_date)} · {windowLabel(request.starts_at, request.ends_at)}.{" "}
              {counts.accepted > 0
                ? `${counts.accepted} ${counts.accepted === 1 ? "person is" : "people are"} already accepted on it. Their answers are kept; the overtime the ask put on the headcount board is taken off.`
                : "Nobody has been accepted on it yet."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => changeStatus("cancelled")}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Cancel ask
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit this ask</DialogTitle>
            <DialogDescription>
              Nobody's answer is deleted. Anyone who already said yes is marked, so you
              know who to tell that the shift moved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <DateField value={edDate} onChange={setEdDate} aria-label="Date" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ed-start">Starts</Label>
                <Input id="ed-start" type="time" value={edStart} onChange={(e) => setEdStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ed-end">Ends</Label>
                <Input id="ed-end" type="time" value={edEnd} onChange={(e) => setEdEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-count">People needed <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="ed-count" type="number" min={1} value={edCount} placeholder="Everyone who says yes"
                onChange={(e) => setEdCount(e.target.value)} />
            </div>
            {/* Nobody's booking is taken away by an edit: the database refuses it too. */}
            {edBelowTaken && (
              <p className="flex items-start gap-1 text-xs font-medium text-destructive" role="alert">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {taken} {taken === 1 ? "person is" : "people are"} already booked, so it can't need fewer than {taken}.
                Move someone to reserve first, and tell them.
              </p>
            )}
            {/* Moving the shift moves the people on it. Said before the save, with the
                count, because they are the ones who now have to be told. */}
            {taken > 0 && (edDate !== request.on_date || edStart !== request.starts_at.slice(0, 5) || edEnd !== request.ends_at.slice(0, 5)) && (
              <p className="flex items-start gap-1 text-xs font-medium text-warning-strong" role="status">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {taken} {taken === 1 ? "person is" : "people are"} already booked. They stay on it and move with it on the
                board — tell them the new day or hours.
              </p>
            )}
            {/* Vinte horas num turno de doze é o engano que isto existe para corrigir. */}
            <p className="text-xs text-muted-foreground">
              {windowLabel(edStart, edEnd)} · {hoursBetween(edStart, edEnd)}
              {/^\d{2}:\d{2}/.test(edStart) && <> · {askShift({ starts_at: edStart })} shift</>}
            </p>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              disabled={editRequest.isPending || !edDate || !edStart || !edEnd || edBadCount || edBelowTaken}
              onClick={() => editRequest.mutate(
                {
                  id: request.id, on_date: edDate, starts_at: edStart, ends_at: edEnd,
                  headcount: edCount.trim() ? Number(edCount) : null,
                },
                {
                  onSuccess: () => { setEditing(false); toast.success("Ask updated"); },
                  onError: (e) => toast.error((e as Error).message),
                },
              )}
            >
              {editRequest.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DecisionButtons({ name, decision, disabled, acceptBlockedBy, onDecide }: {
  name: string;
  decision: "accepted" | "reserve" | "declined" | null;
  disabled: boolean;
  /** Why Accept would make a duplicate, or null. Reserve and Decline stay available. */
  acceptBlockedBy: string | null;
  onDecide: (d: "accepted" | "reserve" | "declined" | null) => void;
}) {
  const btn = (d: "accepted" | "reserve" | "declined", Icon: typeof Check, label: string, active: string) => {
    const blocked = d === "accepted" && acceptBlockedBy !== null && decision !== "accepted";
    return (
      <Button
        key={d} size="sm" variant={decision === d ? "default" : "outline"}
        className={cn("h-8 px-2", decision === d && active)}
        disabled={disabled || blocked}
        aria-label={`${label} ${name}`}
        title={blocked ? `Can't accept: ${acceptBlockedBy}` : label}
        onClick={() => onDecide(decision === d ? null : d)}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="ml-1 hidden sm:inline">{label}</span>
      </Button>
    );
  };
  return (
    <div className="flex gap-1 md:justify-end">
      {btn("accepted", Check, "Accept", "bg-success text-success-foreground hover:bg-success/90")}
      {btn("reserve", Clock, "Reserve", "bg-warning text-warning-foreground hover:bg-warning/90")}
      {btn("declined", X, "Decline", "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
    </div>
  );
}
