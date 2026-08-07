import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, Printer, Download, Upload, CopyPlus, Users, Factory, Wrench, PlaneTakeoff, Clock3, Sun, Moon, CalendarDays, GripVertical, UserCheck, UserX, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { BackButton } from "@/components/BackButton";
import { WorkforceTabs } from "@/components/workforce/WorkforceTabs";
import { AdminPinGate } from "@/components/AdminPinGate";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { AreaPicker } from "@/components/workforce/AreaPicker";
import { useShiftPatterns } from "@/hooks/useWorkforce";
import { PersonDayDialog } from "@/components/workforce/PersonDayDialog";
import { roleStripe } from "@/lib/workforceRoles";
import {
  useHeadcountAreas,
  useShiftRoster,
  useAllocations,
  useAllocationMutations,
  useChangeShift,
  useReorderAreas,
  useSetShiftPattern,
  crewBadge,
  type AllocStatus,
  type HeadcountArea,
  type HeadcountEmployee,
} from "@/hooks/useHeadcount";
import { HeadcountSheetDialog } from "@/components/workforce/HeadcountSheetDialog";
import { PeriodCalendar } from "@/components/workforce/PeriodCalendar";
import { HeadcountOvertimePanel } from "@/components/workforce/HeadcountOvertimePanel";

/** Employee id currently being dragged (HTML5 dataTransfer isn't readable on dragover). */
let draggedEmployeeId: string | null = null;

/**
 * The boards there are. Weekend is one of them: `daily_allocations.shift` accepts it,
 * the Fri–Mon crew is forty people, and without a tab their allocations were saved
 * and then invisible — 37 of them, on a board that could only show Day and Night.
 */
type ShiftKey = "Day" | "Night";
type ViewKey = ShiftKey | "Split";

const AWAY_BLOCKS: { status: AllocStatus; label: string; accent: string }[] = [
  { status: "sick", label: "Sickness", accent: "border-rose-500/40 bg-rose-500/5" },
  { status: "unpaid", label: "Unpaid", accent: "border-amber-500/40 bg-amber-500/5" },
  { status: "holiday", label: "Holidays", accent: "border-amber-500/40 bg-amber-500/5" },
  { status: "overtime", label: "Overtime", accent: "border-violet-500/40 bg-violet-500/5" },
];

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatLong(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function dayTypeLabel(iso: string) {
  const w = new Date(`${iso}T12:00:00`).getDay();
  if (w === 0) return "Sunday";
  if (w === 6) return "Saturday";
  return "Weekday";
}

/**
 * A section heading with a rule running out to the edge.
 *
 * Production and support are read differently — one is the line running, the other is
 * who keeps it running — and in a single grid Office sat between Line 3 and Line 4 as
 * though it were the next line.
 */
/**
 * The blocks the board is read in, in the order the factory walks them.
 *
 * Not the same question as `kind`: kind decides whether somebody counts as on a line
 * or in support, and these decide where the card is drawn. Keeping them apart is what
 * lets Gel Room count as production while sitting beside the capsule machines.
 */
const SECTIONS: { key: string; label: string; accent: string }[] = [
  { key: "production", label: "Production", accent: "text-primary" },
  { key: "support", label: "Support", accent: "text-slate-500" },
];

/**
 * Which block an area is drawn in.
 *
 * `section` decides, and it is not the same question as `kind`. Hygiene, Quality and
 * Runner are support in the totals and sit in the production block on the board,
 * because that is where the factory's own sheet puts them — the people planning the
 * day read them alongside the lines they serve.
 *
 * The fallback matters more than it looks. The board used to filter on `section`
 * alone against a fixed list of four, so an area whose section was renamed, misspelt
 * or left blank vanished from the board entirely while its allocations carried on
 * being saved. Anything unrecognised now lands in the block its `kind` implies,
 * which is wrong at worst and invisible never.
 */
function blockOf(area: HeadcountArea): string {
  const s = (area.section ?? "").toLowerCase();
  if (s === "production" || s === "support") return s;
  return area.kind === "production" ? "production" : "support";
}

/**
 * A section heading that can be folded away.
 *
 * A supervisor watching the lines run does not need Office and Maintenance taking a
 * third of the screen. Folded state is remembered per section, because the one you
 * do not care about at 6am is the same one at 2pm.
 */
function SectionLabel({
  children, accent, count, open, onToggle,
}: {
  children: React.ReactNode; accent?: string; count?: number;
  open?: boolean; onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!onToggle}
      className="mb-2 mt-5 flex w-full items-center gap-2 text-left text-2xs font-extrabold uppercase tracking-widest text-muted-foreground first:mt-0"
    >
      {onToggle && (
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
      )}
      <span className={accent}>{children}</span>
      {count !== undefined && (
        <span className="rounded-full bg-muted px-1.5 font-mono text-2xs font-bold">{count}</span>
      )}
      <span className="h-px flex-1 bg-border" />
    </button>
  );
}

