import { useMemo, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { GripVertical, UserCheck, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { roleStripe, type RoleStripe } from "@/lib/workforceRoles";
import {
  useHeadcountAreas, useMoveEmployee, useSetAttendance, describeDays, worksOn,
  useShiftHistory, useShiftPatterns, resolveShiftOn,
  type Attendance, type AttendanceStatus, type Employee, type ShiftPattern,
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

const STATUS_META: Record<AttendanceStatus, { label: string; cls: string }> = {
  present:  { label: "In",       cls: "border-emerald-500/40 bg-emerald-500/15 text-success-strong" },
  absent:   { label: "Absent",   cls: "border-red-500/40 bg-red-500/15 text-destructive-strong" },
  sick:     { label: "Sick",     cls: "border-amber-500/40 bg-amber-500/15 text-warning-strong" },
  holiday:  { label: "Holiday",  cls: "border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  training: { label: "Training", cls: "border-purple-500/40 bg-purple-500/15 text-purple-700 dark:text-purple-300" },
  // Agreed and unpaid, which is not the same as an absence nobody agreed to.
  unpaid:   { label: "Unpaid",   cls: "border-slate-500/40 bg-slate-500/15 text-muted-foreground" },
};

// No overtime here on purpose. The board answers who is in today; overtime is a
// balance imported from payroll over a period that is not this day, and carrying it
// on the same card is what made the two look like one number.
export interface BoardEmployee extends Employee {
  pattern: ShiftPattern | null;
}

function EmployeeCard({
  employee, attendance, onCycle, onSelect, canEdit, dragging,
}: {
  employee: BoardEmployee;
  attendance: Attendance | undefined;
  onCycle: () => void;
  onSelect?: () => void;
  canEdit: boolean;
  dragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: employee.id, disabled: !canEdit,
  });
  const status = attendance?.status;
  const role = roleStripe(employee.department);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md border bg-card px-1.5 py-1 text-left",
        (isDragging || dragging) && "opacity-50",
        status === "absent" && "border-destructive/40",
      )}
    >
      {/* One line per person. Department and shift pattern moved to the tooltip and
          the detail panel: on a board of 68 cards, "Department to confirm" repeated
          138 times is not information, it is noise with a scrollbar. */}
      <div className="flex items-center gap-1">
        {canEdit && (
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
            colour and the three letters carry it, and the full title is on hover. */}
        {role && (
          <span
            title={role.label}
            className={cn(
              "shrink-0 rounded-sm px-1 py-px text-[9px] font-bold uppercase leading-tight tracking-wide",
              role.cls,
            )}
          >
            {role.short}
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
        {status ? (
          <button
            type="button"
            onClick={canEdit ? onCycle : undefined}
            className={cn(
              "shrink-0 rounded border px-1.5 py-0.5 text-2xs font-semibold",
              STATUS_META[status].cls,
              canEdit && "cursor-pointer",
            )}
          >
            {STATUS_META[status].label}
          </button>
        ) : canEdit ? (
          <button
            type="button"
            onClick={onCycle}
            className="shrink-0 rounded border border-dashed px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground no-print"
          >
            Mark
          </button>
        ) : null}
      </div>
    </div>
  );
}

function LineColumn({
  id, title, subtitle, children, count,
}: {
  id: string; title: string; subtitle?: string; children: React.ReactNode; count: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[8rem] flex-col rounded-lg border bg-muted/30 p-2 transition-colors break-inside-avoid",
        isOver && "border-primary bg-primary/5",
      )}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b pb-1">
        <span className="truncate text-xs font-bold uppercase tracking-wide">{title}</span>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 font-mono text-xs font-bold",
            count > 0 ? "bg-primary/10 text-primary" : "text-muted-foreground/50",
          )}
        >
          {count}
        </span>
      </div>
      {subtitle && <div className="mb-1 text-2xs text-muted-foreground">{subtitle}</div>}
      {/* Capped and scrolled inside, so one crowded line does not stretch the row it
          sits in and leave nine short columns padded out beside it. */}
      <div className="max-h-80 space-y-1 overflow-y-auto print:max-h-none print:overflow-visible">
        {children}
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
  count, canEdit, children,
}: {
  count: number; canEdit: boolean; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UNPLACED });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "mb-3 rounded-lg border border-dashed bg-muted/20 p-2 transition-colors",
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
  const [shift, setShift] = useState<string>("Day");

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

  /**
   * The shift and rota each person held on the day being shown, not the one they hold
   * now. Somebody moved from nights to days in August was on nights in July, and the
   * July board has to keep saying so.
   */
  const positionOn = useMemo(() => {
    const key = onDate.toISOString().slice(0, 10);
    return (e: BoardEmployee) => resolveShiftOn(history, e, key);
  }, [history, onDate]);

  const scheduled = useMemo(
    () =>
      employees.filter((e) => {
        if (!e.active) return false;
        const pos = positionOn(e);
        if (pos.shift_group !== shift) return false;
        const pattern = pos.shift_pattern_id === e.shift_pattern_id
          ? e.pattern
          : (allPatterns ?? []).find((p) => p.id === pos.shift_pattern_id) ?? null;
        return showAll || !pattern || worksOn(pattern.days, onDate);
      }),
    [employees, onDate, showAll, shift, positionOn, allPatterns],
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

  /**
   * The selected shift, counted on its own.
   *
   * The KPI row above the tabs counts the whole factory; this counts the shift you
   * are standing on, which is the number a supervisor is actually asked for at
   * handover. Unmarked is named rather than folded into anything: nobody having said
   * yet is not the same as somebody being in, and it is not an absence either.
   */
  const shiftTotals = useMemo(() => {
    const byId = new Map((attendance ?? []).map((a) => [a.employee_id, a]));
    const n = (...want: AttendanceStatus[]) =>
      scheduled.filter((e) => want.includes(byId.get(e.id)?.status as AttendanceStatus)).length;
    return {
      onShift: scheduled.length,
      present: n("present"),
      away: n("absent", "sick", "unpaid"),
      holiday: n("holiday"),
      unmarked: scheduled.filter((e) => !byId.has(e.id)).length,
      // Counted the way the columns are: the day's allocation, falling back to where
      // they usually are. Counting only the employee default would report people as
      // placed on a day somebody had explicitly taken them off a line.
      placed: scheduled.filter(
        (e) => (byId.get(e.id)?.headcount_area_id ?? e.headcount_area_id) != null,
      ).length,
    };
  }, [scheduled, attendance]);

  /**
   * Where somebody is on the day being shown.
   *
   * The day's own allocation wins. The employee's area is only a default — where they
   * usually are — and it seeds a day nobody has touched yet so the board opens
   * pre-filled instead of empty every morning. Reading the default as though it were
   * the day's record is what made moving somebody on Tuesday rewrite Monday.
   */
  const areaOn = useMemo(() => {
    const byId = new Map((attendance ?? []).map((a) => [a.employee_id, a]));
    return (e: BoardEmployee) => byId.get(e.id)?.headcount_area_id ?? e.headcount_area_id ?? null;
  }, [attendance]);

  /**
   * Why the board is empty, when it is.
   *
   * A shift whose rota does not cover the chosen day is genuinely nobody, and the
   * honest count is zero — but a screen full of zeros reads as broken software. This
   * says which rota and which weekday, so the answer is "nobody works Sunday
   * nights", not "the counters are wrong".
   */
  const rolesPresent = useMemo(() => {
    const seen = new Map<string, RoleStripe>();
    for (const e of scheduled) {
      const r = roleStripe(e.department);
      if (r) seen.set(r.label, r);
    }
    return Array.from(seen.values());
  }, [scheduled]);

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

  const emptyReason = useMemo(() => {
    if (scheduled.length > 0 || showAll) return null;
    const onThisShift = employees.filter((e) => e.active && e.shift_group === shift);
    if (onThisShift.length === 0) return `Nobody is on the ${shift} shift.`;
    const rotas = Array.from(
      new Set(onThisShift.map((e) => e.pattern?.name).filter(Boolean) as string[]),
    );
    const weekday = onDate.toLocaleDateString("en-GB", { weekday: "long" });
    return rotas.length
      ? `${onThisShift.length} people are on the ${shift} shift, and no ${rotas.join(" / ")} rota covers ${weekday}.`
      : `${onThisShift.length} people are on the ${shift} shift and none of them has a rota recorded.`;
  }, [scheduled, showAll, employees, shift, onDate]);

  const columns = useMemo(() => {
    const byLine = new Map<string, BoardEmployee[]>();
    byLine.set(UNPLACED, []);
    for (const a of areas ?? []) byLine.set(a.id, []);
    for (const e of scheduled) {
      const area = areaOn(e);
      byLine.get(area && byLine.has(area) ? area : UNPLACED)!.push(e);
    }
    return byLine;
  }, [scheduled, areas, areaOn]);

  const cycleStatus = (employeeId: string) => {
    const order: AttendanceStatus[] = ["present", "absent", "sick", "holiday", "unpaid", "training"];
    const current = attendanceByEmployee.get(employeeId)?.status;
    const next = order[(current ? order.indexOf(current) + 1 : 0) % order.length];
    setAttendance.mutate({ employeeId, status: next }, {
      onError: (e) => toast.error((e as Error).message || "Could not save attendance"),
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const employeeId = String(event.active.id);
    const target = event.over ? String(event.over.id) : null;
    if (!target) return;
    const employee = employees.find((e) => e.id === employeeId);
    if (!employee) return;
    const toLineId = target === UNPLACED ? null : target;
    const wasOn = areaOn(employee as BoardEmployee);
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
      },
      {
        onSuccess: () => toast.success(`${employee.full_name} → ${nameOf(toLineId) ?? "Unassigned"}`),
        onError: (e) => toast.error((e as Error).message || "Could not move"),
      },
    );
  };

  const active = activeId ? employees.find((e) => e.id === activeId) : null;
  const unplacedCount = columns.get(UNPLACED)?.length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Headcount by line</CardTitle>
            <CardDescription>
              {showAll
                ? "Everyone active, whatever their pattern says about today."
                : "People whose shift pattern covers this day, plus anyone with no pattern yet."}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" className="no-print" onClick={() => setShowAll((v) => !v)}>
            {showAll ? <UserCheck className="mr-1 h-4 w-4" /> : <UserX className="mr-1 h-4 w-4" />}
            {showAll ? "Only today's shift" : "Show everyone"}
          </Button>
        </div>
        {/* Day and Night are two different headcounts that happen to share a factory.
            Shown side by side they read as one number twice the size. */}
        <div className="mt-3 flex flex-wrap gap-1 no-print">
          {BOARD_SHIFTS.map((g) => {
            const n = shiftCounts.get(g) ?? 0;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setShift(g)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  shift === g
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted",
                  n === 0 && shift !== g && "text-muted-foreground",
                )}
              >
                {g}
                <span className="ml-1.5 font-mono opacity-70">{n}</span>
              </button>
            );
          })}
          {/* Named rather than left out silently, so the board does not read as the
              whole factory when 46 people are deliberately not on it. */}
          <span className="ml-auto self-center text-right text-2xs text-muted-foreground">
            {offBoard.map((o) => `${o.name} ${o.n}`).join(" · ")} — recorded, not planned here
            {(shiftCounts.get("__none__") ?? 0) > 0
              ? ` · ${shiftCounts.get("__none__")} with no shift recorded`
              : ""}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {[
            { k: "On shift", v: shiftTotals.onShift, s: shift },
            { k: "In", v: shiftTotals.present, s: "Marked present" },
            { k: "Away", v: shiftTotals.away, s: "Absent, sick, unpaid", tone: shiftTotals.away ? "text-warning-strong" : "" },
            { k: "Holiday", v: shiftTotals.holiday, s: "Booked leave" },
            { k: "Not marked", v: shiftTotals.unmarked, s: "Nobody has said", tone: shiftTotals.unmarked ? "text-destructive-strong" : "" },
            { k: "Placed", v: `${shiftTotals.placed}/${shiftTotals.onShift}`, s: "Have an area" },
          ].map((t) => (
            <div key={t.k} className="rounded-lg border bg-card px-3 py-2">
              <div className="truncate text-2xs uppercase tracking-wider text-muted-foreground">{t.k}</div>
              <div className={cn("font-mono text-2xl font-bold tabular-nums leading-tight", t.tone)}>{t.v}</div>
              <div className="truncate text-2xs text-muted-foreground">{t.s}</div>
            </div>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {/* Only the roles actually on this shift. A key listing seven colours when
            four are on screen sends somebody hunting for people who are not there. */}
        {rolesPresent.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
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
        {emptyReason && (
          <div className="mb-3 rounded-lg border border-dashed bg-muted/30 p-3 text-sm">
            <p className="font-medium">{emptyReason}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The zero is the answer, not a fault. Step to a day the rota covers, or use
              “Show everyone” to see the shift regardless of the day.
            </p>
          </div>
        )}
        <DndContext
          sensors={sensors}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          {/* Not a column any more: a staging tray across the top, which is what it
              always was. As a peer of Line 1 it implied "Unassigned" was a place
              people work, and while nobody has an allocation it was also the only
              column with anybody in it. It disappears entirely once the shift is
              placed, which is the point. */}
          {unplacedCount > 0 && <UnplacedTray count={unplacedCount} canEdit={canEdit}>
            {(columns.get(UNPLACED) ?? []).map((e) => (
              <EmployeeCard
                key={e.id}
                employee={e}
                attendance={attendanceByEmployee.get(e.id)}
                onCycle={() => cycleStatus(e.id)}
                onSelect={() => onSelect?.(e.id)}
                canEdit={canEdit}
                dragging={activeId === e.id}
              />
            ))}
          </UnplacedTray>}

          {/* Production and support are read differently — one is the line running,
              the other is who keeps it running — and mixing them in one grid made
              Office sit between Line 3 and Line 4 as though it were the next line. */}
          {(["production", "support"] as const).map((kind) => {
            const group = (areas ?? []).filter((a) => a.kind === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind}>
                <div className="mb-2 mt-3 flex items-center gap-2 text-2xs font-bold uppercase tracking-widest text-muted-foreground first:mt-0">
                  {kind === "production" ? "Production" : "Support"}
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.map((l) => (
                    <LineColumn key={l.id} id={l.id} title={l.name} count={columns.get(l.id)?.length ?? 0}>
                      {(columns.get(l.id) ?? []).map((e) => (
                        <EmployeeCard
                          key={e.id}
                          employee={e}
                          attendance={attendanceByEmployee.get(e.id)}
                          onCycle={() => cycleStatus(e.id)}
                          onSelect={() => onSelect?.(e.id)}
                          canEdit={canEdit}
                          dragging={activeId === e.id}
                        />
                      ))}
                    </LineColumn>
                  ))}
                </div>
              </div>
            );
          })}

          <DragOverlay>
            {active && (
              <div className="rounded-lg border bg-card p-2 text-xs font-semibold shadow-lg">
                {active.full_name}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </CardContent>
    </Card>
  );
}

export default HeadcountBoard;
