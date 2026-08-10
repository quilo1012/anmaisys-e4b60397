import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAllocatedByDepartment, useDepartments, useSetDepartmentBudget, worksOn } from "@/hooks/useWorkforce";
import type { PersonRow } from "./PeopleTable";

/**
 * Headcount per department: what it is funded for, who is on the books, and the gap.
 *
 * "Actual" counts everybody on the books; "in today" counts only those the rota puts
 * in. They are different questions and a single number cannot answer both — a
 * department can be fully staffed on paper and short-handed on a Friday.
 *
 * Vacancies are budget minus actual and are only shown where a budget exists. Where
 * nobody has set one, the row says so rather than reporting the whole department as
 * an overspend against zero.
 */
export function DepartmentHeadcount({ people, canEdit }: { people: PersonRow[]; canEdit: boolean }) {
  const { data: departments = [] } = useDepartments();
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const { data: allocated = {} } = useAllocatedByDepartment(todayKey);
  const setBudget = useSetDepartmentBudget();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const rows = useMemo(() => {
    return departments.map((d) => {
      const staff = people.filter((p) => p.active && p.department === d.name);
      const inToday = staff.filter((p) => !p.pattern || worksOn(p.pattern.days, today));
      const agency = staff.filter((p) => p.employment_type !== "permanent");
      return {
        ...d,
        actual: staff.length,
        inToday: inToday.length,
        agency: agency.length,
        // Placed on the board today, counted through the area's department rather
        // than the person's — somebody sent to Hygiene for a shift worked in Hygiene,
        // whatever their contract says.
        onBoard: allocated[d.name] ?? 0,
        vacancies: d.budget > 0 ? d.budget - staff.length : null,
      };
    });
  }, [departments, people, allocated, today]);

  const totals = rows.reduce(
    (t, r) => ({
      budget: t.budget + r.budget,
      actual: t.actual + r.actual,
      inToday: t.inToday + r.inToday,
      onBoard: t.onBoard + r.onBoard,
      agency: t.agency + r.agency,
    }),
    { budget: 0, actual: 0, inToday: 0, onBoard: 0, agency: 0 },
  );

  if (departments.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left text-2xs font-extrabold uppercase tracking-widest text-muted-foreground"
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
          Department headcount
          <span className="font-figure text-2xs font-bold normal-case tracking-normal text-foreground">
            {totals.actual} on the books
            {totals.budget > 0 && ` · ${totals.budget} funded`}
          </span>
          <span className="h-px flex-1 bg-border" />
        </button>

        {open && (
          <div className="mt-3 overflow-x-auto rounded-md border">
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">In today</TableHead>
                  <TableHead className="text-right">On the board</TableHead>
                  <TableHead className="text-right">Agency</TableHead>
                  <TableHead className="text-right">Vacancies</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.id} className={cn(i % 2 === 1 && "bg-muted/30")}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">
                      {canEdit ? (
                        <Input
                          type="number"
                          min={0}
                          value={draft[r.id] ?? String(r.budget)}
                          onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                          onBlur={(e) => {
                            const n = Math.max(0, Number(e.target.value) || 0);
                            if (n !== r.budget) setBudget.mutate({ id: r.id, budget: n });
                          }}
                          className="ml-auto h-8 w-20 text-right font-mono text-xs"
                        />
                      ) : (
                        <span className="font-figure text-xs">{r.budget || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-figure text-sm font-semibold">{r.actual}</TableCell>
                    <TableCell className="text-right font-figure text-sm">{r.inToday}</TableCell>
                    <TableCell className="text-right font-figure text-sm">
                      {r.onBoard || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-figure text-sm">
                      {r.agency || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-figure text-sm font-semibold">
                      {r.vacancies === null ? (
                        <span className="text-2xs font-normal text-muted-foreground">no budget set</span>
                      ) : (
                        <span className={cn(
                          r.vacancies > 0 && "text-warning-strong",
                          r.vacancies < 0 && "text-destructive-strong",
                        )}>
                          {r.vacancies > 0 ? r.vacancies : r.vacancies < 0 ? `${r.vacancies} over` : "0"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right font-figure text-xs">{totals.budget || "—"}</TableCell>
                  <TableCell className="text-right font-figure text-sm">{totals.actual}</TableCell>
                  <TableCell className="text-right font-figure text-sm">{totals.inToday}</TableCell>
                  <TableCell className="text-right font-figure text-sm">{totals.onBoard || "—"}</TableCell>
                  <TableCell className="text-right font-figure text-sm">{totals.agency || "—"}</TableCell>
                  <TableCell className="text-right font-figure text-sm">
                    {totals.budget > 0 ? totals.budget - totals.actual : <span className="text-2xs font-normal text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {/* Said once, under the table: 95 of the 172 have no department at all, so
                the rows below will not add up to the workforce until they do. */}
            <p className="border-t px-3 py-2 text-2xs text-muted-foreground">
              Only people with a department recorded are counted here.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
