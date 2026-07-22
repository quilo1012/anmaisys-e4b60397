import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { OperatorLineGuard } from "@/components/OperatorLineGuard";
import { useDeviceLineCtx } from "@/contexts/DeviceLineContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Target, CheckCircle2, Loader2, Lock, AlertCircle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Navigate, useNavigate } from "react-router-dom";
import { useLineShiftTarget } from "@/hooks/useLineShiftTarget";
import { getCurrentFactoryShift, SHIFT_LABEL } from "@/lib/shifts";
import { PinDialog } from "@/components/PinDialog";

type Shift = "DAY" | "NIGHT";

const normalize = (s: string | null | undefined) => (s || "").trim().toLowerCase();

function ragColor(pct: number): string {
  if (pct >= 90) return "bg-green-600";
  if (pct >= 70) return "bg-amber-500";
  return "bg-red-600";
}
function ragText(pct: number): string {
  if (pct >= 90) return "text-green-600";
  if (pct >= 70) return "text-amber-500";
  return "text-red-600";
}

function manualActualQty(row: any): number {
  const notes = String(row.notes ?? "");
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  const wasEditedAfterSync = createdAt > 0 && updatedAt > createdAt + 1000;
  if (notes.startsWith("itouching:") && !wasEditedAfterSync) return 0;
  return Number(row.actual_qty ?? 0);
}

export default function OperatorPerformancePage() {
  const { role, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!role) return null;
  if (role !== "operator") return <Navigate to="/" replace />;
  return (
    <DashboardLayout>
      <OperatorLineGuard>
        <OperatorPerformanceContent />
      </OperatorLineGuard>
    </DashboardLayout>
  );
}

