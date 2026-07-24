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
import { Factory, Target, Loader2, Search, Plus, Lock, Trash2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Navigate, useNavigate } from "react-router-dom";
import { useLineShiftTarget } from "@/hooks/useLineShiftTarget";

type Shift = "DAY" | "NIGHT";


function manualActualQty(row: any): number {
  const notes = String(row.notes ?? "");
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  const wasEditedAfterSync = createdAt > 0 && updatedAt > createdAt + 1000;
  if (notes.startsWith("itouching:") && !wasEditedAfterSync) return 0;
  return Number(row.actual_qty ?? 0);
}

/** Current local time as "HH:mm". */
function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** Build an ISO timestamp for today at the given "HH:mm" (local), or null. */
function hmToIso(hm: string): string | null {
  if (!hm) return null;
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
/** Minutes between two "HH:mm" (handles crossing midnight), or null. */
function hmDurationMin(start: string, finish: string): number | null {
  if (!start || !finish) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [fh, fm] = finish.split(":").map(Number);
  let mins = (fh * 60 + fm) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins;
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
                placeholder="Search by product name..."
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
                        <div className="text-sm font-semibold truncate">{sku.name}</div>
                        <div className="font-mono text-xs text-muted-foreground truncate">{sku.code}</div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={already ? "outline" : "default"}
                        disabled={addingId === sku.id}
                        onClick={() => addSku(sku)}
                      >
                        {addingId === sku.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <><Plus className="h-4 w-4 mr-1" />{already ? "Add again" : "Add"}</>
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
            // Point the leader at the line they ARE running today, so a wrong-tablet
            // login says where to go instead of dead-ending.
            const { data: mine } = await (supabase as any)
              .from("production_sessions")
              .select("line")
              .eq("session_date", today)
              .eq("shift", shift)
              .ilike("leader_name", eng.name);
            const myLines = ((mine ?? []) as { line: string }[]).map((r) => r.line).filter(Boolean);
            toast.error(
              myLines.length
                ? `${eng.name} is the leader for ${myLines.join(", ")} today, not ${line}. Sign in on that line's tablet.`
                : `${eng.name} is not the leader for ${line} today (${assignedLeader} is).`,
            );
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
  const [assembly, setAssembly] = useState(""); // stored in blender_ref
  const [batch, setBatch] = useState("");        // stored in batch_code — used by Quality to pull the SKU
  const [blender, setBlender] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [startTime, setStartTime] = useState("");   // "HH:mm"
  const [finishTime, setFinishTime] = useState("");
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
    setSkuQuery(`${s.name} — ${s.code}`);
    setSkuPopoverOpen(false);
  };

  const reset = () => {
    setSelectedSku(null);
    setSkuQuery("");
    setSkuDebounced("");
    setAssembly("");
    setBatch("");
    setBlender("");
    setQty("");
    setStartTime("");
    setFinishTime("");
  };

  const onSave = async () => {
    const quantity = Number(qty);
    // Blenders can be combined ("7/8"). Keep the typed label as the identity and
    // take the first number for the numeric column used in reporting.
    const blenderLabel = blender.trim();
    const blenderNum = Number((blenderLabel.match(/\d+/) ?? [""])[0]);
    // Free-text SKU: if nothing was picked from the catalog, log the typed code
    // as-is (no new SKU is created). Admin reconciles the real SKU later.
    const rawCode = skuQuery.trim().replace(/\s+—\s+.*$/, "").trim();
    if (!selectedSku && !rawCode) { toast.error("Enter or select a SKU"); return; }
    if (!batch.trim()) { toast.error("Enter the batch code"); return; }
    if (!blenderLabel || !Number.isFinite(blenderNum) || blenderNum < 1) { toast.error("Enter the blender (e.g. 3 or 7/8)"); return; }
    if (!Number.isFinite(quantity) || quantity <= 0) { toast.error("Enter a quantity greater than 0"); return; }

    const skuId: string | null = selectedSku?.id ?? null;
    const skuText: string | null = selectedSku ? null : rawCode;

    setSaving(true);
    try {
      // 1) Find or create the production_items row for this session + SKU + batch.
      // Multiple batches of the same SKU in one shift are separate items,
      // distinguished by the batch code (the assembly number is optional).
      let findQ = (supabase as any)
        .from("production_items")
        .select("id")
        .eq("session_id", sessionId);
      findQ = skuId ? findQ.eq("sku_id", skuId) : findQ.is("sku_id", null).eq("sku_code_text", skuText);
      findQ = findQ.eq("batch_code", batch.trim());
      const { data: existingItem, error: findErr } = await findQ.maybeSingle();
      if (findErr) throw findErr;

      let itemId: string | null = existingItem?.id ?? null;
      if (!itemId) {
        const { data: created, error: insErr } = await (supabase as any)
          .from("production_items")
          .insert({
            session_id: sessionId,
            sku_id: skuId,
            sku_code_text: skuText,
            target_qty: 0,
            planned_qty: 0,
            actual_qty: 0,
            notes: "manual_sku",
            blender_ref: assembly.trim() || null,
            batch_code: batch.trim(),
            started_at: hmToIso(startTime),
            finished_at: hmToIso(finishTime),
          })
          .select("id")
          .maybeSingle();
        if (insErr) throw insErr;
        itemId = created?.id ?? null;
      } else {
        // Existing batch item — record/refresh the production times and batch code
        const timePatch: any = {};
        if (startTime) timePatch.started_at = hmToIso(startTime);
        if (finishTime) timePatch.finished_at = hmToIso(finishTime);
        if (batch.trim()) timePatch.batch_code = batch.trim();
        if (assembly.trim()) timePatch.blender_ref = assembly.trim();
        if (Object.keys(timePatch).length) {
          await (supabase as any).from("production_items").update(timePatch).eq("id", itemId);
        }
      }
      if (!itemId) throw new Error("Could not resolve production item");

      // 2) Insert blender entry (upsert on unique (item, blender) to accumulate)
      const { data: existingEntry } = await (supabase as any)
        .from("production_blender_entries")
        .select("id, quantity")
        .eq("production_item_id", itemId)
        .eq("blender_label", blenderLabel)
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
            blender_label: blenderLabel,
            quantity,
            entered_by: uid,
          });
        if (insEntryErr) throw insEntryErr;
      }

      // 3) actual_qty is auto-synced by DB trigger from blender entries.
      toast.success(`Logged ${quantity} on Blender ${blenderLabel} for ${selectedSku?.code ?? skuText}`);
      reset();
      qc.invalidateQueries({ queryKey: ["my-prod-items", sessionId] });
      qc.invalidateQueries({ queryKey: ["blender-entries", sessionId] });
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
            <div className="text-xs text-muted-foreground">Record produced quantity to the current shift.</div>
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
                  placeholder="Search by product name..."
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
                skuQuery.trim() ? (
                  <button
                    type="button"
                    className="w-full text-left p-3 hover:bg-accent"
                    onClick={() => { setSelectedSku(null); setSkuPopoverOpen(false); }}
                  >
                    <div className="text-sm font-medium">Use “<span className="font-mono">{skuQuery.trim()}</span>” as typed</div>
                    <div className="text-xs text-muted-foreground">Not in the catalog — it won't create a new SKU. Admin reconciles it later.</div>
                  </button>
                ) : (
                  <div className="p-3 text-sm text-muted-foreground">No SKUs found</div>
                )
              ) : (
                <ul className="divide-y">
                  {results.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="w-full text-left p-2 hover:bg-accent"
                        onClick={() => pickSku(s)}
                      >
                        <div className="text-sm font-semibold truncate">{s.name}</div>
                        <div className="font-mono text-xs text-muted-foreground truncate">{s.code}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Assembly number (optional) */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Assembly number <span className="normal-case text-muted-foreground/60">(optional)</span></div>
          <Input
            value={assembly}
            onChange={(e) => setAssembly(e.target.value)}
            placeholder="e.g. ASM-12345"
            className="h-11"
            autoComplete="off"
          />
        </div>

        {/* Batch code (required) — Quality pulls the SKU from this */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Batch code</div>
          <Input
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder="e.g. B-2026-0723"
            className="h-11"
            autoComplete="off"
          />
        </div>

        {/* Blender */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Blender</div>
          <Input
            type="text"
            inputMode="text"
            value={blender}
            onChange={(e) => setBlender(e.target.value)}
            placeholder="e.g. 3 or 7/8"
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

        {/* Production time (optional) — Start/Finish stamp + editable */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Production time <span className="normal-case text-muted-foreground/60">(optional)</span></div>
            {hmDurationMin(startTime, finishTime) != null && (
              <div className="text-xs font-medium text-muted-foreground">
                Duration: {Math.floor(hmDurationMin(startTime, finishTime)! / 60)}h {hmDurationMin(startTime, finishTime)! % 60}m
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <Button type="button" className="h-11 shrink-0 bg-green-600 hover:bg-green-700 text-white" onClick={() => setStartTime(nowHM())}>
                <Play className="h-4 w-4 mr-1" /> Start
              </Button>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-11" aria-label="Start time" />
            </div>
            <div className="flex items-center gap-1.5">
              <Button type="button" className="h-11 shrink-0 bg-red-600 hover:bg-red-700 text-white" onClick={() => setFinishTime(nowHM())}>
                <Square className="h-4 w-4 mr-1" /> Finish
              </Button>
              <Input type="time" value={finishTime} onChange={(e) => setFinishTime(e.target.value)} className="h-11" aria-label="Finish time" />
            </div>
          </div>
        </div>

        <Button
          type="button"
          className="h-14 w-full text-base font-semibold"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Saving...</> : <><Plus className="h-5 w-5 mr-2" /> Save entry</>}
        </Button>

        <LoggedThisShift sessionId={sessionId} />
      </CardContent>
    </Card>
  );
}

function LoggedThisShift({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const entriesQ = useQuery({
    enabled: !!sessionId,
    queryKey: ["blender-entries", sessionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_blender_entries")
        .select("id, blender_number, blender_label, quantity, created_at, production_item_id, production_items!inner(blender_ref, sku:sku_products(code, name))")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const entries = entriesQ.data || [];
  const total = entries.reduce((s, e) => s + Number(e.quantity || 0), 0);

  const onDelete = async (id: string) => {
    if (!window.confirm("Delete this entry?")) return;
    setDeletingId(id);
    try {
      const { error } = await (supabase as any)
        .from("production_blender_entries")
        .delete()
        .eq("id", id);
      if (error) throw error;
      toast.success("Entry deleted");
      qc.invalidateQueries({ queryKey: ["blender-entries", sessionId] });
      qc.invalidateQueries({ queryKey: ["my-prod-items", sessionId] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete entry");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="pt-4 border-t space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Logged this shift</div>
        <div className="text-xs text-muted-foreground">{entries.length} {entries.length === 1 ? "entry" : "entries"}</div>
      </div>

      {entriesQ.isLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : entries.length === 0 ? (
        <div className="text-sm text-muted-foreground py-2">No entries logged yet this shift.</div>
      ) : (
        <>
          <ul className="divide-y rounded-md border">
            {entries.map((e) => {
              const sku = e.production_items?.sku;
              const assembly = e.production_items?.blender_ref;
              return (
                <li key={e.id} className="flex items-center gap-3 p-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm font-semibold truncate">{sku?.code ?? "—"}</span>
                      <span className="text-xs text-muted-foreground truncate">{sku?.name ?? ""}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="inline-flex items-center rounded bg-secondary text-secondary-foreground px-1.5 py-0.5 text-[10px] font-medium">
                        Blender {e.blender_label ?? e.blender_number}
                      </span>
                      {assembly && (
                        <span className="text-[10px] text-muted-foreground">Assembly {assembly}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-base font-semibold tabular-nums">{Number(e.quantity).toLocaleString()}</div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(e.id)}
                    disabled={deletingId === e.id}
                    aria-label="Delete entry"
                  >
                    {deletingId === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Total produced this shift</span>
            <span className="text-lg font-bold tabular-nums">{total.toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  );
}





