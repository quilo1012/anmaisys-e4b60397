import { useMemo, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Columns2, GripVertical, Moon, Search, Sun, UserCheck, UserX, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";
import { roleStripe, type RoleStripe } from "@/lib/workforceRoles";
import { AreaPicker } from "./AreaPicker";
import {
  useHeadcountAreas, useMoveEmployee, useSetAttendance, describeDays, worksOn,
  useShiftHistory, useShiftPatterns, resolveShiftOn,
  type Attendance, type AttendanceStatus, type Employee, type HeadcountArea, type ShiftPattern,
} from "@/hooks/useWorkforce";

const UNPLACED = "__unplaced__";

/**
 * The shifts this board plans for, in the order the factory says them.
 *
 * Weekend and Warehouse Weekend are recorded on people and counted everywhere else —
 * 46 of the 193 — but they are not planned here. They are left out of the board, not
 * out of the database.
 */
const BOARD_SHIFTS = ["Day", "Night", "Warehouse Day"] as const;

/** Day and Night, side by side. The handover is the one moment both are the answer. */
const SPLIT = "__split__";

/**
 * A shift is a place, not a filter, and it should look like one.
 *
 * The banner colour is the whole point of the split view: two boards of identical
 * grey columns side by side are one board twice the size, and the eye has to read a
 * heading to know which factory it is looking at.
 */
const SHIFT_LOOK: Record<string, { icon: typeof Sun; banner: string; soft: string; ink: string }> = {
  Day: {
    icon: Sun,
    banner: "from-amber-600 to-amber-400",
    soft: "bg-amber-500/10",
    ink: "text-warning-strong",
  },
  Night: {
    icon: Moon,
    banner: "from-indigo-900 to-indigo-500",
    soft: "bg-indigo-500/10",
    ink: "text-indigo-700 dark:text-indigo-300",
  },
  "Warehouse Day": {
    icon: Warehouse,
    banner: "from-orange-700 to-orange-400",
    soft: "bg-orange-500/10",
    ink: "text-orange-700 dark:text-orange-300",
  },
};

const STATUS_META: Record<AttendanceStatus, { label: string; cls: string }> = {
  present:  { label: "In",       cls: "border-emerald-500/40 bg-emerald-500/15 text-success-strong" },
  absent:   { label: "Absent",   cls: "border-red-500/40 bg-red-500/15 text-destructive-strong" },
  sick:     { label: "Sick",     cls: "border-amber-500/40 bg-amber-500/15 text-warning-strong" },
  holiday:  { label: "Holiday",  cls: "border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  training: { label: "Training", cls: "border-purple-500/40 bg-purple-500/15 text-purple-700 dark:text-purple-300" },
  // Agreed and unpaid, which is not the same as an absence nobody agreed to.
  unpaid:   { label: "Unpaid",   cls: "border-slate-500/40 bg-slate-500/15 text-muted-foreground" },
};

/** The four kinds of column, and the stripe each one carries. */
const COLUMN_KIND = {
  production: { stripe: "border-l-primary",      head: "bg-primary/5",       ct: "text-primary" },
  support:    { stripe: "border-l-slate-400",    head: "bg-muted",           ct: "text-foreground" },
  away:       { stripe: "border-l-amber-500",    head: "bg-amber-500/10",    ct: "text-warning-strong" },
  overtime:   { stripe: "border-l-violet-500",   head: "bg-violet-500/10",   ct: "text-violet-700 dark:text-violet-300" },
} as const;
type ColumnKind = keyof typeof COLUMN_KIND;

// No overtime balance here on purpose. The board answers who is in today; the balance
// is imported from payroll over a period that is not this day, and carrying it on the
// same card is what made the two look like one number.
export interface BoardEmployee extends Employee {
  pattern: ShiftPattern | null;
}

/** Two letters, for the square that sits where a role stripe does not. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Every status, on a menu.
 *
 * It used to cycle: one click In, another Absent, six to get back. Nobody can see a
 * cycle, so the two statuses at the front of it were the only two that got used, and
 * Holiday was five clicks away from a supervisor who had one hand on a tablet.
 */
const STATUS_ORDER: AttendanceStatus[] = ["present", "absent", "sick", "holiday", "unpaid", "training"];

function EmployeeCard({
  employee, attendance, onSetStatus, onSelect, canEdit, dragging, offRota, dimmed, readOnly,
}: {
  employee: BoardEmployee;
  attendance: Attendance | undefined;
  onSetStatus: (status: AttendanceStatus) => void;
  onSelect?: () => void;
  canEdit: boolean;
  dragging?: boolean;
  /** Working a day their own rota does not cover. */
  offRota?: boolean;
  /** Somebody is searching and it is not this person. */
  dimmed?: boolean;
  /** A roll-up copy of a card that lives somewhere else — no grip, no status. */
  readOnly?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: employee.id, disabled: !canEdit || readOnly,
  });
  const status = attendance?.status;
  const role = roleStripe(employee.department);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border bg-muted/20 px-1.5 py-1 text-left transition-opacity",
        (isDragging || dragging) && "opacity-50",
        dimmed && "opacity-20",
        status === "absent" && "border-destructive/40",
      )}
    >
      {/* One line per person. Department and shift pattern moved to the tooltip and
          the detail panel: on a board of 68 cards, "Department to confirm" repeated
          138 times is not information, it is noise with a scrollbar. */}
      <div className="flex items-center gap-1">
        {canEdit && !readOnly && (
          <button
            type="button"
            className="shrink-0 cursor-grab touch-none text-muted-foreground/60 hover:text-foreground active:cursor-grabbing no-print"
            aria-label={`Move ${employee.full_name}`}
            {...listeners}
            {...attributes}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        {/* The role rides on the name, the way a label does on a Trello card: the
            colour and the three letters carry it, and the full title is on hover.
            Anyone without a named role gets their initials, so every card keeps the
            same shape and the column reads as one list rather than two. */}
        {role ? (
          <span
            title={role.label}
            className={cn(
              "grid h-5 shrink-0 place-items-center rounded-md px-1 text-[9px] font-bold uppercase leading-none tracking-wide",
              role.cls,
            )}
          >
            {role.short}
          </span>
        ) : (
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-muted text-[9px] font-bold leading-none text-muted-foreground">
            {initials(employee.full_name)}
          </span>
        )}
        {/* The name opens the detail panel; the grip drags. Two targets, so a tap on
            a tablet never has to guess which one was meant. */}
        <button
          type="button"
          onClick={onSelect}
          title={[employee.full_name, role?.label ?? employee.department, employee.pattern ? describeDays(employee.pattern.days) : "No shift pattern"]
            .filter(Boolean)
            .join(" · ")}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium hover:underline"
        >
          {employee.full_name}
        </button>
        {/* Derived, never typed. Their rota does not cover this day and somebody put
            them on a line anyway, which is what an overtime day is. It says the day
            is one, not how many hours it was worth — hours come from payroll. */}
        {offRota && !readOnly && (
          <span
            title="Working outside their own rota — an overtime day. Hours still come from the payroll sheet."
            className="shrink-0 rounded border border-violet-500/50 bg-violet-500/15 px-1 py-px text-[9px] font-bold uppercase leading-tight text-violet-700 dark:text-violet-300"
          >
            OT day
          </span>
        )}
        {readOnly ? null : !canEdit ? (
          status && (
            <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-2xs font-semibold", STATUS_META[status].cls)}>
              {STATUS_META[status].label}
            </span>
          )
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "shrink-0 rounded border px-1.5 py-0.5 text-2xs font-semibold",
                  status
                    ? STATUS_META[status].cls
                    : "border-dashed text-muted-foreground hover:text-foreground no-print",
                )}
              >
                {status ? STATUS_META[status].label : "Mark"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[9rem]">
              {STATUS_ORDER.map((s) => (
                <DropdownMenuItem key={s} onSelect={() => onSetStatus(s)} className="text-xs">
                  <span className={cn("mr-2 h-2.5 w-2.5 rounded-sm border", STATUS_META[s].cls)} />
                  {STATUS_META[s].label}
                  {s === status && <span className="ml-auto text-2xs text-muted-foreground">now</span>}
                </DropdownMenuItem>
              ))}
              {/* The rota is the reason, not a status somebody types: this only shows
                  for somebody working a day their own pattern does not cover. */}
              {offRota && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-2xs text-muted-foreground">
                    Not their rota today — marking them In records an overtime day.
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

/**
 * One column of the board: a white card with a stripe saying what kind of place it is.
 *
 * Droppable only when it is a place somebody can be put. Absence, Holidays and
 * Overtime are readings of the day, not destinations — dropping a name into
 * "Holidays" would be booking leave by drag, which is not what that column means.
 */
function BoardColumn({
  dropId, title, kind, count, children, onOpen, compact, note,
}: {
  dropId?: string;
  title: string;
  kind: ColumnKind;
  count: number;
  children: React.ReactNode;
  onOpen?: () => void;
  compact?: boolean;
  note?: string;
}) {
  const look = COLUMN_KIND[kind];
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? `nodrop:${title}`, disabled: !dropId });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-l-4 bg-card shadow-sm transition-colors break-inside-avoid",
        look.stripe,
        isOver && "ring-2 ring-primary",
      )}
    >
      {/* The heading is the way in. Filling a line by dragging sixty-eight cards is
          the reason people go back to the spreadsheet; this opens a search over the
          whole shift instead. */}
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className={cn(
          "flex items-center gap-2 border-b px-2.5 py-2 text-left",
          look.head,
          onOpen && "hover:brightness-95",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate font-bold leading-tight", compact ? "text-2xs" : "text-xs")}>
          {title}
        </span>
        <span
          className={cn(
            "grid h-5 min-w-[1.5rem] shrink-0 place-items-center rounded-full border bg-background px-1.5 font-mono text-xs font-bold",
            count > 0 ? look.ct : "text-muted-foreground/50",
          )}
        >
          {count}
        </span>
      </button>
      {note && <div className="border-b px-2.5 py-1 text-[10px] text-muted-foreground">{note}</div>}
      {/* Capped and scrolled inside, so one crowded line does not stretch the row it
          sits in and leave nine short columns padded out beside it. */}
      <div className="flex max-h-80 min-h-[2.5rem] flex-col gap-1 overflow-y-auto p-2 print:max-h-none print:overflow-visible">
        {count === 0 ? <span className="py-1 text-center text-sm text-muted-foreground/40">—</span> : children}
      </div>
    </div>
  );
}

/**
 * People this shift who are not on a line yet.
 *
 * Horizontal and dense, so forty of them do not push the lines off the screen, and
 * droppable so somebody can be sent back here after being placed by mistake.
 */
function UnplacedTray({
  dropId, count, canEdit, children,
}: {
  dropId: string; count: number; canEdit: boolean; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "mb-3 rounded-xl border border-dashed bg-muted/20 p-2 transition-colors",
        isOver && "border-primary bg-primary/5",
      )}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Not on a line
        </span>
        <span className="font-mono text-xs text-muted-foreground">{count}</span>
        {canEdit && (
          <span className="text-2xs text-muted-foreground no-print">
            Drag onto a line below to place them
          </span>
        )}
      </div>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {children}
      </div>
    </div>
  );
}

