import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { OperatorLineGuard } from "@/components/OperatorLineGuard";
import { useDeviceLineCtx } from "@/contexts/DeviceLineContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProductionInputCard } from "@/components/ProductionInputCard";
import { LineChatButton } from "@/components/LineChatButton";
import { PinDialog, type EngineerIdentity } from "@/components/PinDialog";
import { canUseLineChat } from "@/lib/permissions";
import { getCurrentFactoryShift, SHIFT_LABEL } from "@/lib/shifts";
import { Factory, Target, Loader2, Search, Plus, Lock, AlertCircle, AlertTriangle, Send } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Navigate, useNavigate } from "react-router-dom";
import { useLineShiftTarget } from "@/hooks/useLineShiftTarget";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveProblemsForLine } from "@/hooks/useLineProblemDescriptions";
import { useCreateWorkOrder } from "@/hooks/useWorkOrders";

type Shift = "DAY" | "NIGHT";


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
  const { selectedLineName: line, selectedLineId: lineId } = useDeviceLineCtx();
  const { profile, role } = useAuth() as any;
  const navigate = useNavigate();
  const [targetUnlocked, setTargetUnlocked] = useState(false);
  const [leaderAssigned, setLeaderAssigned] = useState<boolean | null>(null);

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
  const ragQ = useLineShiftTarget({
    line,
    date: today,
    shift,
    matchLine: (rowLine) => rowLine === line,
    refetchIntervalMs: 60_000,
  });

  const items = itemsQ.data || [];
  const totalTarget = ragQ.target;

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
            <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/operator/performance")}>
              View Performance
            </Button>
            <TargetPinGate line={line} shiftLabel={shiftLabel} totalTarget={totalTarget} produced={items.reduce((s: number, i: any) => s + Number(i.actual_qty || 0), 0)} onUnlockChange={setTargetUnlocked} onLeaderAssignedChange={setLeaderAssigned} />
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
              {canUseLineChat(role) && <LineChatButton />}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <LogProductionCard sessionId={sessionId} />

          {items.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No SKUs scheduled for this shift yet. Use "+ Add SKU" below to add one manually.
              </CardContent>
            </Card>
          ) : (
            <ProductionInputCard
              sessionId={sessionId}
              sessionDate={today}
              line={line}
              shift={shift}
              ragPlanQty={totalTarget}
              items={items}
              canEdit={true}
            />
          )}

          {/* Manual SKU search — add an SKU to this shift on the fly */}
          <SkuSearchAdd
            sessionId={sessionId}
            existingSkuIds={items.map((i) => i.sku_id)}
          />
        </>
      )}
    </div>
  );
}

