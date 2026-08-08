import { useMemo, useState } from "react";
import { Figure } from "@/components/ui/Figure";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Search, Users } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/exportCsv";
import { describeDays, type Employee, type ShiftPattern } from "@/hooks/useWorkforce";

export interface PersonRow extends Employee {
  pattern: ShiftPattern | null;
}

/** How each contract type reads. Permanent is the default and deliberately plain —
 *  colour is for the exceptions, which is what somebody is scanning for. */
const TYPE_LOOK: Record<string, string> = {
  permanent: "text-muted-foreground",
  agency: "border-primary/40 bg-primary/10 text-primary",
  contractor: "border-primary/40 bg-primary/10 text-primary",
  temporary: "border-warning/40 bg-warning/10 text-warning-strong",
};
const TYPES = ["permanent", "agency", "contractor", "temporary"] as const;

type SortKey = "full_name" | "employee_ref" | "department" | "position" | "manager" | "shift_group" | "started_on" | "status";
type Dir = "asc" | "desc";

const ALL = "__all__";
const PAGE_SIZES = [25, 50, 100];

/** One state per person, in the colour it is read at a glance. */
function statusOf(p: PersonRow) {
  if (!p.active) return { label: "Left", cls: "border-destructive/40 bg-destructive/10 text-destructive-strong" };
  if (!p.shift_group) return { label: "No shift", cls: "border-warning/40 bg-warning/10 text-warning-strong" };
  if (!p.pattern) return { label: "No rota", cls: "border-warning/40 bg-warning/10 text-warning-strong" };
  return { label: "Active", cls: "border-success/40 bg-success/10 text-success-strong" };
}

/**
 * Everyone who works here, as one table.
 *
 * It used to be a column per shift with a card per person — a shape that reads well
 * at twenty people and becomes a wall at a hundred and eighty. Finding somebody meant
 * knowing which shift they were on first, which is the thing you are usually looking
 * them up to find out.
 *
 * Only columns the data can actually fill are here. There is no manager, job title,
 * contract type or photo on `employees`, and a column of blanks is worse than no
 * column: it reads as missing data rather than as a field nobody has ever filled.
 */
