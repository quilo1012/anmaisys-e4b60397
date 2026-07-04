import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Save, Target } from "lucide-react";
import { toast } from "sonner";

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
  const key = ["daily-target-card", line, entryDate, shift];

  const q = useQuery({
    enabled: !!line,
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rag_weekly_entries")
        .select("id, line, plan_qty, actual_qty")
        .eq("entry_date", entryDate)
        .eq("shift", shift);
      if (error) throw error;
      const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, "");
      const row = (data || []).find((r: any) => norm(r.line) === norm(line));
      return row ?? null;
    },
    refetchInterval: 15_000,
  });

  const plan = Number(q.data?.plan_qty ?? 0);
  const actual = Number(q.data?.actual_qty ?? 0);
  const pct = plan > 0 ? Math.min(100, Math.round((actual / plan) * 100)) : 0;

  const [val, setVal] = useState<string>(String(actual));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!editing) setVal(String(actual)); }, [actual, editing]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = async () => {
    setEditing(false);
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) { setVal(String(actual)); return; }
    if (n === actual) return;
    setSaving(true);
    let error: any = null;
    if (q.data?.id) {
      ({ error } = await (supabase as any)
        .from("rag_weekly_entries")
        .update({ actual_qty: n })
        .eq("id", q.data.id));
    } else {
      ({ error } = await (supabase as any)
        .from("rag_weekly_entries")
        .insert({ line, entry_date: entryDate, shift, plan_qty: 0, actual_qty: n }));
    }
    setSaving(false);
    if (error) { toast.error(error.message); setVal(String(actual)); return; }
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
    qc.invalidateQueries({ queryKey: key });
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
            <div className="text-2xl font-bold tabular-nums">
              {plan > 0 ? plan.toLocaleString() : "0"}
            </div>
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
                  if (e.key === "Escape") { setVal(String(actual)); setEditing(false); (e.target as HTMLInputElement).blur(); }
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
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Completion</div>
            <div className={`text-2xl font-bold tabular-nums ${plan > 0 ? (pct >= 90 ? "text-emerald-500" : pct >= 60 ? "text-amber-500" : "text-rose-500") : "text-muted-foreground"}`}>
              {plan > 0 ? `${pct}%` : "0"}
            </div>
          </div>
        </div>

        <Progress value={pct} className="h-2" />
      </CardContent>
    </Card>
  );
}