function SkuSearchAdd({ sessionId, existingSkuIds }: { sessionId: string; existingSkuIds: string[] }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  // 300ms debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);


  const searchQ = useQuery({
    enabled: expanded && debounced.length >= 1,
    queryKey: ["sku-search", debounced],
    staleTime: 30_000,
    queryFn: async () => {
      const q = debounced;
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
      notes: "manual_sku",
    });
    setAddingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Added ${sku.code} to this shift`);
    setQuery("");
    setDebounced("");
    setOpen(false);
    setExpanded(false);
    qc.invalidateQueries({ queryKey: ["my-prod-items", sessionId] });
  };

  const results = searchQ.data || [];

  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-2">
        {!expanded ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => setExpanded(true)}
          >
            <Plus className="h-4 w-4 mr-2" /> Add SKU
          </Button>
        ) : (
          <>
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Add SKU manually</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setExpanded(false); setQuery(""); setDebounced(""); setOpen(false); }}
          >
            Cancel
          </Button>
        </div>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TargetPinGate({ line, shiftLabel, totalTarget, produced = 0, onUnlockChange, onLeaderAssignedChange }: { line: string; shiftLabel: string; totalTarget: number; produced?: number; onUnlockChange?: (v: boolean) => void; onLeaderAssignedChange?: (v: boolean) => void }) {
  const [pinOpen, setPinOpen] = useState(false);
  const [leader, setLeader] = useState<{ name: string; matched: boolean } | null>(null);
  const [open, setOpen] = useState(false);


  const { sessionDate: today, shiftCode } = getCurrentFactoryShift();
  const shift: Shift = shiftCode === "day" ? "DAY" : "NIGHT";

  const normalize = (s: string | null | undefined) => (s || "").trim().toLowerCase();

  // Leader assigned to THIS line/date/shift on production_sessions.
  const assignedQ = useQuery({
    enabled: !!line,
    queryKey: ["target-gate-leader", line, today, shift],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("production_sessions")
        .select("leader_name")
        .eq("session_date", today)
        .eq("line", line)
        .eq("shift", shift)
        .maybeSingle();
      return (data?.leader_name as string | null) ?? null;
    },
    refetchInterval: 60_000,
  });
  const assignedLeader = assignedQ.data;

  useEffect(() => {
    if (assignedQ.isSuccess) {
      onLeaderAssignedChange?.(!!assignedLeader?.trim());
    }
  }, [assignedQ.isSuccess, assignedLeader, onLeaderAssignedChange]);

  const authorized = !!leader?.matched;

  useEffect(() => { onUnlockChange?.(authorized); }, [authorized, onUnlockChange]);

  const onClick = () => {
    if (leader) {
      if (authorized) setOpen((v) => !v);
      else toast.error(`This PIN is not the leader assigned to ${line} for this shift.`);
      return;
    }
    setPinOpen(true);
  };

  return (
    <>
      <Popover open={open && authorized} onOpenChange={(v) => authorized && setOpen(v)}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" onClick={onClick}>
            {authorized ? <Target className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
            Target
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64">
          <div className="text-xs text-muted-foreground">Total Target (RAG Weekly)</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{totalTarget.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-1">{line} · {shiftLabel}</div>
          <div className="mt-3 pt-3 border-t space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Produced</span>
              <span className="text-lg font-semibold tabular-nums">{Number(produced || 0).toLocaleString()}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">% of Target</span>
              {totalTarget > 0 ? (
                (() => {
                  const pct = (Number(produced || 0) / totalTarget) * 100;
                  const cls = pct >= 90 ? "text-emerald-600" : pct >= 70 ? "text-amber-600" : "text-red-600";
                  return <span className={`text-lg font-semibold tabular-nums ${cls}`}>{pct.toFixed(1)}%</span>;
                })()
              ) : (
                <span className="text-lg font-semibold tabular-nums text-muted-foreground">—</span>
              )}
            </div>
          </div>
          {leader && <div className="text-[11px] text-muted-foreground mt-2">Unlocked by {leader.name}</div>}
          <Button
            variant="secondary"
            size="sm"
            className="w-full mt-3"
            onClick={() => {
              setLeader(null);
              setOpen(false);
              toast.success("Target locked");
            }}
          >
            <Lock className="h-4 w-4 mr-2" />
            Lock target
          </Button>
        </PopoverContent>
      </Popover>
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
          if (!assignedLeader) {
            setLeader({ name: eng.name, matched: false });
            toast.error(`No leader is assigned to ${line} · ${shiftLabel} yet. Ask the planner to assign one.`);
            return;
          }
          const matched = normalize(assignedLeader) === normalize(eng.name);
          setLeader({ name: eng.name, matched });
          if (!matched) {
            toast.error(`${eng.name} is not the leader for ${line} today (${assignedLeader} is).`);
            return;
          }
          setOpen(true);
        }}
      />
    </>
  );
}

function LogProductionCard({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const [skuQuery, setSkuQuery] = useState("");
  const [skuDebounced, setSkuDebounced] = useState("");
  const [selectedSku, setSelectedSku] = useState<{ id: string; code: string; name: string } | null>(null);
  const [skuPopoverOpen, setSkuPopoverOpen] = useState(false);
  const [batch, setBatch] = useState("");
  const [blender, setBlender] = useState<number | null>(null);
  const [qty, setQty] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSkuDebounced(skuQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [skuQuery]);

  const searchQ = useQuery({
    enabled: skuPopoverOpen && skuDebounced.length >= 1,
    queryKey: ["log-prod-sku-search", skuDebounced],
    staleTime: 30_000,
    queryFn: async () => {
      const q = skuDebounced;
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

  const results = searchQ.data || [];

  const pickSku = (s: { id: string; code: string; name: string }) => {
    setSelectedSku(s);
    setSkuQuery(`${s.code} — ${s.name}`);
    setSkuPopoverOpen(false);
  };

  const reset = () => {
    setSelectedSku(null);
    setSkuQuery("");
    setSkuDebounced("");
    setBatch("");
    setBlender(null);
    setQty("");
  };

  const onSave = async () => {
    const quantity = Number(qty);
    const blenderNum = Number(blender);
    if (!selectedSku) { toast.error("Select the SKU"); return; }
    if (!Number.isFinite(blenderNum) || !Number.isInteger(blenderNum) || blenderNum < 1) { toast.error("Enter a valid blender number"); return; }
    if (!Number.isFinite(quantity) || quantity <= 0) { toast.error("Enter a quantity greater than 0"); return; }

    setSaving(true);
    try {
      // 1) Find or create production_items row for this session + SKU
      const { data: existingItem, error: findErr } = await (supabase as any)
        .from("production_items")
        .select("id, blender_ref")
        .eq("session_id", sessionId)
        .eq("sku_id", selectedSku.id)
        .maybeSingle();
      if (findErr) throw findErr;

      let itemId: string | null = existingItem?.id ?? null;
      if (!itemId) {
        const { data: created, error: insErr } = await (supabase as any)
          .from("production_items")
          .insert({
            session_id: sessionId,
            sku_id: selectedSku.id,
            target_qty: 0,
            planned_qty: 0,
            actual_qty: 0,
            notes: "manual_sku",
            blender_ref: batch || null,
          })
          .select("id")
          .maybeSingle();
        if (insErr) throw insErr;
        itemId = created?.id ?? null;
      } else if (batch) {
        // Update batch reference if changed / newly provided
        await (supabase as any)
          .from("production_items")
          .update({ blender_ref: batch })
          .eq("id", itemId);
      }
      if (!itemId) throw new Error("Could not resolve production item");

      // 2) Insert blender entry (upsert on unique (item, blender) to accumulate)
      const { data: existingEntry } = await (supabase as any)
        .from("production_blender_entries")
        .select("id, quantity")
        .eq("production_item_id", itemId)
        .eq("blender_number", blenderNum)
        .maybeSingle();

      const { data: userRes } = await (supabase as any).auth.getUser();
      const uid = userRes?.user?.id ?? null;

      if (existingEntry?.id) {
        const { error: upErr } = await (supabase as any)
          .from("production_blender_entries")
          .update({ quantity: Number(existingEntry.quantity || 0) + quantity, entered_by: uid })
          .eq("id", existingEntry.id);
        if (upErr) throw upErr;
      } else {
        const { error: insEntryErr } = await (supabase as any)
          .from("production_blender_entries")
          .insert({
            session_id: sessionId,
            production_item_id: itemId,
            blender_number: blenderNum,
            quantity,
            entered_by: uid,
          });
        if (insEntryErr) throw insEntryErr;
      }

      // 3) actual_qty is auto-synced by DB trigger from blender entries.
      toast.success(`Logged ${quantity} on Blender ${blenderNum} for ${selectedSku.code}`);
      reset();
      qc.invalidateQueries({ queryKey: ["my-prod-items", sessionId] });
      qc.invalidateQueries({ queryKey: ["blender-entries"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to save entry");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Log Production</div>
            <div className="text-xs text-muted-foreground">Record a produced batch to the current shift.</div>
          </div>
        </div>

        {/* SKU */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">SKU produced</div>
          <Popover open={skuPopoverOpen && (results.length > 0 || searchQ.isFetching)} onOpenChange={setSkuPopoverOpen}>
            <PopoverTrigger asChild>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={skuQuery}
                  onChange={(e) => { setSkuQuery(e.target.value); setSelectedSku(null); setSkuPopoverOpen(true); }}
                  onFocus={() => { if (skuQuery.trim()) setSkuPopoverOpen(true); }}
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
                  {results.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="w-full text-left p-2 hover:bg-accent"
                        onClick={() => pickSku(s)}
                      >
                        <div className="font-mono text-sm font-semibold truncate">{s.code}</div>
                        <div className="text-xs text-muted-foreground truncate">{s.name}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Batch */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Batch <span className="text-muted-foreground/70 normal-case">(optional)</span></div>
          <Input
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder="e.g. B3"
            className="h-11"
            autoComplete="off"
          />
        </div>

        {/* Blender */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Blender</div>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={blender ?? ""}
            onChange={(e) => setBlender(e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 3"
            className="h-11"
            autoComplete="off"
          />
        </div>

        {/* Quantity */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Quantity produced</div>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            className="h-12 text-lg font-semibold"
            autoComplete="off"
          />
        </div>

        <Button
          type="button"
          className="h-14 w-full text-base font-semibold"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Saving...</> : <><Plus className="h-5 w-5 mr-2" /> Save entry</>}
        </Button>
      </CardContent>
    </Card>
  );
}