/** Everything one shift's board needs, worked out from data fetched once. */
interface ShiftData {
  shift: string;
  scheduled: BoardEmployee[];
  /** areaId (or UNPLACED) → the people working there today. */
  columns: Map<string, BoardEmployee[]>;
  away: BoardEmployee[];
  holidays: BoardEmployee[];
  overtime: BoardEmployee[];
  totals: { assigned: number; onLines: number; support: number; away: number; overtime: number; unmarked: number };
  rotas: string[];
  emptyReason: string | null;
}

/**
 * Who is where on one shift, on one day.
 *
 * A pure function rather than a hook, so the split view can run it twice without
 * either board owning a query. Everything it reads was fetched once by the board.
 */
function computeShift(
  shift: string,
  ctx: {
    employees: BoardEmployee[];
    attendance: Attendance[];
    areas: HeadcountArea[];
    allPatterns: ShiftPattern[];
    history: Parameters<typeof resolveShiftOn>[0];
    onDate: Date;
    showAll: boolean;
  },
): ShiftData {
  const { employees, attendance, areas, allPatterns, history, onDate, showAll } = ctx;
  const key = onDate.toISOString().slice(0, 10);
  const byId = new Map(attendance.map((a) => [a.employee_id, a]));

  /**
   * The shift and rota each person held on the day being shown, not the one they hold
   * now. Somebody moved from nights to days in August was on nights in July, and the
   * July board has to keep saying so.
   */
  const patternOf = (e: BoardEmployee) => {
    const pos = resolveShiftOn(history, e, key);
    return pos.shift_pattern_id === e.shift_pattern_id
      ? e.pattern
      : allPatterns.find((p) => p.id === pos.shift_pattern_id) ?? null;
  };

  const scheduled = employees.filter((e) => {
    if (!e.active) return false;
    if (resolveShiftOn(history, e, key).shift_group !== shift) return false;
    const pattern = patternOf(e);
    return showAll || !pattern || worksOn(pattern.days, onDate);
  });

  /**
   * Where somebody is on the day being shown.
   *
   * The day's own allocation wins. The employee's area is only a default — where they
   * usually are — and it seeds a day nobody has touched yet so the board opens
   * pre-filled instead of empty every morning. Reading the default as though it were
   * the day's record is what made moving somebody on Tuesday rewrite Monday.
   */
  const areaOf = (e: BoardEmployee) => byId.get(e.id)?.headcount_area_id ?? e.headcount_area_id ?? null;

  /**
   * Away comes off the lines, the way it does on the spreadsheet.
   *
   * A line that reads 5 with one of them at home is not a line of five. Their
   * allocation is untouched underneath — mark them back in and they return to the
   * column they were placed on, because being absent is not being unplaced.
   */
  const isAway = (e: BoardEmployee) => ["absent", "sick", "unpaid"].includes(byId.get(e.id)?.status ?? "");
  const isHoliday = (e: BoardEmployee) => byId.get(e.id)?.status === "holiday";

  const working = scheduled.filter((e) => !isAway(e) && !isHoliday(e));

  const columns = new Map<string, BoardEmployee[]>();
  columns.set(UNPLACED, []);
  for (const a of areas) columns.set(a.id, []);
  for (const e of working) {
    const area = areaOf(e);
    columns.get(area && columns.has(area) ? area : UNPLACED)!.push(e);
  }

  const productionIds = new Set(areas.filter((a) => a.kind === "production").map((a) => a.id));
  let onLines = 0;
  let support = 0;
  for (const [id, people] of columns) {
    if (id === UNPLACED) continue;
    if (productionIds.has(id)) onLines += people.length;
    else support += people.length;
  }

  const away = scheduled.filter(isAway);
  const holidays = scheduled.filter(isHoliday);
  /**
   * Working a day their own rota does not cover — a call-in. They stay on the line
   * they are working; this column is a reading of it, not another place to be, which
   * is why the count is not added to anything.
   */
  const overtime = working.filter((e) => {
    const pattern = patternOf(e);
    return !!pattern && !worksOn(pattern.days, onDate);
  });

  const rotas = Array.from(
    new Set(scheduled.map((e) => patternOf(e)?.name).filter(Boolean) as string[]),
  );

  /**
   * Why the board is empty, when it is.
   *
   * A shift whose rota does not cover the chosen day is genuinely nobody, and the
   * honest count is zero — but a screen full of zeros reads as broken software. This
   * says which rota and which weekday, so the answer is "nobody works Sunday
   * nights", not "the counters are wrong".
   */
  let emptyReason: string | null = null;
  if (scheduled.length === 0 && !showAll) {
    const onThisShift = employees.filter((e) => e.active && e.shift_group === shift);
    const weekday = onDate.toLocaleDateString("en-GB", { weekday: "long" });
    const named = Array.from(new Set(onThisShift.map((e) => e.pattern?.name).filter(Boolean) as string[]));
    emptyReason = onThisShift.length === 0
      ? `Nobody is on the ${shift} shift.`
      : named.length
        ? `${onThisShift.length} people are on the ${shift} shift, and no ${named.join(" / ")} rota covers ${weekday}.`
        : `${onThisShift.length} people are on the ${shift} shift and none of them has a rota recorded.`;
  }

  return {
    shift,
    scheduled,
    columns,
    away,
    holidays,
    overtime,
    totals: {
      assigned: onLines + support,
      onLines,
      support,
      away: away.length,
      overtime: overtime.length,
      unmarked: scheduled.filter((e) => !byId.has(e.id)).length,
    },
    rotas,
    emptyReason,
  };
}