function OperatorPerformanceContent() {
  const { selectedLineName: line } = useDeviceLineCtx();
  const { profile } = useAuth() as any;
  const [leaderAssigned, setLeaderAssigned] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [unlockedBy, setUnlockedBy] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const navigate = useNavigate();

  const { sessionDate: today, shiftCode } = getCurrentFactoryShift();
  const shift: Shift = shiftCode === "day" ? "DAY" : "NIGHT";
  const shiftLabel = SHIFT_LABEL[shiftCode];

  // Find or create production_sessions row for this line/date/shift
  const sessionQ = useQuery({
    enabled: !!line,
    queryKey: ["my-prod-session", line, today, shift],
    queryFn: async () => {
      const { data: existing, error } = await (supabase as any)
        .from("production_sessions")
        .select("id, session_date, line, shift, leader_name")
        .eq("session_date", today)
        .eq("line", line)
        .eq("shift", shift)
        .maybeSingle();
      if (error) throw error;
      if (existing) return existing;
      const { data: created, error: insErr } = await (supabase as any)
        .from("production_sessions")
        .insert({ session_date: today, line, shift })
        .select("id, session_date, line, shift, leader_name")
        .maybeSingle();
      if (insErr) {
        console.warn("[OperatorPerformance] cannot create session:", insErr.message);
        return null;
      }
      return created;
    },
  });

  const sessionId: string | null = sessionQ.data?.id ?? null;

  const itemsQ = useQuery({
    enabled: !!sessionId,
    queryKey: ["my-prod-items", sessionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_items")
        .select("id, sku_id, target_qty, planned_qty, actual_qty, notes, created_at, updated_at, sku:sku_products(code, name)")
        .eq("session_id", sessionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        sku_id: r.sku_id,
        code: r.sku?.code || "—",
        name: r.sku?.name || "—",
        target_qty: Number(r.target_qty ?? r.planned_qty ?? 0),
        actual_qty: manualActualQty(r),
        is_manual: String(r.notes ?? "").startsWith("manual_sku"),
      }));
    },
    refetchInterval: 30_000,
  });

  // Official target comes from RAG Weekly plan_qty for line+date+shift
  // Use hook's built-in normalized matcher (trim + lowercase + collapse spaces)
  // so whitespace/case differences between device line and RAG row don't hide the plan.
  const ragQ = useLineShiftTarget({
    line,
    date: today,
    shift,
    refetchIntervalMs: 60_000,
  });

  const items = itemsQ.data || [];
  const totalActual = items.reduce((s, i) => s + (i.actual_qty || 0), 0);
  const totalTarget = ragQ.target;
  const overallPct = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;
  const hasManualProduction = totalActual > 0;

  useEffect(() => {
    if (sessionQ.isSuccess) {
      const assigned = !!(sessionQ.data?.leader_name as string | null | undefined)?.trim();
      setLeaderAssigned(assigned);
    }
  }, [sessionQ.isSuccess, sessionQ.data?.leader_name]);

  const submitShift = () => {
    toast.success("Shift totals submitted", {
      description: `${totalActual.toLocaleString()} of ${totalTarget.toLocaleString()} recorded for ${line} — ${shiftLabel}.`,
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <Card>
        <CardContent className="p-4 md:p-6 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Target className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xl font-bold">Target & Performance</div>
              <div className="text-sm text-muted-foreground">
                {format(new Date(), "EEEE, dd MMM yyyy")} · {shiftLabel} · <span className="font-medium text-foreground">{line || "—"}</span>
                {profile?.name ? <> · {profile.name}</> : null}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/operator/my-production")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Production
          </Button>
        </CardContent>
      </Card>

      {/* Body */}
      {sessionQ.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !sessionId ? (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <div className="text-base font-semibold">No active shift session.</div>
            <div className="text-sm text-muted-foreground">Contact your Planner.</div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-primary/30">
          <CardContent className="p-4 md:p-6 space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Produced This Shift</div>
                  <div className="text-2xl font-bold tabular-nums">{totalActual.toLocaleString()}</div>
                </div>
                <div className="text-muted-foreground">/</div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Target (RAG)</div>
                  {unlocked ? (
                    <div className="text-2xl font-bold tabular-nums flex items-center gap-2">
                      {totalTarget.toLocaleString()}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => { setUnlocked(false); setUnlockedBy(null); toast.success("Target locked"); }}
                      >
                        <Lock className="h-3 w-3 mr-1" />
                        Lock
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" className="mt-1" onClick={() => setPinOpen(true)}>
                      <Lock className="h-4 w-4 mr-2" />
                      Enter PIN to view target
                    </Button>
                  )}
                  {leaderAssigned === false && (
                    <div className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-500">
                      <AlertCircle className="h-3 w-3" />
                      <span>No leader assigned — ask the Planner to assign a leader.</span>
                    </div>
                  )}
                </div>
                {unlocked && (
                  <Badge className={cn("text-white text-base px-3 py-1", hasManualProduction ? ragColor(overallPct) : "bg-muted text-muted-foreground")}>
                    {hasManualProduction ? `${overallPct.toFixed(0)}%` : "—"}
                  </Badge>
                )}
              </div>
              <Button size="lg" className="h-11" onClick={submitShift}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Submit Shift
              </Button>
            </div>

            {unlocked && (
              <>
                <div className="h-2 w-full bg-muted rounded-lg overflow-hidden">
                  <div
                    className={cn("h-full transition-all", ragColor(overallPct))}
                    style={{ width: `${Math.min(100, overallPct)}%` }}
                  />
                </div>

                {hasManualProduction && (
                  <div className={cn("text-xs font-medium", ragText(overallPct))}>
                    {overallPct >= 90 ? "On track" : overallPct >= 70 ? "Slightly behind order qty" : "Below order qty"}
                  </div>
                )}
                {unlockedBy && (
                  <div className="text-[11px] text-muted-foreground">Unlocked by {unlockedBy}</div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <PinDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title="Leader PIN"
        description={`Enter your PIN to unlock the target for ${line}.`}
        onSuccess={async (eng) => {
          if (eng.is_leader === false) {
            toast.error("Only Line Leader PINs can unlock the target.");
            return;
          }
          const assigned = (sessionQ.data?.leader_name as string | null | undefined) ?? null;
          if (!assigned?.trim()) {
            toast.error(`No leader is assigned to ${line} · ${shiftLabel} yet. Ask the planner to assign one.`);
            return;
          }
          if (normalize(assigned) !== normalize(eng.name)) {
            toast.error(`${eng.name} is not the leader for ${line} today (${assigned} is).`);
            return;
          }
          setUnlocked(true);
          setUnlockedBy(eng.name);
        }}
      />
    </div>
  );
}
