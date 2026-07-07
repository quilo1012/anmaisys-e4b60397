import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { OperatorLineGuard } from "@/components/OperatorLineGuard";
import { useDeviceLineCtx } from "@/contexts/DeviceLineContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProductionInputCard } from "@/components/ProductionInputCard";
import { LineChatButton } from "@/components/LineChatButton";
import { getCurrentFactoryShift, SHIFT_LABEL } from "@/lib/shifts";
import { Factory, Target, CheckCircle2, Loader2, Search, Plus } from "lucide-react";
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
        is_manual: String(r.notes ?? "").startsWith("manual_sku"),
      }));
    },
    refetchInterval: 30_000,
  });

  // Official target comes from RAG Weekly plan_qty for line+date+shift
  const ragQ = useQuery({
    enabled: !!line,
    queryKey: ["my-prod-rag-target", line, today, shift],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rag_weekly_entries")
        .select("plan_qty")
        .eq("entry_date", today)
        .eq("line", line)
        .eq("shift", shift);
      if (error) throw error;
      return (data || []).reduce((s: number, r: any) => s + Number(r.plan_qty || 0), 0);
    },
    refetchInterval: 60_000,
  });

  const items = itemsQ.data || [];
  const totalActual = items.reduce((s, i) => s + (i.actual_qty || 0), 0);
  const totalOrderQty = items.reduce((s, i) => s + (i.target_qty || 0), 0);
  const totalTarget = Number(ragQ.data || 0);
  const overallPct = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;
  const hasManualProduction = totalActual > 0;

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
                  <Target className="h-4 w-4 mr-2" /> Target
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64">
                <div className="text-xs text-muted-foreground">Total Target (RAG Weekly)</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{totalTarget.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-1">{line} · {shiftLabel}</div>
              </PopoverContent>
            </Popover>
          </div>
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
            <div className="pt-2 flex items-center justify-center gap-2">
              <span className="text-sm">Message the team:</span>
              <LineChatButton />
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Manual SKU search — add an SKU to this shift on the fly */}
          <SkuSearchAdd
            sessionId={sessionId}
            existingSkuIds={items.map((i) => i.sku_id)}
          />

          {items.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No SKUs scheduled for this shift yet. Use the search above to add one manually.
              </CardContent>
            </Card>
          ) : (
            <ProductionInputCard
              sessionId={sessionId}
              sessionDate={today}
              line={line}
              shift={shift}
              ragPlanQty={totalOrderQty}
              items={items}
              canEdit={true}
            />
          )}

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
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Target (RAG)</div>
                  <div className="text-2xl font-bold tabular-nums">{totalTarget.toLocaleString()}</div>
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

function SkuSearchAdd({ sessionId, existingSkuIds }: { sessionId: string; existingSkuIds: string[] }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const searchQ = useQuery({
    enabled: query.trim().length >= 1,
    queryKey: ["sku-search", query.trim()],
    staleTime: 30_000,
    queryFn: async () => {
      const q = query.trim();
      const { data, error } = await (supabase as any)
        .from("sku_products")
        .select("id, code, name")
        .or(`code.ilike.%${q}%,name.ilike.%${q}%`)
        .order("code", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data || []) as { id: string; code: string; name: string }[];
    },
  });

  const existing = useMemo(() => new Set(existingSkuIds), [existingSkuIds]);

  const addSku = async (sku: { id: string; code: string; name: string }) => {
    if (existing.has(sku.id)) {
      toast.info(`${sku.code} is already in this shift`);
      return;
    }
    setAddingId(sku.id);
    const { error } = await (supabase as any).from("production_items").insert({
      session_id: sessionId,
      sku_id: sku.id,
      target_qty: 0,
      planned_qty: 0,
      actual_qty: 0,
      notes: "operator_manual",
    });
    setAddingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Added ${sku.code} to this shift`);
    setQuery("");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["my-prod-items", sessionId] });
  };

  const results = searchQ.data || [];

  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Add SKU manually</div>
        <Popover open={open && (results.length > 0 || searchQ.isFetching)} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => { if (query.trim()) setOpen(true); }}
                placeholder="Search SKU by code or name..."
                className="h-11 pl-9"
                autoComplete="off"
              />
            </div>
          </PopoverTrigger>
          <PopoverContent
            className="p-0 w-[--radix-popover-trigger-width] max-h-72 overflow-auto"
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {searchQ.isFetching ? (
              <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching...
              </div>
            ) : results.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No SKUs found</div>
            ) : (
              <ul className="divide-y">
                {results.map((sku) => {
                  const already = existing.has(sku.id);
                  return (
                    <li key={sku.id} className="flex items-center justify-between gap-2 p-2">
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-semibold truncate">{sku.code}</div>
                        <div className="text-xs text-muted-foreground truncate">{sku.name}</div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={already ? "outline" : "default"}
                        disabled={already || addingId === sku.id}
                        onClick={() => addSku(sku)}
                      >
                        {addingId === sku.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <><Plus className="h-4 w-4 mr-1" />{already ? "Added" : "Add"}</>
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      </CardContent>
    </Card>
  );
}
