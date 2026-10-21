import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, BadgeCheck, ChevronLeft, ChevronRight, Pencil, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkEmployeeRecord } from "@/components/workforce/LinkEmployeeRecord";
import { badgeRefFromEmail } from "@/lib/employeeAccounts";
import {
  ALL, filterDirectory, filterOptions, paginate, sortByName, type SortDirection,
} from "@/lib/employeeDirectory";
import type { Employee } from "@/hooks/useWorkforce";

export interface EmployeeLogin {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

export const EMPLOYEE_LOGINS_PAGE_SIZE = 25;

/**
 * User Management → Employees: the floor logins, with the person each one is.
 *
 * What it shows about the PERSON — department and shift — is read from the
 * linked `employees` record, the same row Workforce → Employee edits, so the two screens
 * cannot disagree. (`profiles.shift` is not shown: it only knows Day and Night, and the
 * overtime rules read the record's shift group.) A login with no record says so, and a
 * record with nothing set says "Not set" — a gap is never drawn as an empty cell.
 *
 * One Edit Employee button per row. Where a record exists it opens the unified form;
 * where it does not, it opens the account dialog, which is all there is to edit.
 */
export function EmployeeLoginsTable({
  logins, employees, canLinkRecords, canOpenRecords, isLoadingRecords = false, onEdit, rowExtras, emptyText, notice,
}: {
  logins: readonly EmployeeLogin[];
  /**
   * The employee records, or null when this person may not read them (only `workforce.view`
   * can; the table is closed to everyone else). Null is NOT "nobody has a record": the
   * department and shift columns and their filters are left out rather than drawn
   * as a column of false "No employee record".
   */
  employees: readonly Employee[] | null;
  /** May link a login to a record (workforce.manage). */
  canLinkRecords: boolean;
  /** May open a person's record at all. */
  canOpenRecords: boolean;
  isLoadingRecords?: boolean;
  onEdit: (login: EmployeeLogin, record: Employee | null) => void;
  /** Approve, delete and anything else the page owns, per row. */
  rowExtras?: (login: EmployeeLogin) => ReactNode;
  emptyText: string;
  /** A line under the filters, e.g. that the records could not be loaded. */
  notice?: string;
}) {
  const hasRecords = employees !== null;
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState(ALL);
  const [shift, setShift] = useState(ALL);
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(0);

  const recordByLogin = useMemo(() => {
    const map = new Map<string, Employee>();
    for (const e of employees ?? []) if (e.user_id && e.active) map.set(e.user_id, e);
    return map;
  }, [employees]);

  const rows = useMemo(() => logins.map((login) => {
    const record = recordByLogin.get(login.id) ?? null;
    return {
      login, record,
      name: login.name || login.email,
      department: record?.department ?? null,
      shift: record?.shift_group ?? null,
      extra: [login.email, record?.employee_ref, record?.position, badgeRefFromEmail(login.email)],
    };
  }), [logins, recordByLogin]);

  const departmentOptions = useMemo(() => filterOptions(rows.map((r) => r.department)), [rows]);
  const shiftOptions = useMemo(() => filterOptions(rows.map((r) => r.shift)), [rows]);

  const visible = useMemo(
    () => sortByName(filterDirectory(rows, { q, department, shift }), direction),
    [rows, q, department, shift, direction],
  );
  const view = paginate(visible, page, EMPLOYEE_LOGINS_PAGE_SIZE);
  const from = visible.length === 0 ? 0 : view.page * EMPLOYEE_LOGINS_PAGE_SIZE + 1;
  const to = view.page * EMPLOYEE_LOGINS_PAGE_SIZE + view.rows.length;
  const filtering = q.trim() !== "" || department !== ALL || shift !== ALL;

  // Any filter change goes back to page one; sorting keeps the place, and nothing else resets.
  const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0); };

  const notSet = (label: string) => <span className="text-xs text-muted-foreground">{label}</span>;

  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <CardTitle>Employees</CardTitle>
        <div className="flex flex-wrap items-center gap-2" role="search">
          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              value={q} onChange={(e) => change(setQ)(e.target.value)}
              placeholder={hasRecords ? "Search name, badge, department…" : "Search name or badge…"} aria-label="Search employees" className="h-9 pl-8 text-sm"
            />
          </div>
          {hasRecords && <Select value={department} onValueChange={change(setDepartment)}>
            <SelectTrigger className="h-9 w-full text-sm sm:w-44" aria-label="Filter by department"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All departments</SelectItem>
              {departmentOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label === "Not set" ? "No department set" : o.label} ({o.count})</SelectItem>
              ))}
            </SelectContent>
          </Select>}
          {hasRecords && <Select value={shift} onValueChange={change(setShift)}>
            <SelectTrigger className="h-9 w-full text-sm sm:w-44" aria-label="Filter by shift"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All shifts</SelectItem>
              {shiftOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label === "Not set" ? "No shift set" : o.label} ({o.count})</SelectItem>
              ))}
            </SelectContent>
          </Select>}
          <Button
            type="button" variant="outline" size="sm" className="h-9 gap-1.5"
            onClick={() => setDirection(direction === "asc" ? "desc" : "asc")}
            aria-label={direction === "asc" ? "Sorted A to Z. Sort Z to A" : "Sorted Z to A. Sort A to Z"}
          >
            {direction === "asc" ? <ArrowDown className="h-3.5 w-3.5" aria-hidden /> : <ArrowUp className="h-3.5 w-3.5" aria-hidden />}
            {direction === "asc" ? "Name A–Z" : "Name Z–A"}
          </Button>
          {filtering && (
            <Button type="button" variant="ghost" size="sm" className="h-9"
              onClick={() => { setQ(""); setDepartment(ALL); setShift(ALL); setPage(0); }}>
              Clear filters
            </Button>
          )}
        </div>
        {notice && <p className="text-xs text-muted-foreground" role="status">{notice}</p>}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead aria-sort={direction === "asc" ? "ascending" : "descending"}>Name</TableHead>
              <TableHead>Login</TableHead>
              {canLinkRecords && <TableHead>Employee record</TableHead>}
              {hasRecords && <TableHead>Department</TableHead>}
              {hasRecords && <TableHead>Shift</TableHead>}
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.rows.map(({ login, record, name, department: dept, shift: sh }) => {
              const badgeRef = badgeRefFromEmail(login.email);
              const noRecord = hasRecords && !record && !isLoadingRecords;
              return (
                <TableRow key={login.id}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell>
                    {badgeRef
                      ? <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 text-muted-foreground" aria-hidden />Badge <span className="font-mono">{badgeRef}</span></span>
                      : login.email}
                  </TableCell>
                  {canLinkRecords && (
                    <TableCell><LinkEmployeeRecord login={{ id: login.id, email: login.email, name: login.name }} /></TableCell>
                  )}
                  {hasRecords && <TableCell>{dept ?? notSet(noRecord ? "No employee record" : "Not set")}</TableCell>}
                  {hasRecords && <TableCell>{sh ?? notSet(noRecord ? "No employee record" : "Not set")}</TableCell>}
                  <TableCell>
                    <Badge variant={login.active ? "default" : "secondary"}>{login.active ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button" variant="outline" size="sm" className="h-8 gap-1.5"
                        onClick={() => onEdit(login, canOpenRecords ? record : null)}
                        aria-label={`Edit employee ${name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit Employee
                      </Button>
                      {rowExtras?.(login)}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={4 + (canLinkRecords ? 1 : 0) + (hasRecords ? 3 : 0)} className="py-8 text-center text-muted-foreground">
                  {filtering ? "No employees match these filters." : emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {visible.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span aria-live="polite">
              Showing {from}–{to} of {visible.length}{filtering ? ` (filtered from ${rows.length})` : ""}
            </span>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="sm" className="h-8" disabled={view.page === 0}
                onClick={() => setPage(view.page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
              <span className="px-2">Page {view.page + 1} of {view.pages}</span>
              <Button type="button" variant="outline" size="sm" className="h-8" disabled={view.page >= view.pages - 1}
                onClick={() => setPage(view.page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