/** Two letters, for the square that sits before the name. */
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

/**
 * How each shift looks.
 *
 * The colour is what makes the split view work: two boards of identical grey columns
 * side by side are one board twice the size, and the eye has to read a heading to
 * know which factory it is looking at.
 */
const LOOK: Record<string, { icon: typeof Sun; rule: string; chip: string; soft: string; ink: string }> = {
  Day: { icon: Sun, rule: "border-l-amber-500", chip: "bg-amber-500/15 text-warning-strong", soft: "bg-amber-500/10", ink: "text-warning-strong" },
  Night: { icon: Moon, rule: "border-l-indigo-500", chip: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", soft: "bg-indigo-500/10", ink: "text-indigo-700 dark:text-indigo-300" },
  Weekend: { icon: CalendarDays, rule: "border-l-teal-500", chip: "bg-teal-500/15 text-teal-700 dark:text-teal-300", soft: "bg-teal-500/10", ink: "text-teal-700 dark:text-teal-300" },
};

/**
 * The line leader, picked out.
 *
 * A supervisor scanning a column wants to know it has a leader before they want
 * anybody's name. It comes off `department`, which was typed by hand over months —
 * hence a pattern rather than an exact list.
 */
function isLeader(department: string | null | undefined) {
  return !!department && /team\s*lead|supervisor/i.test(department);
}

function Chip({
  name,
  tone,
  leader,
  role,
  dimmed,
  overtime,
  half,
  leftEarlyAt,
  crew,
  draggable,
  onOpen,
  onDragStart,
}: {
  name: string;
  tone: "production" | "support" | "away" | "overtime" | "roster";
  leader?: boolean;
  /** Named role — LEAD, SUP, TEC, LAB, WH, OFF — when the department says one. */
  role?: { short: string; label: string; cls: string } | null;
  /** Somebody is searching and it is not this person. */
  dimmed?: boolean;
  onOpen?: () => void;
  /** Working a day their own rota does not cover — marked on the line, not moved off it. */
  overtime?: boolean;
  /** Off for half the shift. Shown on the chip so the block's count can be read honestly. */
  half?: boolean;
  /** Came in and went home early, at this time. A day worked, not a day off. */
  leftEarlyAt?: string | null;
  /** Which crew they belong to — FRI–MON, WH, NIGHT. Null for the plain day shift,
      which is most of the board and needs no label to say so. */
  crew?: string | null;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const tones: Record<string, string> = {
    production: "bg-primary/5 border-primary/20",
    support: "bg-muted/40 border-border",
    away: "bg-amber-500/10 border-amber-500/30",
    overtime: "bg-violet-500/10 border-violet-500/30",
    roster: "bg-card border-border",
  };
  return (
    <span
      draggable={draggable}
      onDragStart={onDragStart}
      className={cn(
        // 44px tall and a 26px square: this board is used on a tablet, on the floor,
        // by somebody wearing gloves. A 30px row is a row you miss.
        "inline-flex min-h-[44px] w-full max-w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium",
        leader ? "border-primary/40 bg-primary/10 font-semibold"
          : overtime ? "border-violet-500/40 bg-violet-500/10"
          : tones[tone],
        draggable ? "cursor-grab active:cursor-grabbing" : onOpen ? "cursor-pointer" : "cursor-default",
        dimmed && "opacity-20",
      )}
      title={name}
      onClick={onOpen}
      onKeyDown={(e) => { if (onOpen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      {/* The leader's square says LEAD rather than their initials. Initials in a
          darker box only read as "this one is somehow different"; the word says which
          way, and it is the thing being looked for when a column is scanned. */}
      <span className={cn(
        "grid h-[26px] shrink-0 place-items-center rounded-md text-[11px] font-bold leading-none",
        leader ? "w-11 bg-primary text-primary-foreground tracking-wide" : "w-[26px] bg-background/70 text-muted-foreground",
      )}>
        {leader ? "LEAD" : initials(name)}
      </span>
      <span className="truncate">{name}</span>
      {/* Day and the Fri–Mon crew share this board, so the card has to say which is
          which. Only the ones that are not the plain day shift are labelled — a badge
          on every card is a badge that stops being read. */}
      {crew && (
        <span
          title={`${crew} crew`}
          className="shrink-0 rounded-sm border border-slate-400/40 bg-slate-500/10 px-1 py-px text-[10px] font-bold uppercase leading-tight tracking-wide text-muted-foreground"
        >
          {crew}
        </span>
      )}
      {/* Half a day, said on the chip. Without it the block reads "2 away" and both
          look identical, when one of them worked the morning. */}
      {half && (
        <span
          title="Half day — worked part of the shift"
          className="shrink-0 rounded-sm bg-background/70 px-1 py-px text-[10px] font-bold leading-tight text-muted-foreground"
        >
          ½
        </span>
      )}
      {/* Went home early. On the chip because the column counts them as in — which
          they were — and the supervisor reading the board at four needs to know the
          line lost somebody at two without opening every card. */}
      {leftEarlyAt && (
        <span
          title={`Left early — went home at ${leftEarlyAt.slice(0, 5)}`}
          className="shrink-0 rounded-sm bg-amber-500/20 px-1 py-px text-[10px] font-bold leading-tight text-warning-strong"
        >
          ←{leftEarlyAt.slice(0, 5)}
        </span>
      )}
      {/* The named role rides after the name, the way a label does on a card. Only
          when there is one: a badge every row carries tells the eye nothing. */}
      {role && !leader && (
        <span
          title={role.label}
          className={cn("ml-auto shrink-0 rounded-sm px-1 py-px text-[10px] font-bold uppercase leading-tight", role.cls)}
        >
          {role.short}
        </span>
      )}
    </span>
  );
}

/**
 * A column that can be picked up by its grip.
 *
 * The grip is a separate target on purpose: the heading itself opens the search, and
 * a header that both opens a dialog and starts a drag would do the wrong one about
 * half the time on a tablet.
 */
function SortableColumn({ id, children }: { id: string; children: (grip: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-70")}
    >
      {children(
        <button
          type="button"
          aria-label="Reorder column"
          // Was 14px at half opacity with no padding around it: the one control on
          // the board nobody could find, on a screen used through gloves. Full
          // contrast and a real hit area — the drag still only starts from here, so
          // the heading keeps opening the picker.
          className="-ml-1 grid h-8 w-6 shrink-0 place-items-center cursor-grab touch-none rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing no-print"
          title="Drag to move this column"
          onClick={(e) => e.stopPropagation()}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-4 w-4" />
        </button>,
      )}
    </div>
  );
}

function DropZone({
  children,
  onDrop,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onDrop: () => void;
  disabled: boolean;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={cn("rounded-lg transition-colors", over && "ring-2 ring-primary/60 bg-primary/5", className)}
    >
      {children}
    </div>
  );
}

/**
 * A big number and what it is, in the order it gets read.
 *
 * The first one carries the shift's colour because it is the figure the sheet ends
 * on — "how many are in production" is the question, and the other four are how it
 * breaks down.
 */
function KpiPill({
  icon: Icon, label, value, tone, highlight, valueTone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number; tone: string; highlight?: boolean; valueTone?: string;
}) {
  return (
    <div className={cn("rounded-xl border px-3 py-2.5 shadow-sm", highlight ? cn(tone, "border-transparent") : "bg-card")}>
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", highlight ? "" : "text-muted-foreground")} />
        <span className={cn("font-mono text-2xl font-bold leading-none tabular-nums", valueTone)}>{value}</span>
      </div>
      <div className="mt-1.5 truncate text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function ShiftBoard({
  onDate,
  shift,
  areas,
  canManage,
}: {
  onDate: string;
  shift: ShiftKey;
  areas: HeadcountArea[];
  canManage: boolean;
}) {
  /**
   * Everyone on the crew, rota or no rota.
   *
   * The board answers "who is due in today", and on a Monday that hides the twenty-one
   * people on a Tue–Fri rota — correctly, but a supervisor calling somebody in needs
   * to see them. Off by default, because a board listing people who are at home is a
   * list, not a plan.
   */
  const [showAll, setShowAll] = useState(false);
  /**
   * Find a person on the board.
   *
   * Dims rather than filters: a column whose counter moves while you type stops
   * being a count of the line and becomes a count of your search, and the board is
   * read for the first of those.
   */
  const [find, setFind] = useState("");
  const { data: roster = [], byId: everyoneById, onShift = [], isLoading: rosterLoading } = useShiftRoster(shift, onDate, showAll);
  const [picking, setPicking] = useState<{ id: string; name: string } | null>(null);
  /** Absence / Holidays / Overtime, opened the same way an area column is. */
  const [pickingAway, setPickingAway] = useState<{ status: AllocStatus; label: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Folded sections are remembered: the one you do not care about at 6am is the same
  // one at 2pm, and re-folding it every morning is a small tax on every shift.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("headcount_open_sections") ?? "{}"); }
    catch { return {}; }
  });
  useEffect(() => {
    localStorage.setItem("headcount_open_sections", JSON.stringify(openSections));
  }, [openSections]);
  const changeShift = useChangeShift(onDate);
  const reorder = useReorderAreas();
  const setPattern = useSetShiftPattern();
  const { data: patterns = [] } = useShiftPatterns();
  // A little distance first, so a tap on the heading is not read as a drag.
  const columnSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const { data: allocations = [], isLoading: allocLoading } = useAllocations(onDate, shift);
  const { place, remove, copyLastLikeDay, setLeader } = useAllocationMutations(onDate, shift);

  const byEmployee = useMemo(() => {
    const m = new Map<string, (typeof allocations)[number]>();
    allocations.forEach((a) => m.set(a.employee_id, a));
    return m;
  }, [allocations]);

  // Everyone active, not only whoever is eligible today: a saved allocation is a fact
  // and has to show in its column. If the person stops being eligible the card stays,
  // so somebody can take them off — rather than vanishing from the screen while still
  // counting in the totals, which is what made the board read "20 support" with the
  // WH Team column at zero.
  const employeeById = everyoneById ?? new Map<string, HeadcountEmployee>();

  /**
   * Who is working in an area, leader first.
   *
   * Overtime counts as working here: somebody called in on a day their rota does not
   * cover is on that line, doing that job, and the sheet lists them on the line *and*
   * under Overtime staff. Showing them only in the Overtime card took them off the
   * line they were actually standing on.
   *
   * The leader is forced to the top rather than sorted alphabetically, because the
   * first thing anybody asks of a column is whether it has one.
   */
  const peopleIn = (areaId: string) =>
    allocations
      .filter((a) => (a.status === "assigned" || a.status === "overtime")
        && a.area_id === areaId && employeeById.has(a.employee_id))
      .map((a) => ({
        person: employeeById.get(a.employee_id)!,
        overtime: a.status === "overtime",
        // The day's own leader wins. `department` is only the fallback, so a board
        // nobody has named a leader on still shows the Team Leaders it has.
        leader: a.is_leader ?? false,
      }))
      .sort((a, b) => {
        const la = (a.leader || isLeader(a.person.department)) ? 0 : 1;
        const lb = (b.leader || isLeader(b.person.department)) ? 0 : 1;
        return la - lb || a.person.full_name.localeCompare(b.person.full_name);
      });

  const peopleWith = (status: AllocStatus) =>
    allocations
      .filter((a) => a.status === status && employeeById.has(a.employee_id))
      .map((a) => employeeById.get(a.employee_id)!)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const unassigned = roster.filter((e) => !byEmployee.has(e.id));

  // Working = placed on an area, whether the day is a normal one or an overtime one.
  // The sheet's "Total staff in Production" counts the overtime people too — they are
  // in the factory — so leaving them out made the board disagree with the sheet.
  // Only people the board can actually draw. Somebody marked as having left keeps
  // their allocation rows — the day they worked is history and deleting it would take
  // that with them — but they are no longer on the roster, so their card disappears.
  // Counting them anyway is how a column reading zero sat under a total saying ten.
  const working = allocations.filter(
    (a) => (a.status === "assigned" || a.status === "overtime") && employeeById.has(a.employee_id),
  );
  const assignedCount = working.length;
  const productionIds = new Set(areas.filter((a) => a.kind === "production").map((a) => a.id));
  const onLines = working.filter((a) => a.area_id && productionIds.has(a.area_id)).length;
  const support = assignedCount - onLines;
  const away = allocations.filter(
    (a) => (a.status === "sick" || a.status === "unpaid" || a.status === "holiday")
      && employeeById.has(a.employee_id),
  ).length;
  const overtime = working.filter((a) => a.status === "overtime").length;

  const dragStart = (e: React.DragEvent, employeeId: string) => {
    e.dataTransfer.setData("text/plain", employeeId);
    e.dataTransfer.effectAllowed = "move";
  };
  const readDrag = () => draggedEmployeeId;

  const handleDrop = (target: { areaId: string | null; status: AllocStatus } | "roster") => (employeeId: string) => {
    if (!employeeId) return;
    if (target === "roster") { remove.mutate(employeeId); return; }
    const current = byEmployee.get(employeeId);

    // Overtime says *how* the day counts; the area says *where* they are. They are
    // two answers, and moving somebody between lines only changes the second — so an
    // overtime person dragged onto Line 2 stays overtime and simply moves. Before,
    // every area drop wrote "assigned" and quietly cancelled the overtime.
    const status: AllocStatus =
      target.status === "assigned" && current?.status === "overtime" ? "overtime" : target.status;

    // Marking somebody overtime from the Overtime card keeps the area they are on,
    // for the same reason. Absence and holiday do clear it: they are not at a place.
    const areaId = target.status === "overtime"
      ? target.areaId ?? current?.area_id ?? null
      : target.areaId;

    place.mutate({ employeeId, areaId, status });
  };

  const term = find.trim().toLowerCase();
  const isDimmed = (n: string) => !!term && !n.toLowerCase().includes(term);

  const look = LOOK[shift] ?? LOOK.Day;
  const ShiftIcon = look.icon;

  if (rosterLoading || allocLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-4">
      {/* Says whose board this is before a single column is read.
          It used to be a full-width colour slab in white type. The colour is doing
          real work — in Split the two boards are otherwise identical grids side by
          side — so it stays, as a rule down the edge and a tinted icon rather than
          the loudest thing on the screen. */}
      <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-l-4 bg-card px-4 py-2.5", look.rule)}>
        <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", look.chip)}>
          <ShiftIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-tight">{shift} shift</h3>
          <div className="truncate text-2xs text-muted-foreground">{dayTypeLabel(onDate)}</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="h-8 print:hidden"
            onClick={() => setShowAll((v) => !v)}
            title={showAll ? "Only the people the rota puts in today" : "Everyone on this shift, rota or not"}
          >
            {showAll ? <UserCheck className="mr-2 h-4 w-4" /> : <UserX className="mr-2 h-4 w-4" />}
            {showAll ? "Only today's rota" : "Show everyone"}
          </Button>
          <div className="relative print:hidden">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a person…"
              aria-label="Find a person on the board"
              className="h-8 w-44 pl-8 text-xs"
            />
          </div>
          {canManage && (
            <Button size="sm" variant="outline" className="h-8 print:hidden" onClick={() => copyLastLikeDay.mutate()} disabled={copyLastLikeDay.isPending}>
              <CopyPlus className="mr-2 h-4 w-4" />
              Copy from last same day
            </Button>
          )}
          {/* The two numbers side by side, because apart they invite the wrong sum:
              46 assigned out of 82 due in is a shift half planned, and "46" alone
              reads like the whole answer. The rest of the rota is named underneath so
              nobody has to work out where the other 36 went. */}
          <div className={cn("rounded-lg px-3 py-1.5 text-right", look.soft)}>
            <div className="flex items-baseline justify-end gap-1.5">
              <b className={cn("font-mono text-xl font-extrabold leading-none tabular-nums", look.ink)}>{assignedCount}</b>
              <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                / {roster.length} {showAll ? "on this shift" : "on the rota"}
              </span>
            </div>
            <div className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-border">
              <div
                className={cn("h-full rounded-full", look.rule.replace("border-l-", "bg-"))}
                style={{ width: `${roster.length ? Math.min(100, (assignedCount / roster.length) * 100) : 0}%` }}
              />
            </div>
            <div className="mt-1 text-2xs text-muted-foreground">
              {unassigned.length} unallocated · {away} away
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <KpiPill icon={Users} label="Total staff in production" value={assignedCount} tone={cn(look.soft, look.ink)} highlight />
        <KpiPill icon={Factory} label="On lines" value={onLines} tone="" />
        <KpiPill icon={Wrench} label="Support" value={support} tone="" />
        <KpiPill icon={PlaneTakeoff} label="Away" value={away} tone="" valueTone={away ? "text-warning-strong" : ""} />
        <KpiPill icon={Clock3} label="Overtime" value={overtime} tone="" valueTone={overtime ? "text-violet-600 dark:text-violet-400" : ""} />
      </div>

      {SECTIONS.map((section) => {
        const ofKind = areas.filter((a) => blockOf(a) === section.key);
        if (ofKind.length === 0) return null;
        const open = openSections[section.key] !== false;
        const inSection = ofKind.reduce((n, a) => n + peopleIn(a.id).length, 0);
        return (
        <div key={section.key}>
        <SectionLabel
          accent={section.accent}
          count={inSection}
          open={open}
          onToggle={() => setOpenSections((o) => ({ ...o, [section.key]: !open }))}
        >
          {section.label}
        </SectionLabel>
        {open && (<>
        <DndContext
          sensors={columnSensors}
          collisionDetection={closestCenter}
          onDragEnd={(e: DragEndEvent) => {
            const { active, over } = e;
            if (!over || active.id === over.id) return;
            const ids = ofKind.map((a) => a.id);
            const moved = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
            // Renumbered in tens, leaving room to slide something in later without
            // rewriting the whole section.
            reorder.mutate(moved.map((id, i) => ({ id, sort_order: (i + 1) * 10 })));
          }}
        >
        <SortableContext items={ofKind.map((a) => a.id)} strategy={rectSortingStrategy}>
        {/* Packs as many line columns across as the screen allows. Capping this at
            three put Line 4 onto a second row on a monitor with room for six. */}
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
        {ofKind.map((area) => {
          const people = peopleIn(area.id);
          return (
            <SortableColumn key={area.id} id={area.id}>
            {(grip) => (
            <DropZone
              disabled={!canManage}
              onDrop={() => handleDrop({ areaId: area.id, status: "assigned" })(readDrag() ?? "")}
            >
              <Card className={cn("h-full overflow-hidden border-l-4", area.kind === "production" ? "border-l-primary" : "border-l-slate-400")}>
                <CardHeader
                  className={cn("flex flex-row items-center justify-between gap-2 space-y-0 border-b px-2.5 py-2", area.kind === "production" ? "bg-primary/5" : "bg-muted", canManage && "cursor-pointer hover:brightness-95")}
                  onClick={canManage ? () => setPicking({ id: area.id, name: area.name }) : undefined}
                  title={canManage ? `Add or remove people on ${area.name}` : undefined}
                >
                  {canManage && grip}
                  <CardTitle className="truncate text-sm font-bold">{area.name}</CardTitle>
                  <span className={cn(
                    "grid h-6 min-w-[1.75rem] shrink-0 place-items-center rounded-full border bg-background px-2 font-mono text-sm font-bold",
                    people.length ? (area.kind === "production" ? "text-primary" : "text-foreground") : "text-muted-foreground/50",
                  )}>
                    {people.length}
                  </span>
                </CardHeader>
                {/* An empty column shrinks instead of holding a hole the size of a
                    full one. Twenty areas at 76px of nothing is most of a screen. */}
                <CardContent className={cn("p-2", people.length === 0 ? "min-h-[52px]" : "min-h-[80px]")}>
                  <div className="flex flex-col gap-1.5">
                    {people.map(({ person: p, overtime: isOt, leader: leadsToday }) => (
                      <Chip
                        key={p.id}
                        name={p.full_name}
                        leader={leadsToday || isLeader(p.department)}
                        role={roleStripe(p.department)}
                        dimmed={isDimmed(p.full_name)}
                        overtime={isOt}
                        leftEarlyAt={byEmployee.get(p.id)?.left_early_at ?? null}
                        crew={crewBadge(p.shift_group)}
                        onOpen={() => setEditing(p.id)}
                        tone={area.kind === "production" ? "production" : "support"}
                        draggable={canManage}
                        onDragStart={(e) => {
                          draggedEmployeeId = p.id;
                          dragStart(e, p.id);
                        }}
                      />
                    ))}
                    {people.length === 0 && (
                      <span className="flex h-9 items-center justify-center rounded-lg border border-dashed text-2xs text-muted-foreground/70">
                        Drop people here
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </DropZone>
            )}
            </SortableColumn>
          );
        })}
        </div>
        </SortableContext>
        </DndContext>
        </>)}
        </div>
        );
      })}

      {/* Filling a line by dragging seventy cards is the reason people go back to the
          spreadsheet. The column heading opens a search over the whole shift — the same
          picker the Workforce daily board uses, so the two behave alike. */}
      {picking && (
        <AreaPicker
          areaId={picking.id}
          areaName={picking.name}
          open
          onOpenChange={(v) => !v && setPicking(null)}
          // Everyone active, not only this shift's crew. Somebody called in from the
          // weekend crew onto a Monday is a real thing the factory does — and a picker
          // that cannot find them is a picker that sends people back to the sheet.
          // Whose crew they are is shown, so bringing one across is a visible choice.
          people={[...(everyoneById?.values() ?? [])].map((e) => {
            const current = byEmployee.get(e.id)?.area_id ?? null;
            const theirs = onShift.find((o) => o.id === e.id);
            return {
              ...e,
              currentAreaId: current,
              currentAreaName: current ? areas.find((a) => a.id === current)?.name ?? null : null,
              offRota: theirs?.offRota ?? false,
              otherShift: theirs ? null : e.shift_group,
            };
          })}
          onToggle={(person, toAreaId) => {
            if (!toAreaId) { remove.mutate(person.id); return; }
            // Same rule as the drag: placing somebody who is on overtime moves them,
            // it does not take the overtime off them.
            const wasOvertime = byEmployee.get(person.id)?.status === "overtime";
            place.mutate({
              employeeId: person.id,
              areaId: toAreaId,
              status: wasOvertime ? "overtime" : "assigned",
            });
          }}
        />
      )}

      {/* The same picker, writing a state instead of an area. Marking Holiday here is
          the quick call somebody makes when a person does not appear; the Leave screen
          is the formal request with a balance behind it. Both write the same
          `daily_allocations.status`, so the board cannot end up telling two stories. */}
      {pickingAway && (
        <AreaPicker
          areaId={`away:${pickingAway.status}`}
          areaName={pickingAway.label}
          open
          onOpenChange={(v) => !v && setPickingAway(null)}
          people={[...(everyoneById?.values() ?? [])].map((e) => {
            const alloc = byEmployee.get(e.id);
            const here = alloc?.status === pickingAway.status;
            const theirs = onShift.find((o) => o.id === e.id);
            return {
              ...e,
              // The picker ticks by area id, so the block borrows one. Somebody
              // already in this block reads as ticked; somebody on a line shows the
              // line they are on, so moving them is a visible choice rather than a
              // silent one.
              currentAreaId: here ? `away:${pickingAway.status}` : alloc?.area_id ?? null,
              currentAreaName: here
                ? pickingAway.label
                : alloc?.area_id ? areas.find((a) => a.id === alloc.area_id)?.name ?? null : null,
              offRota: theirs?.offRota ?? false,
              otherShift: theirs ? null : e.shift_group,
            };
          })}
          onToggle={(person, to) => {
            if (!to) { remove.mutate(person.id); return; }
            place.mutate({ employeeId: person.id, areaId: null, status: pickingAway.status });
          }}
        />
      )}

      {editing && (() => {
        const person = employeeById.get(editing);
        const alloc = byEmployee.get(editing);
        if (!person) return null;
        // Postgres hands back `14:00:00`; the time input wants `14:00`.
        const leftEarly = alloc?.left_early_at ? alloc.left_early_at.slice(0, 5) : null;
        return (
          <PersonDayDialog
            open
            onOpenChange={(v) => !v && setEditing(null)}
            name={person.full_name}
            shiftGroup={person.shift_group}
            status={(alloc?.status as AllocStatus | undefined) ?? null}
            areaId={alloc?.area_id ?? null}
            areas={areas}
            canManage={canManage}
            halfDay={alloc?.half_day === true}
            onSetHalfDay={(v) => place.mutate({
              employeeId: editing,
              areaId: alloc?.area_id ?? null,
              status: (alloc?.status as AllocStatus | undefined) ?? "unpaid",
              halfDay: v,
              leftEarlyAt: leftEarly,
            })}
            leftEarlyAt={leftEarly}
            onSetLeftEarlyAt={(v) => place.mutate({
              employeeId: editing,
              areaId: alloc?.area_id ?? null,
              status: (alloc?.status as AllocStatus | undefined) ?? "assigned",
              halfDay: alloc?.half_day === true,
              leftEarlyAt: v,
            })}
            onSetStatus={(st) => place.mutate({
              employeeId: editing,
              // Overtime is still a place; absence and holiday are not.
              areaId: st === "assigned" || st === "overtime" ? alloc?.area_id ?? null : null,
              status: st,
              halfDay: alloc?.half_day === true,
              // Carried, not dropped: the upsert writes every column, so leaving it
              // out would silently clear an early finish somebody had recorded. The
              // mutation itself drops it when the status stops being a day worked.
              leftEarlyAt: leftEarly,
            })}
            onSetArea={(id) => place.mutate({
              employeeId: editing,
              areaId: id,
              status: alloc?.status === "overtime" ? "overtime" : "assigned",
              halfDay: alloc?.half_day === true,
              leftEarlyAt: leftEarly,
            })}
            onSetShift={(sg) => changeShift.mutate({ employeeId: editing, shiftGroup: sg })}
            patterns={patterns}
            patternId={person.shift_pattern_id}
            onSetPattern={(id) => setPattern.mutate({ employeeId: editing, patternId: id })}
            isLeader={!!alloc?.is_leader}
            onSetLeader={(v) => setLeader.mutate({ employeeId: editing, areaId: alloc?.area_id ?? null, leader: v })}
            onRemove={() => { remove.mutate(editing); setEditing(null); }}
          />
        );
      })()}

      <SectionLabel>Away &amp; overtime</SectionLabel>
      {/* Three blocks sharing the width. auto-fill with a 200px minimum left an empty
          track on anything wider than a laptop: three cards against the left edge
          with a hole beside them. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AWAY_BLOCKS.map((block) => {
          const people = peopleWith(block.status);
          return (
            <DropZone
              key={block.status}
              disabled={!canManage}
              onDrop={() => handleDrop({ areaId: null, status: block.status })(readDrag() ?? "")}
            >
              <Card className={cn("h-full", block.accent)}>
                {/* Clickable like an area column. These blocks only took a drag
                    before, which on a tablet means holding a name and dragging it
                    across the screen — the one gesture gloves are worst at, for the
                    thing done most often when somebody does not turn up. */}
                <CardHeader
                  className={cn(
                    "flex flex-row items-center justify-between gap-2 space-y-0 py-3",
                    canManage && "cursor-pointer hover:brightness-95",
                  )}
                  onClick={canManage ? () => setPickingAway({ status: block.status, label: block.label }) : undefined}
                  title={canManage ? `Add or remove people in ${block.label}` : undefined}
                >
                  <CardTitle className="text-sm font-semibold">{block.label}</CardTitle>
                  <Badge variant="outline" className="tabular-nums">{people.length}</Badge>
                </CardHeader>
                <CardContent className="min-h-[64px] pb-3">
                  <div className="flex flex-wrap gap-1.5">
                    {people.map((p) => (
                      <Chip
                        key={p.id}
                        name={p.full_name}
                        onOpen={() => setEditing(p.id)}
                        dimmed={isDimmed(p.full_name)}
                        role={roleStripe(p.department)}
                        tone={block.status === "overtime" ? "overtime" : "away"}
                        half={byEmployee.get(p.id)?.half_day === true}
                        leftEarlyAt={byEmployee.get(p.id)?.left_early_at ?? null}
                        crew={crewBadge(p.shift_group)}
                        draggable={canManage}
                        onDragStart={(e) => {
                          draggedEmployeeId = p.id;
                          dragStart(e, p.id);
                        }}
                      />
                    ))}
                    {people.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                  </div>
                </CardContent>
              </Card>
            </DropZone>
          );
        })}
      </div>

    </div>
  );
}

export default function ProductionHeadcountPage() {
  const qc = useQueryClient();
  const { can } = useRole();
  const canManage = can("headcount.manage");
  const [date, setDate] = useState<string>(() => toISO(new Date()));
  const [view, setView] = useState<ViewKey>("Day");
  const { data: areas = [], isLoading } = useHeadcountAreas();

  // Split shows two boards at once, so the sheet takes the Day one — a workbook has
  // to be one shift per file for the import to know what it is reading back.
  const sheetShift: ShiftKey = view === "Split" ? "Day" : (view as ShiftKey);
  const [sheet, setSheet] = useState<"export" | "import" | null>(null);
  const { data: sheetRoster = [] } = useShiftRoster(sheetShift, date, true);

  const shiftDate = (delta: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(toISO(d));
  };

  return (
    // The whole workforce section behind one PIN. These four screens name every
    // employee beside their hours, their sickness and what they are owed, and the
    // board is now the way in to the other three.
    //
    // One key, not four: they are tabs of one screen, and asking again on every tab
    // is the friction that makes somebody prop the door open — a PIN typed four times
    // an hour stops being a lock and becomes a habit.
    <AdminPinGate
      storageKey="workforce"
      title="Production Headcount"
      description="The board and the workforce screens behind it. Enter the admin PIN to open."
    >
    <div className="space-y-4">
      {/* Above the banner rather than inside it: the banner is navy, and a ghost
          button on it reads as disabled. Same component and same position as every
          other screen, so leaving the board is where the hand already expects it —
          the board scrolls for twenty columns and the shell's Back is a long way up. */}
      <BackButton className="no-print" />
      <WorkforceTabs />

      <div className="rounded-xl bg-[hsl(215_60%_18%)] p-4 text-white shadow-sm print:bg-white print:text-black">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Production Headcount</h1>
            <p className="text-xs text-white/70 print:text-black">Daily allocation of people to production and support areas</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-white/10 p-1 print:bg-transparent">
              <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20 print:hidden" onClick={() => shiftDate(-1)} aria-label="Previous day">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[9.5rem] text-center text-sm font-semibold tabular-nums">{formatLong(date)}</span>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20 print:hidden" onClick={() => shiftDate(1)} aria-label="Next day">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Badge variant="outline" className="border-white/40 text-white print:text-black">{dayTypeLabel(date)}</Badge>
            <Button size="sm" variant="secondary" className="print:hidden" onClick={() => setSheet("export")}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            {canManage && (
              <Button size="sm" variant="secondary" className="print:hidden" onClick={() => setSheet("import")}>
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
            )}
            <Button size="sm" variant="secondary" className="print:hidden" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as ViewKey)} className="print:hidden">
        <TabsList>
          {/* Two boards, not four. Day carries everybody whose shift runs while the
              lines do — Mon–Thu, Fri–Mon and the warehouse — which is how the
              factory's own sheets are drawn. Each card says which crew. */}
          <TabsTrigger value="Day">Day</TabsTrigger>
          <TabsTrigger value="Night">Night</TabsTrigger>
          <TabsTrigger value="Split">Both</TabsTrigger>
        </TabsList>
      </Tabs>

      {!canManage && (
        <p className="text-xs text-muted-foreground">Read-only view — you don't have permission to change allocations.</p>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : view === "Split" ? (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          <ShiftBoard onDate={date} shift="Day" areas={areas} canManage={canManage} />
          <ShiftBoard onDate={date} shift="Night" areas={areas} canManage={canManage} />
        </div>
      ) : (
        <ShiftBoard onDate={date} shift={view} areas={areas} canManage={canManage} />
      )}

      {/* The board is today; these two are the period it adds up to. Kept on the same
          screen because the questions a supervisor asks after placing people — how long
          is this period, and who is running ahead of their rota — used to mean two
          other pages.
          Both sit inside the PIN gate with the board, which is the point of the gate:
          the shift balance is pay information and does not become less so for being
          further down the page. */}
      <PeriodCalendar />
      <HeadcountOvertimePanel />

      <HeadcountSheetDialog
        open={sheet !== null}
        onOpenChange={(v) => !v && setSheet(null)}
        mode={sheet ?? "export"}
        date={date}
        shift={sheetShift}
        areas={areas}
        roster={sheetRoster}
        canManage={canManage}
        onImported={() => qc.invalidateQueries({ queryKey: ["allocations"] })}
      />
    </div>
    </AdminPinGate>
  );
}