/**
 * Who is on which line today.
 *
 * The board shows the people whose shift pattern covers the chosen day, because a
 * board that lists everyone on the payroll is a list, not a plan for the shift. The
 * ones with no pattern yet are shown too — they are not "off", they are unrecorded,
 * and hiding them would quietly shrink the headcount.
 */
export function HeadcountBoard({
  employees, attendance, onDate, canEdit, userId, onSelect,
}: {
  employees: BoardEmployee[];
  attendance: Attendance[];
  onDate: Date;
  canEdit: boolean;
  userId?: string | null;
  onSelect?: (employeeId: string) => void;
}) {
  const { data: areas } = useHeadcountAreas();
  const { data: history } = useShiftHistory();
  const { data: allPatterns } = useShiftPatterns();
  const move = useMoveEmployee();
  const setAttendance = useSetAttendance(onDate.toISOString().slice(0, 10));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState<string>("Day");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState<{ id: string; name: string; shift: string } | null>(null);

  const sensors = useSensors(
    // A small distance so a tap on the card's buttons is not read as a drag on a
    // tablet, which is where this board will actually be used.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const attendanceByEmployee = useMemo(
    () => new Map(attendance.map((a) => [a.employee_id, a])),
    [attendance],
  );

  /** The shifts on screen. One, or Day and Night together at handover. */
  const shownShifts = useMemo(
    () => (view === SPLIT ? ["Day", "Night"] : [view]),
    [view],
  );

  const boards = useMemo(
    () =>
      shownShifts.map((s) =>
        computeShift(s, {
          employees,
          attendance,
          areas: areas ?? [],
          allPatterns: allPatterns ?? [],
          history,
          onDate,
          showAll,
        }),
      ),
    [shownShifts, employees, attendance, areas, allPatterns, history, onDate, showAll],
  );

  // Counted before the shift filter, so the tabs keep their numbers when one is
  // selected — a tab that reads 0 because you are standing on another one is a lie.
  const shiftCounts = useMemo(() => {
    const base = employees.filter((e) => e.active && (showAll || !e.pattern || worksOn(e.pattern.days, onDate)));
    const counts = new Map<string, number>();
    for (const g of BOARD_SHIFTS) counts.set(g, base.filter((e) => e.shift_group === g).length);
    counts.set("__none__", base.filter((e) => !e.shift_group).length);
    return counts;
  }, [employees, onDate, showAll]);

  /** The shifts that exist on people but are deliberately not planned on this board. */
  const offBoard = useMemo(() => {
    const planned = new Set<string>(BOARD_SHIFTS);
    const counts = new Map<string, number>();
    for (const e of employees) {
      if (!e.active || !e.shift_group || planned.has(e.shift_group)) continue;
      counts.set(e.shift_group, (counts.get(e.shift_group) ?? 0) + 1);
    }
    return Array.from(counts, ([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  }, [employees]);

  const rolesPresent = useMemo(() => {
    const seen = new Map<string, RoleStripe>();
    for (const b of boards) {
      for (const e of b.scheduled) {
        const r = roleStripe(e.department);
        if (r) seen.set(r.label, r);
      }
    }
    return Array.from(seen.values());
  }, [boards]);

  /** Searching dims rather than hides, so a column's count never moves while you type. */
  const term = query.trim().toLowerCase();
  const isDimmed = (e: BoardEmployee) => !!term && !e.full_name.toLowerCase().includes(term);

  const areaOn = useMemo(() => {
    const byId = new Map((attendance ?? []).map((a) => [a.employee_id, a]));
    return (e: Employee) => byId.get(e.id)?.headcount_area_id ?? e.headcount_area_id ?? null;
  }, [attendance]);

  const isOffRota = useMemo(() => {
    const key = onDate.toISOString().slice(0, 10);
    return (e: BoardEmployee) => {
      const pos = resolveShiftOn(history, e, key);
      const pattern = pos.shift_pattern_id === e.shift_pattern_id
        ? e.pattern
        : (allPatterns ?? []).find((p) => p.id === pos.shift_pattern_id) ?? null;
      return !!pattern && !worksOn(pattern.days, onDate);
    };
  }, [history, allPatterns, onDate]);

  const markStatus = (employeeId: string, status: AttendanceStatus) => {
    setAttendance.mutate({ employeeId, status }, {
      onError: (e) => toast.error((e as Error).message || "Could not save attendance"),
    });
  };

  /** One path for both ways of moving somebody: the drag and the search. */
  const moveTo = (employee: Employee, toLineId: string | null) => {
    const wasOn = areaOn(employee);
    if (wasOn === toLineId) return;
    const nameOf = (id: string | null) => (id ? areas?.find((a) => a.id === id)?.name ?? null : null);
    move.mutate(
      {
        employee,
        toLineId,
        onDate: onDate.toISOString().slice(0, 10),
        fromLineName: nameOf(wasOn),
        toLineName: nameOf(toLineId),
        movedBy: userId ?? null,
        keepStatus: attendanceByEmployee.get(employee.id)?.status ?? null,
      },
      {
        onSuccess: () => toast.success(`${employee.full_name} → ${nameOf(toLineId) ?? "not on an area"}`),
        onError: (e) => toast.error((e as Error).message || "Could not move"),
      },
    );
  };

  /**
   * Droppable ids carry their shift, because in the split view both boards draw the
   * same areas and two droppables cannot share an id. The area is the same place
   * either way — the prefix only keeps the two grids apart.
   */
  const dropId = (shift: string, areaId: string) => `${shift}|${areaId}`;

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const target = event.over ? String(event.over.id) : null;
    if (!target || target.startsWith("nodrop:")) return;
    const employee = employees.find((e) => e.id === String(event.active.id));
    if (!employee) return;
    const areaId = target.slice(target.indexOf("|") + 1);
    moveTo(employee, areaId === UNPLACED ? null : areaId);
  };

  const active = activeId ? employees.find((e) => e.id === activeId) : null;
  const compact = view === SPLIT;

  const card = (e: BoardEmployee, opts?: { readOnly?: boolean }) => (
    <EmployeeCard
      key={e.id}
      employee={e}
      attendance={attendanceByEmployee.get(e.id)}
      onSetStatus={(s) => markStatus(e.id, s)}
      onSelect={() => onSelect?.(e.id)}
      canEdit={canEdit}
      dragging={activeId === e.id}
      offRota={isOffRota(e)}
      dimmed={isDimmed(e)}
      readOnly={opts?.readOnly}
    />
  );

  return (
    <div className="space-y-3">
      {/* ---- Controls: which shift, who you are looking for, and the key ---- */}
      <div className="flex flex-wrap items-center gap-2 no-print">
        <div className="inline-flex gap-1 rounded-xl border bg-card p-1 shadow-sm">
          {BOARD_SHIFTS.map((g) => {
            const look = SHIFT_LOOK[g];
            const Icon = look.icon;
            const n = shiftCounts.get(g) ?? 0;
            const on = view === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setView(g)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                  on ? cn(look.soft, look.ink, "ring-1 ring-inset ring-current/20") : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {g}
                <span className="font-mono opacity-70">{n}</span>
              </button>
            );
          })}
          {/* Handover is the one moment both shifts are the answer to the same
              question, and flipping between two tabs to compare them is how a name
              gets counted twice or not at all. */}
          <button
            type="button"
            onClick={() => setView(SPLIT)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
              view === SPLIT ? "bg-muted text-foreground ring-1 ring-inset ring-border" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Columns2 className="h-3.5 w-3.5" /> Split view
          </button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a person…"
            aria-label="Find a person on the board"
            className="h-9 w-52 pl-8"
          />
        </div>

        <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? <UserCheck className="mr-1 h-4 w-4" /> : <UserX className="mr-1 h-4 w-4" />}
          {showAll ? "Only today's shift" : "Show everyone"}
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
          {([["production", "Production line"], ["support", "Support area"], ["away", "Away"], ["overtime", "Overtime"]] as const).map(
            ([k, label]) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <i className={cn("h-2.5 w-2.5 rounded-sm border-l-4", COLUMN_KIND[k].stripe, COLUMN_KIND[k].head)} />
                {label}
              </span>
            ),
          )}
        </div>
      </div>

      {/* Named rather than left out silently, so the board does not read as the whole
          factory when 46 people are deliberately not on it. */}
      {(offBoard.length > 0 || (shiftCounts.get("__none__") ?? 0) > 0) && (
        <p className="text-2xs text-muted-foreground no-print">
          {offBoard.map((o) => `${o.name} ${o.n}`).join(" · ")}
          {offBoard.length > 0 ? " — recorded, not planned here" : ""}
          {(shiftCounts.get("__none__") ?? 0) > 0
            ? `${offBoard.length ? " · " : ""}${shiftCounts.get("__none__")} with no shift recorded`
            : ""}
        </p>
      )}

      {/* Only the roles actually on screen. A key listing seven colours when four are
          on screen sends somebody hunting for people who are not there. */}
      {rolesPresent.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
          {rolesPresent.map((r) => (
            <span key={r.label} className="flex items-center gap-1.5">
              <span className={cn("rounded-sm px-1 py-px text-[9px] font-bold uppercase leading-tight", r.cls)}>
                {r.short}
              </span>
              {r.label}
            </span>
          ))}
        </div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className={cn(compact && "grid items-start gap-4 xl:grid-cols-2")}>
          {boards.map((b) => {
            const look = SHIFT_LOOK[b.shift] ?? SHIFT_LOOK.Day;
            const Icon = look.icon;
            const unplaced = b.columns.get(UNPLACED) ?? [];
            return (
              <div key={b.shift} className="break-inside-avoid">
                {/* ---- Shift banner ---- */}
                <div className={cn("mb-3 flex items-center gap-3 rounded-xl bg-gradient-to-r px-4 py-3 text-white", look.banner)}>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/20">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-extrabold leading-tight">{b.shift}</h2>
                    {/* The rota, not clock times: the hours are not in the data, and a
                        banner that says 06:00–14:00 because somebody typed it once is
                        a figure the screen cannot stand behind. */}
                    <div className="truncate text-2xs opacity-90">
                      {b.rotas.length ? b.rotas.join(" · ") : "No rota recorded"}
                    </div>
                  </div>
                  <div className="ml-auto shrink-0 text-right">
                    <b className="block font-mono text-2xl font-extrabold leading-none tabular-nums">{b.scheduled.length}</b>
                    <small className="text-[10px] uppercase tracking-wider opacity-90">on shift</small>
                  </div>
                </div>

                {/* ---- KPIs ---- */}
                <div className={cn("mb-4 grid gap-2 grid-cols-2 sm:grid-cols-3", compact ? "xl:grid-cols-3" : "xl:grid-cols-6")}>
                  {[
                    { k: "In production", v: b.totals.assigned, s: "Placed and in", hl: true },
                    { k: "On lines", v: b.totals.onLines, s: "Production areas" },
                    { k: "Support", v: b.totals.support, s: "Support areas" },
                    { k: "Away", v: b.totals.away, s: "Absent, sick, unpaid", tone: b.totals.away ? "text-warning-strong" : "" },
                    { k: "Overtime", v: b.totals.overtime, s: "Working off their rota", tone: b.totals.overtime ? "text-violet-600 dark:text-violet-300" : "" },
                    { k: "Not marked", v: b.totals.unmarked, s: "Nobody has said", tone: b.totals.unmarked ? "text-destructive-strong" : "" },
                  ].map((t) => (
                    <div
                      key={t.k}
                      className={cn("rounded-xl border px-3 py-2 shadow-sm", t.hl ? cn(look.soft, "border-transparent") : "bg-card")}
                    >
                      <div className={cn("font-mono text-2xl font-bold tabular-nums leading-none", t.hl ? look.ink : t.tone)}>
                        {t.v}
                      </div>
                      <div className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t.k}</div>
                      <div className="truncate text-2xs text-muted-foreground">{t.s}</div>
                    </div>
                  ))}
                </div>

                {b.emptyReason && (
                  <div className="mb-3 rounded-xl border border-dashed bg-muted/30 p-3 text-sm">
                    <p className="font-medium">{b.emptyReason}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The zero is the answer, not a fault. Step to a day the rota covers, or use
                      “Show everyone” to see the shift regardless of the day.
                    </p>
                  </div>
                )}

                {/* Not a column any more: a staging tray across the top, which is what
                    it always was. As a peer of Line 1 it implied "Unassigned" was a
                    place people work, and while nobody has an allocation it was also
                    the only column with anybody in it. It disappears entirely once the
                    shift is placed, which is the point. */}
                {unplaced.length > 0 && (
                  <UnplacedTray dropId={dropId(b.shift, UNPLACED)} count={unplaced.length} canEdit={canEdit}>
                    {unplaced.map((e) => card(e))}
                  </UnplacedTray>
                )}

                {/* Production and support are read differently — one is the line
                    running, the other is who keeps it running — and mixing them in one
                    grid made Office sit between Line 3 and Line 4 as though it were
                    the next line. */}
                {(["production", "support"] as const).map((kind) => {
                  const group = (areas ?? []).filter((a) => a.kind === kind);
                  if (group.length === 0) return null;
                  return (
                    <div key={kind}>
                      <div className="mb-2 mt-4 flex items-center gap-2 text-2xs font-extrabold uppercase tracking-widest text-muted-foreground first:mt-0">
                        {kind === "production" ? "Production" : "Support"}
                        <span className="h-px flex-1 bg-border" />
                      </div>
                      <div
                        className="grid gap-3"
                        style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${compact ? "9.5rem" : "11.5rem"},1fr))` }}
                      >
                        {group.map((l) => (
                          <BoardColumn
                            key={l.id}
                            dropId={dropId(b.shift, l.id)}
                            title={l.name}
                            kind={kind}
                            compact={compact}
                            count={b.columns.get(l.id)?.length ?? 0}
                            onOpen={canEdit ? () => setPicking({ id: l.id, name: l.name, shift: b.shift }) : undefined}
                          >
                            {(b.columns.get(l.id) ?? []).map((e) => card(e))}
                          </BoardColumn>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* ---- Away & overtime: readings of the day, not places ---- */}
                <div className="mb-2 mt-4 flex items-center gap-2 text-2xs font-extrabold uppercase tracking-widest text-muted-foreground">
                  Away &amp; overtime
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${compact ? "9.5rem" : "11.5rem"},1fr))` }}
                >
                  <BoardColumn title="Absence" kind="away" compact={compact} count={b.away.length}>
                    {b.away.map((e) => card(e))}
                  </BoardColumn>
                  <BoardColumn title="Holidays" kind="away" compact={compact} count={b.holidays.length}>
                    {b.holidays.map((e) => card(e))}
                  </BoardColumn>
                  <BoardColumn
                    title="Overtime"
                    kind="overtime"
                    compact={compact}
                    count={b.overtime.length}
                    note="Also counted on their line"
                  >
                    {b.overtime.map((e) => card(e, { readOnly: true }))}
                  </BoardColumn>
                </div>
              </div>
            );
          })}
        </div>

        {picking && (
          <AreaPicker
            areaId={picking.id}
            areaName={picking.name}
            open
            onOpenChange={(v) => !v && setPicking(null)}
            // Everyone on the shift, not just whoever the rota puts in today.
            // Nobody is fixed to a line, and a Saturday call-in or tomorrow's plan
            // has to be placeable — a picker that offers nobody on a day nobody is
            // rostered is a picker that cannot be used to change the roster.
            people={employees
              .filter((e) => e.active && resolveShiftOn(history, e, onDate.toISOString().slice(0, 10)).shift_group === picking.shift)
              .map((e) => {
                const id = areaOn(e);
                return {
                  ...e,
                  currentAreaId: id,
                  currentAreaName: id ? areas?.find((a) => a.id === id)?.name ?? null : null,
                  offRota: isOffRota(e),
                };
              })}
            onToggle={(person, toAreaId) => moveTo(person, toAreaId)}
          />
        )}

        <DragOverlay>
          {active && (
            <div className="rounded-lg border bg-card p-2 text-xs font-semibold shadow-lg">
              {active.full_name}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

export default HeadcountBoard;