export function PeopleTable({
  people, onOpen, actions, leftCount = 0,
}: {
  /** The active list. Leavers live under their own heading on the page. */
  people: PersonRow[];
  onOpen: (id: string) => void;
  /** Add-employee button and anything else the page owns. */
  actions?: React.ReactNode;
  /**
   * How many have left, counted from the full roster.
   *
   * This card used to read `people.length - active.length`, and `people` is the
   * active list — so it was always exactly zero, while the Left tab underneath listed
   * twenty-two. The number it needs is not in the list it is given.
   */
  leftCount?: number;
}) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState(ALL);
  const [shift, setShift] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [sort, setSort] = useState<SortKey>("full_name");
  const [dir, setDir] = useState<Dir>("asc");
  const [size, setSize] = useState(25);
  const [page, setPage] = useState(0);

  const departments = useMemo(
    () => Array.from(new Set(people.map((p) => p.department).filter(Boolean))).sort() as string[],
    [people],
  );
  const managerName = useMemo(() => {
    const byId = new Map(people.map((p) => [p.id, p.full_name]));
    return (id: string | null) => (id ? byId.get(id) ?? "—" : "—");
  }, [people]);

  const shifts = useMemo(
    () => Array.from(new Set(people.map((p) => p.shift_group).filter(Boolean))).sort() as string[],
    [people],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return people.filter((p) => {
      if (dept !== ALL && (p.department ?? "") !== dept) return false;
      if (shift !== ALL && (p.shift_group ?? "") !== shift) return false;
      if (status !== ALL && statusOf(p).label !== status) return false;
      if (type !== ALL && p.employment_type !== type) return false;
      if (!term) return true;
      // Name, number, department and email — the four things somebody actually has
      // to hand when they are looking for a person.
      return [p.full_name, p.employee_ref, p.department, p.email, p.position]
        .some((v) => (v ?? "").toLowerCase().includes(term));
    });
  }, [people, q, dept, shift, status, type]);

  const sorted = useMemo(() => {
    const val = (p: PersonRow): string => {
      switch (sort) {
        case "employee_ref": return p.employee_ref ?? "￿";
        case "department": return p.department ?? "￿";
        case "shift_group": return p.shift_group ?? "￿";
        case "position": return p.position ?? "￿";
        case "manager": return managerName(p.manager_id);
        case "started_on": return p.started_on ?? "￿";
        case "status": return statusOf(p).label;
        default: return p.full_name;
      }
    };
    const s = [...filtered].sort((a, b) => val(a).localeCompare(val(b), undefined, { numeric: true }));
    return dir === "asc" ? s : s.reverse();
  }, [filtered, sort, dir, managerName]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pages - 1);
  const shown = sorted.slice(current * size, current * size + size);

  const head = (key: SortKey, label: string, className?: string) => (
    <TableHead className={className}>
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold hover:text-foreground"
        onClick={() => {
          if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
          else { setSort(key); setDir("asc"); }
          setPage(0);
        }}
      >
        {label}
        {sort !== key ? <ChevronsUpDown className="h-3 w-3 opacity-40" />
          : dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      </button>
    </TableHead>
  );

  const exportCsv = () =>
    downloadCsv(
      `people_${new Date().toISOString().slice(0, 10)}.csv`,
      ["Name", "Employee number", "Position", "Department", "Manager", "Contract", "Shift", "Rota", "Started", "Left", "Status", "Email"],
      sorted.map((p) => [
        p.full_name,
        p.employee_ref ?? "",
        p.position ?? "",
        p.department ?? "",
        managerName(p.manager_id),
        p.employment_type,
        p.shift_group ?? "",
        p.pattern ? `${p.pattern.name} (${describeDays(p.pattern.days)})` : "",
        p.started_on ?? "",
        p.left_on ?? "",
        statusOf(p).label,
        p.email ?? "",
      ]),
    );

  const active = people.filter((p) => p.active);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="Employees" value={String(people.length + leftCount)} hint="On file" />
        <Figure label="Active" value={String(active.length)} hint="Working here" />
        <Figure label="Left" value={String(leftCount)} hint="History kept" />
        <Figure label="Departments" value={String(departments.length)} />
        <Figure label="Agency & contract" value={String(active.filter((p) => p.employment_type !== "permanent").length)} hint="Not permanent" />
        <Figure label="No rota" value={String(active.filter((p) => !p.pattern).length)} hint="Due in every day" />
      </div>

      <Card>
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(0); }}
                placeholder="Name, number, department or email…"
                className="h-9 w-64 pl-8"
              />
            </div>
            <Select value={dept} onValueChange={(v) => { setDept(v); setPage(0); }}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={shift} onValueChange={(v) => { setShift(v); setPage(0); }}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All shifts</SelectItem>
                {shifts.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={(v) => { setType(v); setPage(0); }}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any contract</SelectItem>
                {TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any status</SelectItem>
                {["Active", "No shift", "No rota", "Left"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!sorted.length}>
                <Download className="mr-1 h-4 w-4" /> Export CSV
              </Button>
              {actions}
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <TableRow>
                  {head("full_name", "Employee")}
                  {head("employee_ref", "Number", "hidden sm:table-cell")}
                  {head("department", "Department", "hidden md:table-cell")}
                  {head("manager", "Manager", "hidden xl:table-cell")}
                  {head("shift_group", "Shift")}
                  <TableHead className="hidden lg:table-cell">Rota</TableHead>
                  {head("started_on", "Started", "hidden xl:table-cell")}
                  {head("status", "Status")}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      Nobody matches those filters.
                    </TableCell>
                  </TableRow>
                )}
                {shown.map((p, i) => {
                  const st = statusOf(p);
                  return (
                    <TableRow
                      key={p.id}
                      onClick={() => onOpen(p.id)}
                      className={cn("cursor-pointer", i % 2 === 1 && "bg-muted/30")}
                    >
                      <TableCell className="py-2">
                        <div className="font-medium">{p.full_name}</div>
                        {/* Job title under the name, the way a directory reads it —
                            and it is the answer to "who is this" more often than the
                            department is. */}
                        {p.position && <div className="text-2xs text-muted-foreground">{p.position}</div>}
                        {/* The department sits under the name so the row still says who
                            somebody is on a narrow screen, where its own column is hidden. */}
                        <div className="text-2xs text-muted-foreground md:hidden">{p.department ?? "—"}</div>
                      </TableCell>
                      <TableCell className="hidden font-figure text-xs sm:table-cell">{p.employee_ref ?? "—"}</TableCell>
                      <TableCell className={cn("hidden md:table-cell", !p.department && "text-muted-foreground")}>
                        {p.department ?? "—"}
                      </TableCell>
                      <TableCell className={cn("hidden xl:table-cell text-xs", !p.manager_id && "text-muted-foreground")}>
                        {managerName(p.manager_id)}
                      </TableCell>
                      <TableCell>{p.shift_group ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="hidden text-xs lg:table-cell">
                        {p.pattern
                          ? <span title={describeDays(p.pattern.days)}>{p.pattern.name}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="hidden font-figure text-xs xl:table-cell">
                        {p.started_on ? format(new Date(`${p.started_on}T12:00:00`), "dd/MM/yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline" className={cn("text-2xs", st.cls)}>{st.label}</Badge>
                          {p.employment_type !== "permanent" && (
                            <Badge variant="outline" className={cn("text-2xs capitalize", TYPE_LOOK[p.employment_type])}>
                              {p.employment_type}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Showing {sorted.length === 0 ? 0 : current * size + 1}–{Math.min(sorted.length, current * size + size)} of {sorted.length}
            {sorted.length !== people.length && ` (filtered from ${people.length})`}
            <Select value={String(size)} onValueChange={(v) => { setSize(Number(v)); setPage(0); }}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
                Previous
              </Button>
              <span className="px-2 tabular-nums">{current + 1} / {pages}</span>
              <Button variant="outline" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
