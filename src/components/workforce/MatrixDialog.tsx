import { useMemo } from "react";
import { Star, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { groupMatrix, type MatrixEntry } from "@/lib/matrixGroups";
import { isOffRota } from "@/lib/rotaStatus";
import { useShiftPatterns, useShiftHistory, resolveShiftOn } from "@/hooks/useWorkforce";
import { useRotaCover, type HeadcountArea, type HeadcountEmployee, type Matrix } from "@/hooks/useHeadcount";

/**
 * What the matrix holds, read by crew.
 *
 * The board is drawn by column because that is how a day is worked. This is not a day:
 * it is everybody the board has, and no day has everybody. Read by column it says Line
 * 1 has eleven people, four of whom are ever in together; read by crew it says what a
 * Friday is actually made of — Tue–Fri and Fri–Mon, and not the thirty-nine of Mon–Thu.
 *
 * Read-only on purpose. The matrix is changed by arranging a real board and saving it,
 * which is a thing somebody has already checked, rather than by dragging names around
 * a screen that answers to no particular day.
 */
export function MatrixDialog({
  open,
  onOpenChange,
  shift,
  onDate,
  matrices,
  areas,
  employeeById,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  shift: string;
  onDate: string;
  matrices: Matrix[];
  areas: HeadcountArea[];
  employeeById: Map<string, HeadcountEmployee>;
}) {
  const { data: patterns = [] } = useShiftPatterns();
  const { data: history } = useShiftHistory();
  // The same answer the copy acts on, from the same function. Written out again here it
  // would be a second definition of "is this person in", and the screen would sooner or
  // later promise a number the copy does not write.
  const rotaCover = useRotaCover();

  const grouped = useMemo(() => {
    const patternById = new Map(patterns.map((p) => [p.id, p]));
    return matrices.map((m) => {
      const entries: MatrixEntry[] = m.rows.flatMap((r) => {
        const person = employeeById.get(r.employee_id);
        // Somebody who has left keeps their place in the matrix until it is saved
        // again; the board cannot draw them, and neither can this.
        if (!person) return [];
        const held = resolveShiftOn(history, person, onDate);
        const pattern = held.shift_pattern_id ? patternById.get(held.shift_pattern_id) ?? null : null;
        return [{
          employee_id: r.employee_id,
          name: person.full_name,
          area_id: r.area_id,
          rota: pattern?.name ?? null,
          due: !isOffRota(rotaCover(r.employee_id, onDate, shift)),
        }];
      });
      return { ...m, groups: groupMatrix(entries, areas.map((a) => a.id)) };
    });
  }, [matrices, employeeById, patterns, history, rotaCover, onDate, shift, areas]);

  const areaName = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-4 w-4 text-primary" />
            {shift} matrices
          </DialogTitle>
          <DialogDescription>
            One standard per kind of day, because a Monday is not a Wednesday and a Friday is neither. Each one is
            read by crew: the matrix holds everybody the board has, and no day has everybody — what is greyed out is
            a crew that does not work {formatDay(onDate)}, and a copy leaves them where they are.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {grouped.map((m) => (
            <div key={m.kind}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 border-b pb-1.5">
                <h2 className="text-sm font-extrabold uppercase tracking-wider">{m.label}</h2>
                <span className="text-2xs text-muted-foreground">{m.hint}</span>
                <span className="ml-auto text-2xs font-semibold text-muted-foreground">
                  {m.rows.length === 0 ? (
                    "nothing saved yet"
                  ) : (
                    <>
                      <b className="font-figure text-sm text-primary">{m.due.length}</b> of {m.rows.length} due in
                      {m.savedFrom ? ` · saved ${formatDay(m.savedFrom)}` : ""}
                    </>
                  )}
                </span>
              </div>

              {m.rows.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  Arrange this board as a {m.label} should look and press <b>Save as matrix</b>.
                </p>
              ) : (
                <div className="space-y-3">
                  {m.groups.map((g) => (
                    <section key={g.rota} className={cn("rounded-xl border p-3", g.due === 0 && "opacity-60")}>
                      <header className="mb-2 flex items-center gap-2">
                        <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <h3 className="truncate text-sm font-bold">{g.rota}</h3>
                        <span className="ml-auto shrink-0 text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                          {g.due > 0 ? (
                            <>
                              <span className="font-figure text-sm text-primary">{g.due}</span> of {g.people} in today
                            </>
                          ) : (
                            <>{g.people} · none in today</>
                          )}
                        </span>
                      </header>
                      <dl className="space-y-1">
                        {g.areas.map((a) => (
                          <div key={a.area_id ?? "none"} className="flex gap-3 text-xs">
                            <dt
                              className={cn(
                                "w-28 shrink-0 truncate font-semibold",
                                a.area_id ? "text-muted-foreground" : "text-warning",
                              )}
                            >
                              {a.area_id ? areaName.get(a.area_id) ?? "Unknown column" : "No column"}
                            </dt>
                            <dd className="min-w-0 flex-1">{a.names.join(" · ")}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatDay(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}
