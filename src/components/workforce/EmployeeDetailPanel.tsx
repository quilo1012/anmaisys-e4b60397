import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArrowRight, RotateCcw, Save, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  describeDays, useEmployeeOvertime, useHeadcountAreas, useMovements, useShiftPatterns,
  useUpdateEmployee, type Employee,
} from "@/hooks/useWorkforce";

/**
 * One person, in three answers: who they are, where they have been, what they carry.
 *
 * The Details tab is editable because the import left real gaps — fourteen people
 * with no department and seventeen with no shift pattern — and the person who can
 * close those gaps is whoever has this panel open, not whoever next edits a
 * spreadsheet.
 */
export function EmployeeDetailPanel({
  employee, open, onOpenChange, canEdit,
}: {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canEdit: boolean;
}) {
  const { data: patterns } = useShiftPatterns();
  const { data: areas } = useHeadcountAreas();
  const { data: movements, isLoading: loadingMoves } = useMovements(employee?.id ?? null);
  const { data: overtime, isLoading: loadingOT } = useEmployeeOvertime(employee?.id ?? null);
  const update = useUpdateEmployee();

  const [department, setDepartment] = useState("");
  const [patternId, setPatternId] = useState<string>("__none__");
  const [ref, setRef] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [leftOn, setLeftOn] = useState(() => new Date().toISOString().slice(0, 10));

  // Reset when a different person is opened, so the form never shows the last one's
  // values against this one's name.
  useEffect(() => {
    setDepartment(employee?.department ?? "");
    setPatternId(employee?.shift_pattern_id ?? "__none__");
    setRef(employee?.employee_ref ?? "");
    setStartedOn(employee?.started_on ?? "");
    setLeftOn(employee?.left_on ?? new Date().toISOString().slice(0, 10));
  }, [
    employee?.id, employee?.department, employee?.shift_pattern_id,
    employee?.employee_ref, employee?.started_on, employee?.left_on,
  ]);

  if (!employee) return null;

  const dirty =
    department !== (employee.department ?? "") ||
    patternId !== (employee.shift_pattern_id ?? "__none__") ||
    ref !== (employee.employee_ref ?? "") ||
    startedOn !== (employee.started_on ?? "");

  const startsAfterLeaving =
    startedOn !== "" && employee.left_on !== null && startedOn > employee.left_on;

  const save = () => {
    update.mutate(
      {
        id: employee.id,
        patch: {
          department: department.trim() || null,
          shift_pattern_id: patternId === "__none__" ? null : patternId,
          employee_ref: ref.trim() || null,
          // Empty clears it back to null. A blank start date means nobody recorded
          // one, which is the truth for the fifty imported rows.
          started_on: startedOn || null,
        },
      },
      {
        onSuccess: () => toast.success("Saved"),
        onError: (e) => toast.error((e as Error).message || "Could not save"),
      },
    );
  };

  /**
   * Leaving is a soft change, and both fields move together.
   *
   * The row stays: employee_attendance and overtime_entries cascade on delete, so
   * removing someone would take their attendance and their payroll hours with them.
   * active and left_on are set in one patch because either one alone is half a
   * story — a date with the flag still true reads as someone who never left.
   */
  const setLeaver = (hasLeft: boolean) => {
    update.mutate(
      {
        id: employee.id,
        patch: hasLeft ? { active: false, left_on: leftOn } : { active: true, left_on: null },
      },
      {
        onSuccess: () =>
          toast.success(
            hasLeft
              ? `${employee.full_name} marked as left. History and overtime are kept.`
              : `${employee.full_name} is back on the active list.`,
          ),
        onError: (e) => toast.error((e as Error).message || "Could not save"),
      },
    );
  };

  const lineName = employee.headcount_area_id
    ? areas?.find((a) => a.id === employee.headcount_area_id)?.name ?? "—"
    : "Unassigned";
  const total = (overtime ?? []).reduce((s, o) => s + Number(o.hours), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{employee.full_name}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="text-2xs">{lineName}</Badge>
            {employee.source === "import_overtime" && (
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-2xs text-warning-strong">
                From overtime sheet
              </Badge>
            )}
            {!employee.active && <Badge variant="outline" className="text-2xs">Left</Badge>}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="details" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="overtime">Overtime</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-3 pt-3">
            <div>
              <Label className="text-xs">Email</Label>
              <p className="text-sm text-muted-foreground">{employee.email || "—"}</p>
            </div>
            <div>
              <Label className="text-xs" htmlFor="wf-started">Start date</Label>
              <Input
                id="wf-started"
                type="date"
                value={startedOn}
                disabled={!canEdit}
                onChange={(e) => setStartedOn(e.target.value)}
                className="text-sm"
              />
              {startedOn === "" && (
                <p className="mt-1 text-2xs text-muted-foreground">
                  Not recorded — the imported list carried no start dates.
                </p>
              )}
              {startsAfterLeaving && (
                <p className="mt-1 text-2xs text-destructive-strong">
                  This is after the leaving date ({format(new Date(`${employee.left_on}T12:00:00`), "dd/MM/yyyy")}).
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs" htmlFor="wf-dept">Department</Label>
              <Input
                id="wf-dept"
                value={department}
                disabled={!canEdit}
                placeholder="To confirm"
                onChange={(e) => setDepartment(e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              {/* Assigning by dropdown as well as by drag: placing 180 people once,
                  on a tablet, is not a drag-and-drop job. It saves on change rather
                  than waiting for the Save button, because it is one field. */}
              <Label className="text-xs">Headcount area</Label>
              <Select
                value={employee.headcount_area_id ?? "__none__"}
                disabled={!canEdit}
                onValueChange={(v) =>
                  update.mutate(
                    { id: employee.id, patch: { headcount_area_id: v === "__none__" ? null : v } },
                    {
                      onSuccess: () =>
                        toast.success(
                          v === "__none__"
                            ? `${employee.full_name} taken off the board`
                            : `${employee.full_name} → ${areas?.find((a) => a.id === v)?.name}`,
                        ),
                      onError: (e) => toast.error((e as Error).message || "Could not save"),
                    },
                  )
                }
              >
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— not on the board —</SelectItem>
                  {(areas ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      {a.kind === "support" ? " · support" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Shift pattern</Label>
              <Select value={patternId} onValueChange={setPatternId} disabled={!canEdit}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— none —</SelectItem>
                  {(patterns ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} · {describeDays(p.days)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="wf-ref">Payroll number</Label>
              <Input
                id="wf-ref"
                value={ref}
                disabled={!canEdit}
                placeholder="Not set"
                onChange={(e) => setRef(e.target.value)}
                className="font-mono text-sm"
              />
              {/* Said plainly, because the import deliberately left this blank rather
                  than inventing a key that matches nothing in payroll. */}
              <p className="mt-1 text-2xs text-muted-foreground">
                Blank on every imported row — the source files carry no employee number.
              </p>
            </div>
            {employee.notes && (
              <p className="rounded border bg-muted/30 p-2 text-xs text-muted-foreground">{employee.notes}</p>
            )}
            {canEdit && (
              <Button size="sm" onClick={save} disabled={!dirty || startsAfterLeaving || update.isPending}>
                <Save className="mr-1 h-4 w-4" /> {update.isPending ? "Saving…" : "Save"}
              </Button>
            )}

            {canEdit && (
              <div className="mt-2 space-y-2 rounded-lg border border-dashed p-3">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <UserMinus className="h-3.5 w-3.5" /> Leaving the company
                </div>
                {employee.active ? (
                  <>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label className="text-2xs" htmlFor="wf-left-on">Last day</Label>
                        <Input
                          id="wf-left-on"
                          type="date"
                          value={leftOn}
                          onChange={(e) => e.target.value && setLeftOn(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setLeaver(true)}
                        disabled={update.isPending}
                      >
                        Mark as left
                      </Button>
                    </div>
                    <p className="text-2xs text-muted-foreground">
                      They come off the daily board and the headcount from then on, and stay in the
                      records they are already in — a month they worked keeps the days they worked.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label className="text-2xs" htmlFor="wf-left-on-edit">Leaving date</Label>
                        <Input
                          id="wf-left-on-edit"
                          type="date"
                          value={leftOn}
                          onChange={(e) => e.target.value && setLeftOn(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>
                      {/* Correcting the date is not the same as bringing them back, so
                          it saves on its own without touching the active flag. */}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending || leftOn === (employee.left_on ?? "")}
                        onClick={() =>
                          update.mutate(
                            { id: employee.id, patch: { left_on: leftOn } },
                            {
                              onSuccess: () => toast.success("Leaving date updated"),
                              onError: (e) => toast.error((e as Error).message || "Could not save"),
                            },
                          )
                        }
                      >
                        <Save className="mr-1 h-3.5 w-3.5" /> Save date
                      </Button>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setLeaver(false)} disabled={update.isPending}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reinstate
                    </Button>
                  </>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-2 pt-3">
            {loadingMoves ? (
              <Skeleton className="h-24" />
            ) : (movements ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No moves recorded yet. History starts the first time someone is moved on the board.
              </p>
            ) : (
              (movements ?? []).map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded border p-2 text-xs">
                  <span className="whitespace-nowrap text-muted-foreground">
                    {format(new Date(m.moved_at), "dd/MM HH:mm")}
                  </span>
                  <span className="truncate">{m.from_line ?? "Unassigned"}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{m.to_line ?? "Unassigned"}</span>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="overtime" className="space-y-2 pt-3">
            {loadingOT ? (
              <Skeleton className="h-24" />
            ) : (overtime ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No overtime recorded for this person.</p>
            ) : (
              <>
                <div className="rounded border p-2">
                  <div className="text-2xs uppercase text-muted-foreground">Across all periods</div>
                  <div className={cn("font-mono text-2xl font-bold", total < 0 && "text-destructive-strong")}>
                    {total}h
                  </div>
                </div>
                {(overtime ?? []).map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-2 rounded border p-2 text-xs">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{o.period?.label ?? "—"}</div>
                      {o.note && <div className="truncate text-2xs text-muted-foreground">{o.note}</div>}
                    </div>
                    <span className={cn("shrink-0 font-mono font-bold", Number(o.hours) < 0 && "text-destructive-strong")}>
                      {Number(o.hours)}h
                    </span>
                  </div>
                ))}
                <p className="text-2xs text-muted-foreground">
                  A balance, not hours worked: sickness is written off against banked hours, so a negative
                  figure is real.
                </p>
                {/* Said on the screen, not only in a migration: this is a copy, and the
                    factory pays from the sheet it was copied from. */}
                {(overtime ?? [])[0]?.imported_at && (
                  <p className="rounded border bg-muted/40 p-2 text-2xs text-muted-foreground">
                    Imported from the payroll spreadsheet
                    {(overtime ?? [])[0]?.source_note ? ` — ${(overtime ?? [])[0]!.source_note}` : ""}
                    {" · "}
                    {format(new Date((overtime ?? [])[0]!.imported_at as string), "dd/MM/yyyy HH:mm")}.
                    Not calculated here, and not editable here.
                  </p>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

export default EmployeeDetailPanel;
