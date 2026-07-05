import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { OperatorLineGuard } from "@/components/OperatorLineGuard";
import { useDeviceLineCtx } from "@/contexts/DeviceLineContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProductionInputCard } from "@/components/ProductionInputCard";
import { LineChatButton } from "@/components/LineChatButton";
import { getShift, SHIFT_LABEL } from "@/lib/shifts";
import { Factory, Target, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Navigate } from "react-router-dom";

type Shift = "DAY" | "NIGHT";

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

export default function MyProductionPage() {
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
        <MyProductionContent />
      </OperatorLineGuard>
    </DashboardLayout>
  );
}

function MyProductionContent() {
  const { selectedLineName: line } = useDeviceLineCtx();
  const { profile } = useAuth() as any;

  const today = format(new Date(), "yyyy-MM-dd");
  const shiftCode = getShift(new Date()); // "day" | "night"
  const shift: Shift = shiftCode === "day" ? "DAY" : "NIGHT";
  const shiftLabel = SHIFT_LABEL[shiftCode];

  // Find or create production_sessions row for this line/date/shift
  const sessionQ = useQuery({
    enabled: !!line,
    queryKey: ["my-prod-session", line, today, shift],
    queryFn: async () => {
      const { data: existing, error } = await (supabase as any)
        .from("production_sessions")
        .select("id, session_date, line, shift")
        .eq("session_date", today)
        .eq("line", line)
        .eq("shift", shift)
        .maybeSingle();
      if (error) throw error;
      if (existing) return existing;
      // Try to create
      const { data: created, error: insErr } = await (supabase as any)
        .from("production_sessions")
        .insert({ session_date: today, line, shift })
        .select("id, session_date, line, shift")
        .maybeSingle();
      if (insErr) {
        // If insert not permitted, return null gracefully
        console.warn("[MyProduction] cannot create session:", insErr.message);
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
      }));
    },
    refetchInterval: 30_000,
  });

  const items = itemsQ.data || [];
  const totalActual = items.reduce((s, i) => s + (i.actual_qty || 0), 0);
  const totalOrderQty = items.reduce((s, i) => s + (i.target_qty || 0), 0);
  const overallPct = totalOrderQty > 0 ? (totalActual / totalOrderQty) * 100 : 0;
  const hasManualProduction = totalActual > 0;

  const submitShift = () => {
    toast.success("Shift totals submitted", {
      description: `${totalActual.toLocaleString()} of ${totalOrderQty.toLocaleString()} recorded for ${line} — ${shiftLabel}.`,
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <Card>
        <CardContent className="p-4 md:p-6 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Factory className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xl font-bold">My Production</div>
              <div className="text-sm text-muted-foreground">
                {format(new Date(), "EEEE, dd MMM yyyy")} · {shiftLabel} · <span className="font-medium text-foreground">{line || "—"}</span>
                {profile?.name ? <> · {profile.name}</> : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Target className="h-4 w-4 mr-2" /> Order Qty
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64">
                <div className="text-xs text-muted-foreground">Total Order Qty from scheduled SKUs</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{totalOrderQty.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-1">{line} · {shiftLabel}</div>
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>

      {/* Body */}
      {sessionQ.isLoading || itemsQ.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !sessionId || items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <div className="text-base font-semibold">No SKUs scheduled for this shift.</div>
            <div className="text-sm text-muted-foreground">Contact your Planner.</div>
            <div className="pt-2 flex items-center justify-center gap-2">
              <span className="text-sm">Message the team:</span>
              <LineChatButton />
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <ProductionInputCard
            sessionId={sessionId}
            sessionDate={today}
            line={line}
            shift={shift}
            ragPlanQty={totalOrderQty}
            items={items}
            canEdit={true}
          />

          {/* Footer summary */}
          <Card className="border-primary/30">
            <CardContent className="p-4 md:p-6 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Produced This Shift</div>
                  <div className="text-2xl font-bold tabular-nums">{totalActual.toLocaleString()}</div>
                </div>
                <div className="text-muted-foreground">/</div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Order Qty</div>
                  <div className="text-2xl font-bold tabular-nums">{totalOrderQty.toLocaleString()}</div>
                </div>
                <Badge className={cn("text-white text-base px-3 py-1", hasManualProduction ? ragColor(overallPct) : "bg-muted text-muted-foreground")}>
                  {overallPct.toFixed(0)}%
                </Badge>
              </div>
              <Button size="lg" className="h-11" onClick={submitShift}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Submit Shift
              </Button>
            </CardContent>
            <div className="h-2 w-full bg-muted rounded-b-lg overflow-hidden">
              <div
                className={cn("h-full transition-all", ragColor(overallPct))}
                style={{ width: `${Math.min(100, overallPct)}%` }}
              />
            </div>
            {hasManualProduction && (
              <div className={cn("px-6 pb-3 text-xs font-medium", ragText(overallPct))}>
                {overallPct >= 90 ? "On track" : overallPct >= 70 ? "Slightly behind order qty" : "Below order qty"}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
