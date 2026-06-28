import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle, MessageSquare, User, RefreshCw, Target, BarChart3, ShieldAlert } from "lucide-react";
import { format } from "date-fns";

interface TabletProps {
  productionLine: string;
  shiftType: "DAY" | "NIGHT";
  date?: string;
}

export function TabletProductionView({
  productionLine,
  shiftType,
  date = format(new Date(), "yyyy-MM-dd"),
}: TabletProps) {
  const qc = useQueryClient();
  const [operatorName, setOperatorName] = useState("");
  const [operatorNotes, setOperatorNotes] = useState("");

  // 1. Session + items
  const { data: sessionData, isLoading: loadingSession, refetch: refetchSession } = useQuery({
    queryKey: ["tablet_session", productionLine, date, shiftType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_sessions")
        .select(`id, locked, notes, leader_name,
                 production_items (sku_code, sku_name, target_qty, planned_qty, actual_qty)`)
        .eq("line", productionLine)
        .eq("session_date", date)
        .eq("shift", shiftType)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });


  // 2. RAG planned target
  const { data: ragData, isLoading: loadingRag } = useQuery({
    queryKey: ["tablet_rag", productionLine, date, shiftType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rag_weekly_entries")
        .select("plan_qty, actual_qty")
        .eq("line", productionLine)
        .eq("entry_date", date)
        .eq("shift", shiftType)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const items = (sessionData?.production_items ?? []) as Array<{
    sku_code: string; sku_name: string;
    target_qty: number | null; planned_qty: number | null; actual_qty: number | null;
  }>;

  const totalTarget =
    Number(ragData?.plan_qty ?? 0) ||
    items.reduce((s, i) => s + Number(i.target_qty ?? i.planned_qty ?? 0), 0);
  const totalActual = items.reduce((s, i) => s + Number(i.actual_qty ?? 0), 0);
  const efficiency = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

  useEffect(() => {
    if (sessionData?.comments) setOperatorNotes(sessionData.comments);
    if (sessionData?.line_leader) setOperatorName(sessionData.line_leader);
  }, [sessionData]);

  const submitShiftMutation = useMutation({
    mutationFn: async () => {
      if (!sessionData?.id) throw new Error("No active session for this line/shift.");
      const { error: sErr } = await supabase
        .from("production_sessions")
        .update({ line_leader: operatorName, comments: operatorNotes })
        .eq("id", sessionData.id);
      if (sErr) throw sErr;
      await supabase
        .from("rag_weekly_entries")
        .update({ actual_qty: totalActual })
        .eq("line", productionLine)
        .eq("entry_date", date)
        .eq("shift", shiftType);
    },
    onSuccess: () => {
      toast.success("Shift saved & synced to RAG Weekly");
      qc.invalidateQueries({ queryKey: ["tablet_session"] });
      qc.invalidateQueries({ queryKey: ["tablet_rag"] });
    },
    onError: (err: any) => toast.error(err.message ?? "Failed to save shift"),
  });

  if (loadingSession || loadingRag) {
    return (
      <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Loading tablet data...
      </div>
    );
  }

  const locked = !!sessionData?.locked;

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-bold">{productionLine}</div>
          <div className="text-xs text-muted-foreground">
            Shift: {shiftType === "DAY" ? "☀️ DAY" : "🌙 NIGHT"} ·{" "}
            {format(new Date(date + "T12:00:00"), "dd/MM/yyyy")}
          </div>
        </div>
        <Button variant="outline" onClick={() => refetchSession()} className="h-9 w-9 p-0 rounded-xl">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border p-4 text-center">
          <Target className="h-5 w-5 mx-auto mb-1 text-primary" />
          <div className="text-2xl font-bold">{totalTarget.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Target (RAG)</div>
        </div>
        <div className="rounded-2xl border p-4 text-center">
          <BarChart3 className="h-5 w-5 mx-auto mb-1 text-primary" />
          <div className="text-2xl font-bold">{totalActual.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">iTouching Actual</div>
        </div>
        <div className="rounded-2xl border p-4 text-center">
          <div className="text-lg mb-1">⚡</div>
          <div
            className={`text-2xl font-bold ${
              efficiency >= 100 ? "text-green-600" : efficiency >= 80 ? "text-amber-500" : "text-destructive"
            }`}
          >
            {efficiency}%
          </div>
          <div className="text-xs text-muted-foreground">Efficiency</div>
        </div>
      </div>

      {/* Items */}
      <div className="rounded-2xl border p-3">
        <div className="text-sm font-semibold mb-2">SKUs on this line</div>
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground p-2">No active SKU detected today.</div>
        ) : (
          <ul className="divide-y">
            {items.map((it) => (
              <li key={it.sku_code} className="py-2 flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium">{it.sku_code}</div>
                  <div className="text-xs text-muted-foreground">{it.sku_name}</div>
                </div>
                <div className="text-right tabular-nums">
                  <span className="font-semibold">{Number(it.actual_qty ?? 0).toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">
                    {" "}/ {Number(it.target_qty ?? it.planned_qty ?? 0).toLocaleString()} un
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Operator inputs */}
      <div className="space-y-3">
        <div>
          <Label className="flex items-center gap-1 text-xs mb-1">
            <User className="h-3 w-3" /> Shift operator *
          </Label>
          <Input
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            placeholder="Full name"
            className="h-11 rounded-xl text-sm"
            disabled={locked}
            autoComplete="off"
          />
        </div>
        <div>
          <Label className="flex items-center gap-1 text-xs mb-1">
            <MessageSquare className="h-3 w-3" /> Shift log / occurrences
          </Label>
          <Textarea
            value={operatorNotes}
            onChange={(e) => setOperatorNotes(e.target.value)}
            placeholder="Downtime, missing components, quality issues..."
            rows={4}
            className="rounded-xl text-sm resize-none"
            disabled={locked}
          />
        </div>
      </div>

      {!locked ? (
        <Button
          onClick={() => submitShiftMutation.mutate()}
          disabled={submitShiftMutation.isPending || !operatorName.trim()}
          className="w-full h-12 rounded-2xl font-bold text-sm"
        >
          {submitShiftMutation.isPending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4 mr-2" />
          )}
          Save & sync to RAG Weekly
        </Button>
      ) : (
        <div className="bg-muted border rounded-2xl p-4 text-center flex items-center justify-center gap-2 text-xs text-muted-foreground font-medium">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          This shift is locked and validated by management.
        </div>
      )}
    </div>
  );
}
