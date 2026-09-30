import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Save, Target, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useLineShiftTarget } from "@/hooks/useLineShiftTarget";

interface Props {
  line: string;
  entryDate: string; // YYYY-MM-DD
  shift: "DAY" | "NIGHT";
  canEdit?: boolean;
}

/**
 * Always-visible daily target card for the operator screen.
 * Reads/writes rag_weekly_entries.plan_qty / actual_qty for (line, date, shift).
 */
export function DailyTargetCard({ line, entryDate, shift, canEdit = true }: Props) {
  const qc = useQueryClient();

  const q = useLineShiftTarget({
    line,
    date: entryDate,
    shift,
    refetchIntervalMs: 15_000,
  });

  const plan = q.target;
  const actual = q.actual;
  const rowId = q.rowId;
  const pct = plan > 0 ? Math.min(100, Math.round((actual / plan) * 100)) : 0;

  const [val, setVal] = useState<string>(String(actual));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // What did NOT save. The old code reverted the field to the stored value on
  // failure, so a dropped connection silently threw away what the operator had
  // just typed and the only trace was a toast that had already gone. The typed
  // number now stays on screen with a line saying it is not saved yet.
  const [failed, setFailed] = useState<string | null>(null);
  const [planFailed, setPlanFailed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `failed` holds the field open: commit() clears `editing` before it writes, so
  // without this the sync-back below would overwrite the number the operator just
  // typed the moment a save failed — the very thing we are keeping.
  useEffect(() => { if (!editing && !failed) setVal(String(actual)); }, [actual, editing, failed]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const [planVal, setPlanVal] = useState<string>(String(plan));
  const [planEditing, setPlanEditing] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);
  const planTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!planEditing && !planFailed) setPlanVal(String(plan)); }, [plan, planEditing, planFailed]);
  useEffect(() => () => { if (planTimer.current) clearTimeout(planTimer.current); }, []);

  const commit = async () => {
    // Enter reached this without a guard while only the BUTTON was disabled, and
    // when there is no row yet the write is an INSERT into rag_weekly_entries —
    // a table with a non-unique index on (line, entry_date, shift). Two Enters
    // with a glove made two rows for the same line, date and shift, and the RAG
    // then counted that line twice.
    if (saving) return;
    setEditing(false);
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) { setVal(String(actual)); return; }
    if (n === actual) return;
    setFailed(null);
    setSaving(true);
    let error: any = null;
    if (rowId) {
      ({ error } = await (supabase as any)
        .from("rag_weekly_entries")
        .update({ actual_qty: n })
        .eq("id", rowId));
    } else {
      ({ error } = await (supabase as any)
        .from("rag_weekly_entries")
        .insert({ line, entry_date: entryDate, shift, plan_qty: 0, actual_qty: n }));
    }
    setSaving(false);
    if (error) { toast.error(error.message); setFailed(error.message || "Not saved."); return; }
    setFailed(null);
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
    qc.invalidateQueries({ queryKey: q.queryKey as unknown as unknown[] });
  };

  const commitPlan = async () => {
    if (planSaving) return; // see commit() above — same duplicate-insert path
    setPlanEditing(false);
    const n = Number(planVal);
    if (!Number.isFinite(n) || n < 0) { setPlanVal(String(plan)); return; }
    if (n === plan) return;
    setPlanFailed(null);
    setPlanSaving(true);
    let error: any = null;
    if (rowId) {
      ({ error } = await (supabase as any)
        .from("rag_weekly_entries")
        .update({ plan_qty: n })
        .eq("id", rowId));
    } else {
      ({ error } = await (supabase as any)
        .from("rag_weekly_entries")
        .insert({ line, entry_date: entryDate, shift, plan_qty: n, actual_qty: 0 }));
    }
    setPlanSaving(false);
    if (error) { toast.error(error.message); setPlanFailed(error.message || "Not saved."); return; }
    setPlanFailed(null);
    setPlanSaved(true);
    if (planTimer.current) clearTimeout(planTimer.current);
    planTimer.current = setTimeout(() => setPlanSaved(false), 2000);
    qc.invalidateQueries({ queryKey: q.queryKey as unknown as unknown[] });
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="p-4 md:p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Daily Target · {line} · {shift}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">{entryDate}</div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Target</div>
            {q.isLoading ? (
              <Skeleton className="h-8 w-20 mt-1" />
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  disabled={!canEdit || planSaving}
                  value={planVal}
                  onFocus={() => setPlanEditing(true)}
                  onChange={(e) => setPlanVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitPlan(); }
                    if (e.key === "Escape") { setPlanFailed(null); setPlanVal(String(plan)); setPlanEditing(false); (e.target as HTMLInputElement).blur(); }
                  }}
                  className="h-10 w-28 text-lg font-bold tabular-nums text-right px-2"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={commitPlan}
                  disabled={!canEdit || planSaving || Number(planVal) === plan}
                  className="h-10"
                >
                  {planSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : planSaved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  <span className="ml-1">{planSaved ? "Saved" : "Save"}</span>
                </Button>
              </div>
            )}
            {planFailed && (
              <p role="alert" className="mt-1 text-xs font-medium text-destructive-strong">
                Not saved — {planFailed} Your number is still here; press Save again.
              </p>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Actual</div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="numeric"
                disabled={!canEdit || saving}
                value={val}
                onFocus={() => setEditing(true)}
                onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commit(); }
                  if (e.key === "Escape") { setFailed(null); setVal(String(actual)); setEditing(false); (e.target as HTMLInputElement).blur(); }
                }}
                className="h-10 w-28 text-lg font-bold tabular-nums text-right px-2"
              />
              <Button
                type="button"
                size="sm"
                onClick={commit}
                disabled={!canEdit || saving || Number(val) === actual}
                className="h-10"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                <span className="ml-1">{saved ? "Saved" : "Save"}</span>
              </Button>
            </div>
            {failed && (
              <p role="alert" className="mt-1 text-xs font-medium text-destructive-strong">
                Not saved — {failed} Your number is still here; press Save again.
              </p>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Completion</div>
            {q.isLoading ? (
              <Skeleton className="h-8 w-16 mt-1" />
            ) : (
              <div className={`text-2xl font-bold tabular-nums ${plan > 0 ? (pct >= 90 ? "text-success-strong" : pct >= 60 ? "text-warning-strong" : "text-destructive-strong") : "text-muted-foreground"}`}>
                {plan > 0 ? `${pct}%` : "0"}
              </div>
            )}
          </div>
        </div>

        {!q.isLoading && plan === 0 && !q.isError && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border border-dashed rounded-md px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5" />
            No target planned yet for this line/shift.
          </div>
        )}
        {q.isError && (
          <div className="flex items-center gap-2 text-xs text-destructive-strong border border-destructive/40 rounded-md px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5" />
            Failed to load target. Retrying…
          </div>
        )}

        <Progress value={pct} className="h-2" />
      </CardContent>
    </Card>
  );
}
