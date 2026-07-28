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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChatButton } from "@/components/LineChatButton";
import { PinDialog, type EngineerIdentity } from "@/components/PinDialog";
import { canUseLineChat } from "@/lib/permissions";
import { getCurrentFactoryShift, SHIFT_LABEL } from "@/lib/shifts";
import { Factory, Target, Loader2, Search, Plus, Lock, Trash2, Play, Square, Repeat, Pencil } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Navigate, useNavigate } from "react-router-dom";
import { useLineShiftTarget } from "@/hooks/useLineShiftTarget";
import { invokeFunction } from "@/lib/invokeFunction";

type Shift = "DAY" | "NIGHT";

/** Sentinel for "the catalog doesn't have it — I'll write the code myself". */
const MANUAL_SKU = "__manual__";


function manualActualQty(row: any): number {
  const notes = String(row.notes ?? "");
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  const wasEditedAfterSync = createdAt > 0 && updatedAt > createdAt + 1000;
  if (notes.startsWith("itouching:") && !wasEditedAfterSync) return 0;
  return Number(row.actual_qty ?? 0);
}

/** Catalog names carry customs codes ("… [HS CODE:2106909285]") that push the part
 *  the operator actually reads — the flavour or market — out of view. Strip them. */
function productLabel(name: string | null | undefined): string {
  return String(name ?? "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The export market a SKU is for, read from its name/code (Peru, KSA, UAE,
 *  Morocco, Australia). Same product, different label — this tells them apart. */
function marketOf(name?: string | null, code?: string | null): string {
  const hay = `${name ?? ""} ${code ?? ""}`.toUpperCase();
  if (/\bPERU\b|^PERU|PERUCRE/.test(hay)) return "Peru";
  if (/\bKSA\b|^KSA|KSACRE/.test(hay)) return "KSA";
  if (/\bUAE\b/.test(hay)) return "UAE";
  if (/MOROCCO|^MOR/.test(hay)) return "Morocco";
  if (/AUSTRALIA/.test(hay)) return "Australia";
  return "";
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
/** Format digits as HH:mm while typing, so the time is entered by hand on a
 *  tablet instead of opening the native clock dial. */
function maskHM(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}
/** Clamp a typed time to a valid HH:mm on blur ("" when unparseable). */
function normalizeHM(v: string): string {
  const m = /^(\d{1,2}):?(\d{1,2})$/.exec(v.trim());
  if (!m) return "";
  const h = Math.min(23, Number(m[1]));
  const mi = Math.min(59, Number(m[2]));
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
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
        /* Log Production covers the whole flow now — search or type a SKU, log
           each blender, and see "Logged this shift". The old per-item card and
           the separate "Add SKU" panel duplicated it and showed confusing
           fields (Completion 0%, Standard fill time —), so they're gone. */
        <LogProductionCard sessionId={sessionId} target={totalTarget} produced={items.reduce((s: number, i: any) => s + Number(i.actual_qty || 0), 0)} />
      )}
    </div>
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
      const { data, error } = await (supabase as any)
        .from("production_sessions")
        .select("leader_name")
        .eq("session_date", today)
        .eq("line", line)
        .eq("shift", shift)
        .maybeSingle();
      if (error) throw error;
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

/** A scheduled/running job as returned by intouch-list-scheduled-jobs. */
type IntouchJob = { code: string; description: string; qty: number; status: string; seq: number; batch: string; actual: number };

/** The shift target is hidden by default so operators aren't shown the number.
 *  Anyone with the shared company PIN can reveal it — it's not leader-only.
 *  Once revealed it stays visible for this screen's session. */
function TargetMeta({ target, produced }: { target: number; produced: number }) {
  const [revealed, setRevealed] = useState(false);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [checking, setChecking] = useState(false);

  if (target <= 0) return null;

  const remaining = Math.max(0, target - produced);
  const pct = Math.min(100, Math.round((produced / target) * 100));

  const verify = async () => {
    const p = pin.trim();
    if (!p) return;
    setChecking(true);
    try {
      const { data, error } = await (supabase.rpc as any)("verify_target_pin", { _pin: p });
      if (error) throw error;
      if (data === true) { setRevealed(true); setOpen(false); setPin(""); }
      else { toast.error("Incorrect PIN"); setPin(""); }
    } catch (e: any) {
      toast.error(e?.message || "Couldn't verify the PIN");
    } finally { setChecking(false); }
  };

  if (!revealed) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <Lock className="h-3 w-3" /> View target
        </button>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPin(""); }}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> View target</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Enter the PIN to see the target and shift progress.</p>
              <Input
                type="password" inputMode="numeric" autoFocus value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") verify(); }}
                placeholder="PIN" className="h-11 text-center tracking-[0.4em]" autoComplete="off"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); setPin(""); }}>Cancel</Button>
              <Button onClick={verify} disabled={checking || !pin.trim()}>
                {checking && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Reveal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="w-full max-w-[230px]">
      <div className="text-right text-[11px] text-muted-foreground">
        Produced <b className="tabular-nums text-foreground">{produced.toLocaleString()}</b> of{" "}
        <b className="tabular-nums text-foreground">{target.toLocaleString()}</b> —{" "}
        <b className="tabular-nums text-foreground">{remaining.toLocaleString()}</b> left
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LogProductionCard({ sessionId, target = 0, produced = 0 }: { sessionId: string; target?: number; produced?: number }) {
  const qc = useQueryClient();
  const { selectedLineName: jobLine } = useDeviceLineCtx();
  const { sessionDate: jobDate, shiftCode: jobShiftCode } = getCurrentFactoryShift();
  const jobShift: Shift = jobShiftCode === "day" ? "DAY" : "NIGHT";

  // Jobs scheduled in iTouching for this line + shift. Best-effort: if iTouching
  // is unreachable the panel simply doesn't render and logging stays manual.
  const jobsQ = useQuery({
    enabled: !!jobLine,
    queryKey: ["intouch-jobs", jobLine, jobDate, jobShift],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<IntouchJob[]> => {
      const { data, error } = await invokeFunction<{ sections: { line: string; items: IntouchJob[] }[] }>(
        "intouch-list-scheduled-jobs",
        { session_date: jobDate, shift: jobShift },
      );
      if (error) return [];
      const section = (data?.sections ?? []).find((s) => s.line === jobLine);
      return section?.items ?? [];
    },
  });
  const jobs = jobsQ.data ?? [];

  // What this line has been running lately. Looking past the current session
  // matters: at the start of a shift nothing is logged yet, which is exactly when
  // the operator would otherwise have to type the product out.
  const prefillQ = useQuery({
    enabled: !!jobLine,
    queryKey: ["log-prefill", jobLine, sessionId],
    queryFn: async () => {
      const { data: sessions, error: sessErr } = await (supabase as any)
        .from("production_sessions")
        .select("id")
        .eq("line", jobLine)
        .order("session_date", { ascending: false })
        .limit(6);
      if (sessErr) throw sessErr;
      const ids: string[] = (sessions ?? []).map((s: any) => s.id);
      if (sessionId && !ids.includes(sessionId)) ids.unshift(sessionId);
      if (ids.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from("production_blender_entries")
        .select("session_id, blender_label, blender_number, created_at, production_items!inner(blender_ref, batch_code, sku:sku_products(id, code, name))")
        .in("session_id", ids)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  /** Blender labels recently used on this line, most recent first. */
  const recentBlenders: string[] = useMemo(() => {
    const out: string[] = [];
    for (const e of prefillQ.data ?? []) {
      const l = String(e.blender_label ?? e.blender_number ?? "").trim();
      if (l && !out.includes(l)) out.push(l);
    }
    return out;
  }, [prefillQ.data]);

  const [skuQuery, setSkuQuery] = useState("");
  const [skuDebounced, setSkuDebounced] = useState("");
  const [selectedSku, setSelectedSku] = useState<{ id: string; code: string; name: string } | null>(null);
  // "" = searching the catalog (default), MANUAL_SKU = typing a code by hand.
  const [skuChoice, setSkuChoice] = useState<string>("");
  const [skuPopoverOpen, setSkuPopoverOpen] = useState(false);
  const [assembly, setAssembly] = useState(""); // stored in blender_ref
  const [batch, setBatch] = useState("");        // stored in batch_code — used by Quality to pull the SKU
  const [mfgMonth, setMfgMonth] = useState("");  // "YYYY-MM" from <input type="month">
  const [expMonth, setExpMonth] = useState("");  // "YYYY-MM"
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
      // Fetch wide, then collapse batch duplicates below — the same product
      // exists as CRE1KG, CRE1KG - B1 … B42, which would otherwise bury the
      // market variants (Peru, Morocco, KSA) the operator is looking for.
      const { data, error } = await (supabase as any)
        .from("sku_products")
        .select("id, code, name")
        .or(`code.ilike.%${q}%,name.ilike.%${q}%`)
        .order("code", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data || []) as { id: string; code: string; name: string }[];
    },
  });

  // One row per market variant. Each variant (… - PERU, … MOROCCO, … - KSA) has
  // its own name; the batch copies (CRE1KG - B12, PERUCRE500 - B8) share a name,
  // so grouping by name keeps the shortest code — the clean base SKU.
  const results: { id: string; code: string; name: string }[] = useMemo(() => {
    const byName = new Map<string, { id: string; code: string; name: string }>();
    for (const s of searchQ.data ?? []) {
      const key = productLabel(s.name).toLowerCase();
      const prev = byName.get(key);
      if (!prev || s.code.length < prev.code.length) byName.set(key, s);
    }
    return [...byName.values()].sort((a, b) => productLabel(a.name).localeCompare(productLabel(b.name)));
  }, [searchQ.data]);

  /** Fill the form from an iTouching job — the operator only confirms/adjusts. */
  const applyJob = async (j: IntouchJob) => {
    const { data: match } = await (supabase as any)
      .from("sku_products")
      .select("id, code, name")
      .ilike("code", j.code)
      .maybeSingle();
    if (j.batch) setBatch(j.batch);
    if (j.qty > 0) setQty(String(j.qty));

    if (match) {
      setSelectedSku(match);
      setSkuChoice("");
      setSkuQuery(`${productLabel(match.name)} — ${match.code}`);
      toast.success(`Filled from iTouching job ${j.code}`);
      return;
    }
    // Code isn't in the catalog. Search by the job's description so the operator
    // can pick the right product, or just type it in and log it as-is.
    setSelectedSku(null);
    setSkuChoice("");
    setSkuQuery(j.description?.trim() || j.code);
    setSkuPopoverOpen(true);
    toast.warning(`${j.code} isn't in the SKU catalog — pick the product below or type it in.`);
  };

  const pickSku = (s: { id: string; code: string; name: string }) => {
    setSelectedSku(s);
    setSkuQuery(`${productLabel(s.name)} — ${s.code}`);
    setSkuPopoverOpen(false);
  };

  const reset = () => {
    setSelectedSku(null);
    setSkuChoice("");
    setSkuQuery("");
    setSkuDebounced("");
    setAssembly("");
    setBatch("");
    setMfgMonth("");
    setExpMonth("");
    resetRunFields();
  };

  /** Clear only what changes from one blender to the next. The product, batch and
   *  assembly stay, because the same SKU normally runs on several blenders. */
  const resetRunFields = () => {
    setBlender("");
    setQty("");
    setStartTime("");
    setFinishTime("");
  };

  const onSave = async (opts?: { keepProduct?: boolean }) => {
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
            manufacture_month: mfgMonth ? `${mfgMonth}-01` : null,
            expiry_month: expMonth ? `${expMonth}-01` : null,
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
        if (mfgMonth) timePatch.manufacture_month = `${mfgMonth}-01`;
        if (expMonth) timePatch.expiry_month = `${expMonth}-01`;
        if (assembly.trim()) timePatch.blender_ref = assembly.trim();
        if (Object.keys(timePatch).length) {
          // .select() so a locked-session RLS no-op (0 rows, no error) surfaces
          // instead of silently dropping the times/batch under a success toast.
          const { data: patched, error: patchErr } = await (supabase as any)
            .from("production_items").update(timePatch).eq("id", itemId).select("id");
          if (patchErr) throw patchErr;
          if (!patched?.length) throw new Error("This shift is locked — production times can't be changed.");
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

      // Each blender keeps its OWN start/finish, so several blenders on the same
      // SKU don't overwrite each other's times.
      // Saving marks the end of the run, so stamp Finish when it was left blank.
      const finishHM = finishTime || nowHM();
      const entryTimes: Record<string, string | null> = {};
      if (startTime) entryTimes.started_at = hmToIso(startTime);
      entryTimes.finished_at = hmToIso(finishHM);

      if (existingEntry?.id) {
        const { error: upErr } = await (supabase as any)
          .from("production_blender_entries")
          .update({ quantity: Number(existingEntry.quantity || 0) + quantity, entered_by: uid, ...entryTimes })
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
            ...entryTimes,
          });
        if (insEntryErr) throw insEntryErr;
      }

      // 3) actual_qty is auto-synced by DB trigger from blender entries.
      toast.success(`Logged ${quantity} on Blender ${blenderLabel} for ${selectedSku?.code ?? skuText}`);
      if (opts?.keepProduct) resetRunFields();
      else reset();
      qc.invalidateQueries({ queryKey: ["my-prod-items", sessionId] });
      qc.invalidateQueries({ queryKey: ["blender-entries", sessionId] });
      qc.invalidateQueries({ queryKey: ["log-prefill"] });
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

        {/* Scheduled jobs from iTouching — tap one to fill SKU, batch and quantity. */}
        {jobs.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Job from iTouching · {jobLine}
            </div>
            <div className="space-y-1.5">
              {jobs.map((j, idx) => (
                <button
                  key={`${j.code}-${j.seq}-${idx}`}
                  type="button"
                  onClick={() => applyJob(j)}
                  className="w-full rounded-md border bg-background p-2.5 text-left transition-colors hover:bg-accent active:scale-[0.99]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{j.description || j.code}</span>
                    {j.status === "Running" && (
                      <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                        Running
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="font-mono">{j.code}</span>
                    {j.qty > 0 && <span>Order qty: <b className="text-foreground">{j.qty.toLocaleString()}</b></span>}
                    {j.batch && <span>Batch {j.batch}</span>}
                  </div>
                </button>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground">Tap a job to fill the form, then confirm the quantity.</div>
          </div>
        )}

        {/* SKU */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">SKU produced</div>

          {/* Plain search — type the product name or code and pick it. To repeat
              the same SKU on another blender, use "Save & next blender" below. */}
          {skuChoice !== MANUAL_SKU && (
            <Popover open={skuPopoverOpen && (results.length > 0 || searchQ.isFetching)} onOpenChange={setSkuPopoverOpen}>
              <PopoverTrigger asChild>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={skuQuery}
                    onChange={(e) => { setSkuQuery(e.target.value); setSelectedSku(null); setSkuPopoverOpen(true); }}
                    onFocus={() => { if (skuQuery.trim()) setSkuPopoverOpen(true); }}
                    placeholder="Search by product name or code..."
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
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold truncate">{productLabel(s.name)}</span>
                            {marketOf(s.name, s.code) && (
                              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                {marketOf(s.name, s.code)}
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-xs text-muted-foreground truncate">{s.code}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
          )}

          {/* Fallback: the product isn't in the catalog, so the operator writes
              the code and the shift still gets logged. */}
          {skuChoice === MANUAL_SKU && (
            <Input
              value={skuQuery}
              onChange={(e) => setSkuQuery(e.target.value)}
              placeholder="Type the SKU code, e.g. AF91CL"
              className="h-11"
              autoComplete="off"
            />
          )}

          <button
            type="button"
            className="text-[11px] text-muted-foreground underline underline-offset-2"
            onClick={() => {
              const goManual = skuChoice !== MANUAL_SKU;
              setSkuChoice(goManual ? MANUAL_SKU : "");
              setSelectedSku(null);
              setSkuQuery("");
              setSkuPopoverOpen(false);
            }}
          >
            {skuChoice === MANUAL_SKU ? "Search the catalog instead" : "Can't find it? Type the SKU by hand"}
          </button>

          {!selectedSku && skuQuery.trim() && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400">
              Not linked to the catalog — will be logged exactly as typed. Admin reconciles it later.
            </div>
          )}
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

        {/* Manufacture / expiry month for batch traceability (optional) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Manufactured (month)</div>
            <Input type="month" value={mfgMonth} onChange={(e) => setMfgMonth(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Expiry (month)</div>
            <Input type="month" value={expMonth} onChange={(e) => setExpMonth(e.target.value)} className="h-11" />
          </div>
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
          {recentBlenders.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {recentBlenders.slice(0, 6).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBlender(b)}
                  className="rounded-full border bg-background px-3 py-1 text-xs font-medium transition-colors hover:bg-accent active:scale-[0.98]"
                >
                  {b}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quantity */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Quantity produced</div>
            <TargetMeta target={target} produced={produced} />
          </div>
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
              <Input
                type="text" inputMode="numeric" placeholder="HH:mm" maxLength={5}
                value={startTime}
                onChange={(e) => setStartTime(maskHM(e.target.value))}
                onBlur={(e) => setStartTime(normalizeHM(e.target.value))}
                className="h-11 text-center tabular-nums" aria-label="Start time"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Button type="button" className="h-11 shrink-0 bg-red-600 hover:bg-red-700 text-white" onClick={() => setFinishTime(nowHM())}>
                <Square className="h-4 w-4 mr-1" /> Finish
              </Button>
              <Input
                type="text" inputMode="numeric" placeholder="HH:mm" maxLength={5}
                value={finishTime}
                onChange={(e) => setFinishTime(maskHM(e.target.value))}
                onBlur={(e) => setFinishTime(normalizeHM(e.target.value))}
                className="h-11 text-center tabular-nums" aria-label="Finish time"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            className="h-14 w-full text-base font-semibold"
            onClick={() => onSave()}
            disabled={saving}
          >
            {saving ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Saving...</> : <><Plus className="h-5 w-5 mr-2" /> Save entry</>}
          </Button>
          {/* The same SKU normally runs on several blenders, so saving and clearing
              the whole form made the operator re-enter the product every time. */}
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full text-base font-semibold"
            onClick={() => onSave({ keepProduct: true })}
            disabled={saving}
          >
            <Repeat className="h-5 w-5 mr-2" /> Save &amp; next blender
          </Button>
          <div className="text-center text-[11px] text-muted-foreground">
            Keeps the product, batch and assembly — you only enter the blender and quantity.
          </div>
        </div>

        <LoggedThisShift sessionId={sessionId} />
      </CardContent>
    </Card>
  );
}

function LoggedThisShift({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Fix a wrong blender / batch / quantity after saving.
  const [editing, setEditing] = useState<{ id: string; itemId: string; blender: string; batch: string; qty: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const onSaveEdit = async () => {
    if (!editing) return;
    const label = editing.blender.trim();
    const num = Number((label.match(/\d+/) ?? [""])[0]);
    const quantity = Number(editing.qty);
    if (!label || !Number.isFinite(num) || num < 1) { toast.error("Enter the blender (e.g. 3 or 7/8)"); return; }
    if (!Number.isFinite(quantity) || quantity <= 0) { toast.error("Enter a quantity greater than 0"); return; }
    setSavingEdit(true);
    try {
      const { error: e1 } = await (supabase as any)
        .from("production_blender_entries")
        .update({ blender_label: label, blender_number: num, quantity })
        .eq("id", editing.id);
      if (e1) throw e1;
      // Batch code lives on the parent production item.
      const { error: e2 } = await (supabase as any)
        .from("production_items")
        .update({ batch_code: editing.batch.trim() || null })
        .eq("id", editing.itemId);
      if (e2) throw e2;
      toast.success("Entry updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["blender-entries", sessionId] });
      qc.invalidateQueries({ queryKey: ["my-prod-items", sessionId] });
      qc.invalidateQueries({ queryKey: ["log-prefill"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to update entry");
    } finally {
      setSavingEdit(false);
    }
  };

  const entriesQ = useQuery({
    enabled: !!sessionId,
    queryKey: ["blender-entries", sessionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_blender_entries")
        .select("id, blender_number, blender_label, quantity, started_at, finished_at, created_at, production_item_id, production_items!inner(blender_ref, batch_code, sku_code_text, sku:sku_products(code, name))")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const entries = entriesQ.data || [];

  // Items logged WITHOUT a blender (e.g. a directly-typed entry) never appeared
  // in the blender-entries list, yet they still count toward the session total
  // shown in the Target popover — so the two totals disagreed. List them here
  // too, so "Logged this shift" reconciles with the popover and any stray/direct
  // entry is visible and removable.
  const directItemsQ = useQuery({
    enabled: !!sessionId,
    queryKey: ["direct-items", sessionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_items")
        .select("id, actual_qty, batch_code, blender_ref, created_at, sku_code_text, sku:sku_products(code, name), production_blender_entries(id)")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data || []) as any[]).filter(
        (it) => !(it.production_blender_entries?.length) && Number(it.actual_qty || 0) !== 0,
      );
    },
  });
  const directItems = directItemsQ.data || [];
  const total =
    entries.reduce((s, e) => s + Number(e.quantity || 0), 0) +
    directItems.reduce((s, it) => s + Number(it.actual_qty || 0), 0);

  const onDeleteItem = async (id: string) => {
    if (!window.confirm("Delete this entry?")) return;
    setDeletingId(id);
    try {
      const { error } = await (supabase as any).from("production_items").delete().eq("id", id);
      if (error) throw error;
      toast.success("Entry deleted");
      qc.invalidateQueries({ queryKey: ["direct-items", sessionId] });
      qc.invalidateQueries({ queryKey: ["my-prod-items", sessionId] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete entry");
    } finally {
      setDeletingId(null);
    }
  };

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
        <div className="text-xs text-muted-foreground">{entries.length + directItems.length} {entries.length + directItems.length === 1 ? "entry" : "entries"}</div>
      </div>

      {entriesQ.isLoading || directItemsQ.isLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : entries.length === 0 && directItems.length === 0 ? (
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
                      <span className="font-mono text-sm font-semibold truncate">{sku?.code ?? e.production_items?.sku_code_text ?? "—"}</span>
                      <span className="text-xs text-muted-foreground truncate">{productLabel(sku?.name)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="inline-flex items-center rounded bg-secondary text-secondary-foreground px-1.5 py-0.5 text-[10px] font-medium">
                        Blender {e.blender_label ?? e.blender_number}
                      </span>
                      {assembly && (
                        <span className="text-[10px] text-muted-foreground">Assembly {assembly}</span>
                      )}
                      {(e.started_at || e.finished_at) && (
                        <span className="text-[10px] text-muted-foreground">
                          {e.started_at ? format(new Date(e.started_at), "HH:mm") : "—"}
                          {" → "}
                          {e.finished_at ? format(new Date(e.finished_at), "HH:mm") : "—"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-base font-semibold tabular-nums">{Number(e.quantity).toLocaleString()}</div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-11 w-11 touch-manipulation text-muted-foreground hover:text-foreground"
                    onClick={() => setEditing({
                      id: e.id,
                      itemId: e.production_item_id,
                      blender: String(e.blender_label ?? e.blender_number ?? ""),
                      batch: e.production_items?.batch_code ?? "",
                      qty: String(e.quantity ?? ""),
                    })}
                    aria-label="Edit entry"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-11 w-11 touch-manipulation text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(e.id)}
                    disabled={deletingId === e.id}
                    aria-label="Delete entry"
                  >
                    {deletingId === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </li>
              );
            })}
            {directItems.map((it) => (
              <li key={it.id} className="flex items-center gap-3 p-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-sm font-semibold truncate">{it.sku?.code ?? it.sku_code_text ?? "—"}</span>
                    <span className="text-xs text-muted-foreground truncate">{productLabel(it.sku?.name)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="inline-flex items-center rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-medium">No blender</span>
                    {it.blender_ref && <span className="text-[10px] text-muted-foreground">Assembly {it.blender_ref}</span>}
                    {it.batch_code && <span className="text-[10px] text-muted-foreground truncate">{it.batch_code}</span>}
                  </div>
                </div>
                <div className="text-base font-semibold tabular-nums">{Number(it.actual_qty).toLocaleString()}</div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 touch-manipulation text-muted-foreground hover:text-destructive"
                  onClick={() => onDeleteItem(it.id)}
                  disabled={deletingId === it.id}
                  aria-label="Delete entry"
                >
                  {deletingId === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Total produced this shift</span>
            <span className="text-lg font-bold tabular-nums">{total.toLocaleString()}</span>
          </div>
        </>
      )}

      {/* Fix a saved entry — wrong blender, batch or quantity. */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Edit entry</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Blender</div>
                <Input value={editing.blender} onChange={(ev) => setEditing({ ...editing, blender: ev.target.value })}
                  placeholder="e.g. 3 or 7/8" className="h-11" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Batch code</div>
                <Input value={editing.batch} onChange={(ev) => setEditing({ ...editing, batch: ev.target.value })}
                  placeholder="e.g. B-2026-0725" className="h-11" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Quantity produced</div>
                <Input type="number" inputMode="numeric" min={0} value={editing.qty}
                  onChange={(ev) => setEditing({ ...editing, qty: ev.target.value })}
                  placeholder="0" className="h-11 text-lg font-semibold" autoComplete="off" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={onSaveEdit} disabled={savingEdit}>
              {savingEdit && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}





