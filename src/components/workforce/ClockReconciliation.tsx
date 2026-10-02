import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Figure, FigureRow } from "@/components/ui/Figure";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReadFailed } from "@/components/workforce/ReadFailed";
import { fetchAllRows } from "@/lib/fetchAllRows";
import {
  RECONCILIATION_KINDS, reconciliationMeta, summariseReconciliation,
  type ReconciliationKind,
} from "@/lib/boardClockStatus";

/**
 * Who the board and the clock disagree about, by name.
 *
 * Read-only, and that is a decision rather than an omission. The board is the plan,
 * written in the morning; the clock is the record, written by the door. Neither
 * corrects the other, so there is no button here that reconciles anything — a screen
 * that offered one would be claiming an authority the system has deliberately not
 * given either source.
 *
 * It reads `v_board_clock_reconciliation`, which carries the same rule as the count
 * behind the day badge. The two were checked against each other across all 123
 * (date, board) pairs and agree exactly.
 */

interface Row {
  on_date: string;
  shift: string;
  employee_id: string;
  kind: ReconciliationKind | string;
  board_status: string | null;
  worked_minutes: number | null;
}

const hm = (m: number | null) => {
  if (m === null || !Number.isFinite(m)) return "—";
  const s = m < 0 ? "-" : "";
  const a = Math.abs(m);
  return `${s}${Math.floor(a / 60)}h ${String(a % 60).padStart(2, "0")}m`;
};

const fmtDate = (d: string) => (d ? d.split("-").reverse().join("/") : "—");

const TONE: Record<string, string> = {
  planned_not_clocked: "border-warning/40 bg-warning/10 text-warning-strong",
  clocked_not_planned: "border-primary/40 bg-primary/10 text-primary",
  not_comparable: "border-border bg-muted text-muted-foreground",
};

export function ClockReconciliation({
  from,
  to,
  nameById,
}: {
  from: string;
  to: string;
  /** Names come from the roster this page already loaded, not from a second read. */
  nameById: Map<string, string>;
}) {
  const { data: rows = [], isError, isPending, refetch } = useQuery({
    queryKey: ["board_clock_reconciliation", from, to],
    queryFn: () =>
      // Paged: a wide period over a factory of 200 runs past the thousand-row cap long
      // before it runs out of days, and a truncated reconciliation is the worst kind —
      // it shows fewer disagreements than there are and looks like progress.
      fetchAllRows<Row>({
        range: (a, b) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view newer than the generated types
          (supabase as any)
            .from("v_board_clock_reconciliation")
            .select("on_date, shift, employee_id, kind, board_status, worked_minutes")
            .gte("on_date", from)
            .lte("on_date", to)
            .order("on_date", { ascending: false })
            .order("shift", { ascending: true })
            .order("employee_id", { ascending: true })
            .range(a, b),
      }),
  });

  const totals = useMemo(() => summariseReconciliation(rows), [rows]);

  if (isError) return <ReadFailed what="The board and clock comparison" onRetry={() => void refetch()} />;

  return (
    <div className="space-y-4">
      {/* The rule, said once and at the top, because every number below is read
          differently depending on whether you think one source should win. */}
      <p className="rounded-lg border bg-muted/30 p-3 text-sm">
        The board is the plan and the clock is the record. <strong>Neither corrects the other</strong>, so
        nothing here can be edited — this is a list of what to go and ask about, not a list of errors to fix.
      </p>

      <FigureRow>
        <Figure
          lead
          label="Disagreements"
          value={isPending ? "—" : String(totals.disagreements)}
          hint="The two kinds below that can actually be compared"
        />
        <Figure
          label="Planned, not clocked"
          value={isPending ? "—" : String(totals.plannedNotClocked)}
          tone={totals.plannedNotClocked > 0 ? "owed" : "neutral"}
        />
        <Figure
          label="Clocked, not planned"
          value={isPending ? "—" : String(totals.clockedNotPlanned)}
        />
        <Figure
          label="No clock record"
          value={isPending ? "—" : String(totals.notComparable)}
          hint="Not counted above — nothing to compare"
        />
      </FigureRow>

      {/* What each column of the table means, before the table. Three sentences the
          reader needs once and never again, so they are not repeated per row. */}
      <dl className="grid gap-2 text-xs sm:grid-cols-3">
        {RECONCILIATION_KINDS.map((k) => (
          <div key={k.kind} className="rounded-md border p-2">
            <dt><Badge variant="outline" className={TONE[k.kind]}>{k.label}</Badge></dt>
            <dd className="mt-1 text-muted-foreground">{k.meaning}</dd>
          </div>
        ))}
      </dl>

      {isPending ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Comparing the board against the clock…</p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing to compare in this period. Either no day in it has been imported from the clock, or every
          board in it agreed with what the clock recorded.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Board</TableHead>
              <TableHead>Person</TableHead>
              <TableHead>What differs</TableHead>
              <TableHead className="text-right">Clocked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const meta = reconciliationMeta(r.kind);
              return (
                <TableRow key={`${r.on_date}|${r.shift}|${r.employee_id}|${r.kind}|${i}`}>
                  <TableCell className="tabular-nums">{fmtDate(r.on_date)}</TableCell>
                  <TableCell>{r.shift}</TableCell>
                  {/* A name the roster does not have is an inactive employee the board
                      still names. Said as such rather than left blank. */}
                  <TableCell className="font-medium">
                    {nameById.get(r.employee_id) ?? <span className="text-muted-foreground">No longer on the roster</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={TONE[r.kind] ?? ""} title={meta?.meaning}>
                      {meta?.label ?? r.kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{hm(r.worked_minutes)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
