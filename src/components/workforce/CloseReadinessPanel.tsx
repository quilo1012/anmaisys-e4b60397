/**
 * "Before you close": what still stands between this pay period and a close nobody has
 * to redo (`closeReadiness`). Reads only; changes no figure on the close.
 *
 * Under components/workforce because it reads `employees` through the payslip drafts,
 * and the roster is read only behind an HR-gated screen.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleAlert, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ClosePerson } from "@/lib/financeClose";
import { closeReadiness, type ReadinessItem } from "@/lib/closeReadiness";
import { PENDING_RPCS } from "@/lib/pendingRpcs";
import { assemblePayslipDrafts, fetchPayslipRaw } from "@/components/workforce/payslipDraftData";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Props {
  rows: ReadonlyArray<ClosePerson & { lineName?: string | null }>;
  period: { id: string; name: string; start_date: string; end_date: string } | null;
  to: string;
  today: string;
  /** Puts a name in the close's search, so the row is one click away. */
  onPick: (name: string) => void;
}

/** The facts the readiness list needs, each failing on its own without taking the rest down. */
function useReadinessFacts(period: Props["period"], from: string, to: string) {
  const clock = useQuery({
    queryKey: ["close-readiness", "clock-reach"],
    queryFn: async (): Promise<string | null> => {
      // The last day somebody WORKED, not the last row: the TimeMoto export carries the
      // rota's future days with 0 worked, so on 07/11 the last row was 08/11 while the
      // hours stopped at 02/11 — the panel would have said the whole period was covered.
      const { data, error } = await db.from("attendance_days").select("on_date")
        .gt("worked_minutes", 0)
        .order("on_date", { ascending: false }).limit(1);
      if (error) throw error;
      return (data?.[0]?.on_date as string | undefined) ?? null;
    },
    staleTime: 60_000,
  });
  const raw = useQuery({
    queryKey: ["close-readiness", "raw", period?.id, from, to],
    enabled: !!period && !!from && !!to,
    queryFn: () => fetchPayslipRaw(from, to),
    staleTime: 60_000,
  });
  const pending = useQuery({
    queryKey: ["close-readiness", "pending-blocks"],
    queryFn: async (): Promise<string[]> => {
      const missing: string[] = [];
      for (const p of PENDING_RPCS.filter((x) => x.probe)) {
        const { error } = await db.rpc(p.name, p.probe);
        if ((error as { code?: string } | null)?.code === "PGRST202") missing.push(`${p.block.split(" — ")[0]} (${p.name})`);
      }
      return missing;
    },
    staleTime: 5 * 60_000,
  });
  return { clock, raw, pending };
}

const ICON = {
  block: <CircleAlert className="h-4 w-4 shrink-0 text-destructive" aria-hidden />,
  check: <AlertTriangle className="h-4 w-4 shrink-0 text-warning-strong" aria-hidden />,
  ok: <CheckCircle2 className="h-4 w-4 shrink-0 text-success-strong" aria-hidden />,
};

function Item({ item, onPick }: { item: ReadinessItem; onPick: (name: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? item.people : item.people.slice(0, 6);
  return (
    <li className="flex gap-2 py-1.5" data-testid={`readiness-${item.key}`} data-level={item.level}>
      {ICON[item.level]}
      <div className="min-w-0 flex-1 text-sm">
        <p className={item.level === "ok" ? "text-muted-foreground" : "font-medium"}>{item.title}</p>
        {item.action && <p className="text-xs text-muted-foreground">{item.action}</p>}
        {item.people.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {shown.map((p) => (
              <li key={p.employeeId}>
                <button
                  type="button"
                  onClick={() => onPick(p.name)}
                  className="rounded border bg-muted/40 px-1.5 py-0.5 text-xs hover:bg-muted"
                  title="Show this person in the close"
                >
                  <span className="font-medium">{p.name}</span> <span className="text-muted-foreground">{p.detail}</span>
                </button>
              </li>
            ))}
            {item.people.length > 6 && (
              <li>
                <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setAll((v) => !v)}>
                  {all ? <>Fewer <ChevronUp className="ml-1 h-3 w-3" /></> : <>+{item.people.length - 6} more <ChevronDown className="ml-1 h-3 w-3" /></>}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
    </li>
  );
}

export function CloseReadinessPanel({ rows, period, to, today, onPick }: Props) {
  const from = period?.start_date ?? "";
  const { clock, raw, pending } = useReadinessFacts(period, from, to);
  const drafts = useMemo(
    () => (period && raw.data ? assemblePayslipDrafts(rows, raw.data, { period, to, today, now: new Date() }) : null),
    [rows, raw.data, period, to, today],
  );
  const [open, setOpen] = useState(true);
  if (!period || clock.isPending) return null;

  const r = closeReadiness({
    rows, drafts, clockReach: clock.data ?? null, to, pendingBlocks: pending.data ?? [],
  });
  return (
    <Card className="print:hidden" data-testid="close-readiness">
      <CardContent className="p-3">
        <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="flex items-center gap-2">
            {r.ready ? ICON.ok : ICON.block}
            <span className="font-semibold">Before you close {period.name}</span>
            <span className="text-sm text-muted-foreground">
              {r.ready ? (r.open ? `Ready · ${r.open} to check` : "Ready to close") : `Not ready · ${r.open} to sort out`}
            </span>
          </span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {open && (
          <>
            <ul className="mt-2 divide-y">
              {r.items.map((i) => <Item key={i.key} item={i} onPick={onPick} />)}
            </ul>
            {raw.isPending && <p className="mt-1 text-xs text-muted-foreground">Checking overtime and absences…</p>}
            {raw.isError && <p className="mt-1 text-xs text-destructive">Overtime and absences could not be checked: {String((raw.error as Error)?.message ?? raw.error)}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
