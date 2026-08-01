import { useMemo, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { GripVertical, UserCheck, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useLines, useMoveEmployee, useSetAttendance, describeDays, worksOn,
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

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border bg-card p-2 text-left shadow-sm",
        (isDragging || dragging) && "opacity-50",
        status === "absent" && "border-destructive/40",
      )}
    >
      <div className="flex items-start gap-1">
        {canEdit && (
          <button
            type="button"
            className="mt-0.5 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing no-print"
            aria-label={`Move ${employee.full_name}`}
            {...listeners}
            {...attributes}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {/* The name opens the detail panel; the grip drags. Two targets, so a tap
              on a tablet never has to guess which one was meant. */}
          <button
            type="button"
            onClick={onSelect}
            className="block w-full truncate text-left text-xs font-semibold hover:underline"
          >
            {employee.full_name}
          </button>
          <div className="truncate text-2xs text-muted-foreground">
            {employee.department ?? "Department to confirm"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="text-2xs">
              {employee.pattern ? describeDays(employee.pattern.days) : "No pattern"}
            </Badge>
            {status && (
              <button
                type="button"
                onClick={canEdit ? onCycle : undefined}
                className={cn("rounded border px-1.5 py-0.5 text-2xs font-semibold", STATUS_META[status].cls, canEdit && "cursor-pointer")}
              >
                {STATUS_META[status].label}
              </button>
            )}
            {!status && canEdit && (
              <button
                type="button"
                onClick={onCycle}
                className="rounded border border-dashed px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground no-print"
              >
                Mark
              </button>
            )}
          </div>
        </div>
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
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-bold uppercase tracking-wide">{title}</span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{count}</span>
      </div>
      {subtitle && <div className="mb-1 text-2xs text-muted-foreground">{subtitle}</div>}
      <div className="space-y-2">{children}</div>
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
  const { data: lines } = useLines();
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

  const scheduled = useMemo(
    () =>
      employees.filter(
        (e) => e.active && e.shift_group === shift && (showAll || !e.pattern || worksOn(e.pattern.days, onDate)),
      ),
    [employees, onDate, showAll, shift],
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

  const columns = useMemo(() => {
    const byLine = new Map<string, BoardEmployee[]>();
    byLine.set(UNPLACED, []);
    for (const l of lines ?? []) byLine.set(l.id, []);
    for (const e of scheduled) {
      const key = e.current_line_id && byLine.has(e.current_line_id) ? e.current_line_id : UNPLACED;
      byLine.get(key)!.push(e);
    }
    return byLine;
  }, [scheduled, lines]);

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
    if ((employee.current_line_id ?? null) === toLineId) return;
    const nameOf = (id: string | null) => (id ? lines?.find((l) => l.id === id)?.name ?? null : null);
    move.mutate(
      {
        employee,
        toLineId,
        fromLineName: nameOf(employee.current_line_id),
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
          {(shiftCounts.get("__none__") ?? 0) > 0 && (
            <span className="self-center pl-1 text-2xs text-muted-foreground">
              {shiftCounts.get("__none__")} with no shift recorded
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
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

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(lines ?? []).map((l) => (
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
