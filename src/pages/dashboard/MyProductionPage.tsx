import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { OperatorLineGuard } from "@/components/OperatorLineGuard";
import { useDeviceLineCtx } from "@/contexts/DeviceLineContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChatButton } from "@/components/LineChatButton";
import { ShiftScrapCard } from "@/components/production/ShiftScrapCard";
import { PinDialog, type EngineerIdentity } from "@/components/PinDialog";
import { canUseLineChat } from "@/lib/permissions";
import { getCurrentFactoryShift, shiftLoggingDeadline, SHIFT_LABEL } from "@/lib/shifts";
import { shiftTimeToIso, runMinutes } from "@/lib/productionTime";
import { Factory, Target, Loader2, Search, Plus, Lock, Trash2, Play, Square, Repeat, Pencil } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Navigate, useNavigate } from "react-router-dom";
import { useLineShiftTarget } from "@/hooks/useLineShiftTarget";
import { useConfirm } from "@/hooks/useConfirm";

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
/**
 * A typed time onto the day the SHIFT says it belongs to.
 *
 * This used to build `new Date()` and set the hours on it — the day the form happened
 * to be submitted. On a night shift the operator crosses midnight and the record does
 * not: logging at 01:00 that a run started at 17:20 produced 07/08 17:20, eighteen
 * hours after the finish typed before midnight. Twenty-three records hold a negative
 * duration because of it.
 */
function hmToIso(hm: string, sessionDate: string, shift: string): string | null {
  return shiftTimeToIso(hm, sessionDate, shift);
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

  /**
   * A spinner that cannot end is worse than an error.
   *
   * The line usually resolves in a moment. If it has not after eight seconds
   * something is wrong that waiting will not fix, and an operator holding a tablet
   * needs a way out rather than an animation.
   */
  const [lineTimedOut, setLineTimedOut] = useState(false);
  useEffect(() => {
    if (line) { setLineTimedOut(false); return; }
    const t = setTimeout(() => setLineTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [line]);

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
        .select("id, session_date, line, shift, locked")
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

  /**
   * SKUs planned for this shift: rows the iTouching sync wrote with a target,
   * as opposed to `manual_sku` rows an operator typed in. These are "what this
   * line is supposed to run", which is what the operator should be picking from.
   */
  const plannedSkus = useMemo(
    () =>
      ((itemsQ.data ?? []) as Array<{
        sku_id: string | null; code: string; name: string;
        target_qty: number; actual_qty: number; is_manual: boolean;
      }>)
        .filter((i) => !i.is_manual && i.sku_id && Number(i.target_qty || 0) > 0)
        .map((i) => ({
          id: i.sku_id as string,
          code: i.code as string,
          name: i.name as string,
          planned: Number(i.target_qty || 0),
          done: Number(i.actual_qty || 0),
        })),
    [itemsQ.data],
  );

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
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Same opening as every other landing screen. This is the operator's landing
          after login, so it gets the greeting and the banner too. */}

      {/* Header */}
      <Card>
        <CardContent className="p-4 md:p-6 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Factory className="h-6 w-6" />
            </div>
            <div>
              {/* Same as the performance screen: the title of the page, in a heading. */}
              <h1 className="text-xl font-bold">My Production</h1>
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
      {/* `line` comes from DeviceLineContext and is "" for the first render or
          two after login. sessionQ is disabled while it's empty, and in
          react-query v5 a DISABLED query reports isLoading === false — so this
          gate used to fall straight through to "No active shift session" until
          the operator refreshed. Treat "line not resolved yet" as loading. */}
      {!line && lineTimedOut ? (
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <div className="text-base font-semibold">Still finding your line.</div>
            <p className="text-sm text-muted-foreground">
              Your login is bound to a line, but the list has not come back. This is
              usually a moment of no signal.
            </p>
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </CardContent>
        </Card>
      ) : !line || sessionQ.isLoading ? (
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
        <>
          <LogProductionCard
            sessionId={sessionId}
            target={totalTarget}
            produced={items.reduce((s: number, i: any) => s + Number(i.actual_qty || 0), 0)}
            plannedSkus={plannedSkus}
          />
          {/* Under the log, not inside it: scrap is counted after the run, often at
              the end of the shift, and it should not sit in the middle of the flow
              somebody uses twenty times an hour. */}
          <ShiftScrapCard sessionId={sessionId} locked={!!sessionQ.data?.locked} />
        </>
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
                  const cls = pct >= 90 ? "text-success-strong" : pct >= 70 ? "text-warning-strong" : "text-destructive-strong";
                  return <span className={`text-lg font-semibold tabular-nums ${cls}`}>{pct.toFixed(1)}%</span>;
                })()
              ) : (
                <span className="text-lg font-semibold tabular-nums text-muted-foreground">—</span>
              )}
            </div>
          </div>
          {leader && <div className="text-2xs text-muted-foreground mt-2">Unlocked by {leader.name}</div>}
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
          className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
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
      <div className="text-right text-2xs text-muted-foreground">
        Produced <b className="tabular-nums text-foreground">{produced.toLocaleString()}</b> of{" "}
        <b className="tabular-nums text-foreground">{target.toLocaleString()}</b> —{" "}
        <b className="tabular-nums text-foreground">{remaining.toLocaleString()}</b> left
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Parse "B26188 07/2026 07/2028" into batch + first-of-month dates.
 *  First MM/YYYY token = manufactured, second = expiry. Extra text stays in the batch. */
function parseBatchInput(raw: string): { batch: string; mfg: string; exp: string } {
  const text = (raw ?? "").trim();
  if (!text) return { batch: "", mfg: "", exp: "" };
  const re = /(\d{1,2})\s*\/\s*(\d{4})/g;
  const months: string[] = [];
  const stripped = text.replace(re, (_m, mm, yyyy) => {
    const m = Math.min(12, Math.max(1, parseInt(mm, 10)));
    months.push(`${yyyy}-${String(m).padStart(2, "0")}`);
    return " ";
  });
  return {
    batch: stripped.replace(/\s+/g, " ").trim(),
    mfg: months[0] ?? "",
    exp: months[1] ?? "",
  };
}

type PlannedSku = { id: string; code: string; name: string; planned: number; done: number };

function LogProductionCard({ sessionId, target = 0, produced = 0, plannedSkus = [] }: { sessionId: string; target?: number; produced?: number; plannedSkus?: PlannedSku[] }) {
  // The shift being logged decides which day a typed time lands on, not the clock on
  // the wall behind whoever is typing.
  const { sessionDate: logDate, shiftCode: logShiftCode } = getCurrentFactoryShift();
  const logShift = logShiftCode === "night" ? "NIGHT" : "DAY";
  const qc = useQueryClient();
  const { selectedLineName: jobLine } = useDeviceLineCtx();
  // iTouching is no longer read on this screen at all. It was the source of the
  // SKU suggestions, but its part codes carry batch suffixes — "OCMC6 - B1" where
  // our catalogue holds "OCMC6" — so every pick logged a code the system doesn't
  // have, and the two records diverged. Part codes come from sku_products only.

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
  const skuInputWrapRef = useRef<HTMLDivElement>(null);
  const [batch, setBatch] = useState("");        // stored in batch_code — used by Quality to pull the SKU
  const [mfgMonth, setMfgMonth] = useState("");  // "YYYY-MM" — parsed from the batch field
  const [expMonth, setExpMonth] = useState("");  // "YYYY-MM" — parsed from the batch field
  const [destination, setDestination] = useState("");
  const [notForEu, setNotForEu] = useState(false);
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
    // Gated on the typed text ONLY. This used to also require skuPopoverOpen,
    // which deadlocked: the popover's `open` was derived from `results.length`,
    // so with no results it stayed shut, and every dismiss handler pushed
    // skuPopoverOpen back to false — which disabled the query, so results could
    // never arrive. Typing produced silence. The popover now controls nothing
    // but its own visibility.
    enabled: skuChoice !== MANUAL_SKU && skuDebounced.length >= 1,
    queryKey: ["log-prod-sku-search", skuDebounced],
    staleTime: 30_000,
    queryFn: async () => {
      const q = skuDebounced;
      // PostgREST's or() parser splits on commas/parentheses, so a SKU name like
      // "… 60 CAPS, 30 SERVS" would break the filter ("failed to parse logic
      // tree"). Double-quote each value (escaping embedded quotes/backslashes) so
      // the whole pattern is treated as one term.
      const safe = q.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      // Fetch wide, then collapse batch duplicates below — the same product
      // exists as CRE1KG, CRE1KG - B1 … B42, which would otherwise bury the
      // market variants (Peru, Morocco, KSA) the operator is looking for.
      const { data, error } = await (supabase as any)
        .from("sku_products")
        .select("id, code, name")
        .or(`code.ilike."%${safe}%",name.ilike."%${safe}%"`)
        .order("code", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data || []) as { id: string; code: string; name: string }[];
    },
  });

  /** Case-insensitive match of the typed text against a code and a name. */
  const matchesQuery = (code: string | null | undefined, name: string | null | undefined) => {
    const q = skuDebounced.trim().toLowerCase();
    if (!q) return true;
    return `${code ?? ""} ${name ?? ""}`.toLowerCase().includes(q);
  };

  /**
   * Every suggestion list is keyed on the SKU code, and a code can be missing:
   * an item logged as free text has no sku_products row, and iTouching hands
   * back jobs with a blank code. `code.toUpperCase()` on those crashed the whole
   * screen for the operator — a white page mid-shift, over thirty times tonight.
   */
  const codeKey = (code: string | null | undefined) => String(code ?? "").toUpperCase();

  // Build marker. The published bundle stayed on MyProductionPage-B3siNI0h.js —
  // the crashing chunk — across four API deploys and a manual publish, while the
  // preview was already built from the fix. Changing this file's contents forces
  // a different chunk hash, so a stale cached build cannot masquerade as current.
  const CRASH_FIX_BUILD = "codeKey-guard-v2";
  void CRASH_FIX_BUILD;

  /** Extract the SKU from a prefill row; the join can hand back object or array. */
  const skuOfPrefillRow = (e: {
    production_items?: unknown;
  }): { id: string; code: string; name: string } | null => {
    const pi = e.production_items as { sku?: unknown } | { sku?: unknown }[] | undefined;
    const item = Array.isArray(pi) ? pi[0] : pi;
    const sku = item?.sku as { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | undefined;
    const sk = Array.isArray(sku) ? sku[0] : sku;
    // Normalise here so no downstream consumer has to defend against a missing
    // code or name (and so neither ever renders as the string "undefined").
    return sk?.id ? { id: sk.id, code: String(sk.code ?? ""), name: String(sk.name ?? "") } : null;
  };

  /**
   * SKUs already logged on THIS shift's session, newest first. These used to be
   * lumped under "Previous jobs" because the prefill query spans the last six
   * sessions including the current one — but what the operator logged twenty
   * minutes ago is the job they are on, not history, and it's usually the very
   * next thing they need to pick.
   */
  const currentShiftSkus = useMemo(() => {
    const seen = new Map<string, { id: string; code: string; name: string }>();
    for (const e of prefillQ.data ?? []) {
      if (e.session_id !== sessionId) continue;
      const sk = skuOfPrefillRow(e);
      if (!sk || seen.has(sk.id)) continue;
      if (!matchesQuery(sk.code, sk.name)) continue;
      seen.set(sk.id, sk);
    }
    return [...seen.values()].slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillQ.data, sessionId, skuDebounced]);

  /**
   * Planned for this shift, from OUR catalogue only.
   *
   * iTouching is deliberately not a source of part codes. Its codes carry batch
   * suffixes — it reports "OCMC6 - B1" where our SKU is "OCMC6" — so offering
   * them had the operator logging a code that doesn't exist in the system, and
   * the two drifted apart. Every code shown here comes from sku_products.
   */
  const plannedSuggestions = useMemo(() => {
    const seen = new Set<string>(currentShiftSkus.map((c) => codeKey(c.code)));
    const out: { id: string; code: string; name: string }[] = [];
    for (const p of plannedSkus) {
      const k = codeKey(p.code);
      if (seen.has(k)) continue;
      if (!matchesQuery(p.code, p.name)) continue;
      seen.add(k);
      out.push({ id: p.id, code: p.code, name: p.name });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannedSkus, currentShiftSkus, skuDebounced]);

  /**
   * A few of the line's previous jobs, as a last resort. Kept short on purpose:
   * history is the weakest signal here, so it must not crowd out what is
   * actually running or planned. Anything already shown above is filtered out.
   */
  const recentSuggestions = useMemo(() => {
    const shown = new Set<string>([
      ...plannedSuggestions.map((p) => codeKey(p.code)),
      ...currentShiftSkus.map((s) => codeKey(s.code)),
    ]);
    const seen = new Map<string, { id: string; code: string; name: string }>();
    for (const e of prefillQ.data ?? []) {
      if (e.session_id === sessionId) continue; // that's this shift, shown above
      const sk = skuOfPrefillRow(e);
      if (!sk) continue;
      if (shown.has(codeKey(sk.code)) || seen.has(sk.id)) continue;
      if (!matchesQuery(sk.code, sk.name)) continue;
      seen.set(sk.id, sk);
    }
    return [...seen.values()].slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillQ.data, sessionId, plannedSuggestions, currentShiftSkus, skuDebounced]);

  const hasSuggestions =
    currentShiftSkus.length + plannedSuggestions.length + recentSuggestions.length > 0;

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

  /**
   * Code first, description after. Two reasons: the operator matches the part
   * code printed on the box, and the free-text fallback on submit takes whatever
   * precedes the em dash as the code — with the description leading, that logged
   * the product NAME as the SKU.
   */
  const pickSku = (s: { id: string; code: string; name: string }) => {
    setSelectedSku(s);
    setSkuQuery(`${s.code} — ${productLabel(s.name)}`);
    setSkuPopoverOpen(false);
  };

  /**
   * Type a part code, get the rest of the record. When what's typed is an exact
   * catalogue code, link it automatically instead of making the operator open the
   * list and tap the row he just spelled out.
   */
  useEffect(() => {
    if (selectedSku || skuChoice === MANUAL_SKU) return;
    const typed = skuDebounced.trim().toUpperCase();
    if (typed.length < 3) return;
    const exact = (searchQ.data ?? []).find((s) => String(s.code ?? "").toUpperCase() === typed);
    if (exact) pickSku(exact);
  }, [skuDebounced, searchQ.data, selectedSku, skuChoice]);

  const reset = () => {
    setSelectedSku(null);
    setSkuChoice("");
    setSkuQuery("");
    setSkuDebounced("");
    setBatch("");
    setMfgMonth("");
    setExpMonth("");
    setDestination("");
    setNotForEu(false);
    resetRunFields();
  };

  /** Clear only what changes from one blender to the next. The product and batch
   *  stay, because the same SKU normally runs on several blenders. */
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
    // Re-parse the batch field in case the operator didn't blur it before saving —
    // "B26188 07/2026 07/2028" must still resolve to batch + dates.
    const parsed = parseBatchInput(batch);
    const batchClean = parsed.batch;
    const mfgClean = parsed.mfg || mfgMonth;
    const expClean = parsed.exp || expMonth;
    if (batchClean !== batch) setBatch(batchClean);
    if (parsed.mfg && parsed.mfg !== mfgMonth) setMfgMonth(parsed.mfg);
    if (parsed.exp && parsed.exp !== expMonth) setExpMonth(parsed.exp);
    const destClean = destination.trim();
    if (!selectedSku && !rawCode) { toast.error("Enter or select a SKU"); return; }
    if (!batchClean) { toast.error("Enter the batch code"); return; }
    if (!blenderLabel || !Number.isFinite(blenderNum) || blenderNum < 1) { toast.error("Enter the blender (e.g. 3 or 7/8)"); return; }
    if (!Number.isFinite(quantity) || quantity <= 0) { toast.error("Enter a quantity greater than 0"); return; }

    const skuId: string | null = selectedSku?.id ?? null;
    const skuText: string | null = selectedSku ? null : rawCode;

    setSaving(true);
    try {
      // 1) Find or create the production_items row for this session + SKU + batch.
      // Multiple batches of the same SKU in one shift are separate items,
      // distinguished by the batch code.
      let findQ = (supabase as any)
        .from("production_items")
        .select("id")
        .eq("session_id", sessionId);
      findQ = skuId ? findQ.eq("sku_id", skuId) : findQ.is("sku_id", null).eq("sku_code_text", skuText);
      findQ = findQ.eq("batch_code", batchClean);
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
            batch_code: batchClean,
            manufacture_month: mfgClean ? `${mfgClean}-01` : null,
            expiry_month: expClean ? `${expClean}-01` : null,
            destination: destClean || null,
            not_for_eu: notForEu,
            started_at: hmToIso(startTime, logDate, logShift),
            finished_at: hmToIso(finishTime, logDate, logShift),
          })
          .select("id")
          .maybeSingle();
        // RLS refuses this insert when the shift has been locked, and the raw
        // message ("new row violates row-level security policy for table
        // production_items") tells an operator nothing about what to do. On 30/07
        // the Line 4 night operator hit it seven times between 05:18 and 05:23 and
        // gave up; the shift's output was never recorded.
        if (insErr) {
          const isRls = (insErr as { code?: string }).code === "42501"
            || /row-level security/i.test((insErr as { message?: string }).message ?? "");
          if (isRls) {
            // Says what actually happened and who can help. The earlier wording sent
            // the operator to a supervisor to "reopen the shift", which stopped being
            // true the moment the deadline started overriding the lock — unlocking a
            // closed shift changes nothing now, so that advice only wasted a call.
            const closedAt = getCurrentFactoryShift().shiftCode === "night" ? "06:15" : "18:15";
            throw new Error(
              `Logging for this shift closed at ${closedAt}. Ask a manager to record it — they can still enter it for you.`,
            );
          }
          throw insErr;
        }
        itemId = created?.id ?? null;
      } else {
        // Existing batch item — record/refresh the production times and batch code
        const timePatch: any = {};
        if (startTime) timePatch.started_at = hmToIso(startTime, logDate, logShift);
        if (finishTime) timePatch.finished_at = hmToIso(finishTime, logDate, logShift);
        if (batchClean) timePatch.batch_code = batchClean;
        if (mfgClean) timePatch.manufacture_month = `${mfgClean}-01`;
        if (expClean) timePatch.expiry_month = `${expClean}-01`;
        timePatch.destination = destClean || null;
        timePatch.not_for_eu = notForEu;
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
      //
      // But never a Finish that is not after the Start. An operator who types the
      // current time into Start and saves straight away got both fields on the same
      // minute, and a run of zero minutes is not a short run — it is a record that
      // cannot be read. Nine of them are on file: five on 27/07 alone, at 09:59, 10:01,
      // 10:02, 11:09 and 16:40, each with its two times identical to the minute.
      //
      // An unfinished run is honest. A zero-length one is not, and it is the kind of
      // wrong that looks finished.
      const entryTimes: Record<string, string | null> = {};
      const startIso = startTime ? hmToIso(startTime, logDate, logShift) : null;
      if (startTime) entryTimes.started_at = startIso;

      const finishIso = hmToIso(finishTime || nowHM(), logDate, logShift);
      const stampedNotTyped = !finishTime;
      if (finishIso && !(stampedNotTyped && startIso && runMinutes(startIso, finishIso) == null)) {
        entryTimes.finished_at = finishIso;
      }

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
        {/* Warn before the window shuts. The database decides — its
            session_write_deadline() is the authority — so this never disables the
            form: a tablet with a wrong clock must not be able to block a shift from
            being recorded. It only makes the deadline visible, which is what was
            missing when the Line 4 night operator discovered it by failing. */}
        {(() => {
          const { sessionDate: sd, shiftCode: sc } = getCurrentFactoryShift();
          const sh: Shift = sc === "night" ? "NIGHT" : "DAY";
          const deadline = shiftLoggingDeadline(sd, sh);
          const msLeft = deadline.getTime() - Date.now();
          const closedAt = sh === "NIGHT" ? "06:15" : "18:15";
          if (msLeft <= 0) {
            return (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-strong">
                <b>Logging closed for this shift at {closedAt}.</b> Ask a manager to record it — they can still enter it for you.
              </div>
            );
          }
          if (msLeft <= 30 * 60_000) {
            return (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-strong">
                <b>Logging closes at {closedAt}</b> — {Math.ceil(msLeft / 60_000)} min left. Enter what the line made before then.
              </div>
            );
          }
          return null;
        })()}

        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Log Production</div>
            <div className="text-xs text-muted-foreground">Record produced quantity to the current shift.</div>
          </div>
        </div>

        {/* The iTouching job panel that used to sit here is gone. Its part codes
            carry batch suffixes ("OCMC6 - B1" against our "OCMC6"), so tapping a
            job logged a code the system doesn't hold and the two records drifted
            apart. Part codes now come only from sku_products. */}

        {/* SKU */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Part code produced</div>

          {/* Type the part code and the rest of the record fills itself from
              sku_products. The "Refresh SKU list" button that used to sit here
              pulled the iTouching schedule; it's gone with that source. */}
          {/* PopoverAnchor, not PopoverTrigger: the input must never toggle the
              popover. As a trigger, every tap to place the cursor flipped it shut. */}
          {skuChoice !== MANUAL_SKU && (
            <Popover
              // Opens with an EMPTY box whenever there is something to suggest, so
              // the common case is tap-and-pick with no typing at all.
              open={skuPopoverOpen && (skuDebounced.length >= 1 || hasSuggestions)}
              onOpenChange={setSkuPopoverOpen}
            >
              <PopoverAnchor asChild>
                <div className="relative" ref={skuInputWrapRef}>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={skuQuery}
                    onChange={(e) => { setSkuQuery(e.target.value); setSelectedSku(null); setSkuPopoverOpen(true); }}
                    onFocus={() => setSkuPopoverOpen(true)}
                    placeholder={hasSuggestions ? "Tap to pick, or type the part code…" : "Type the part code, e.g. OCMC6"}
                    className="h-11 pl-9"
                    autoComplete="off"
                  />
                </div>
              </PopoverAnchor>
              <PopoverContent
                className="p-0 w-[--radix-popover-trigger-width] max-h-72 overflow-auto"
                align="start"
                onOpenAutoFocus={(e) => e.preventDefault()}
                // Typing keeps focus in the input, which sits outside the
                // content — without this the list closes on the first keypress.
                onInteractOutside={(e) => {
                  if (skuInputWrapRef.current?.contains(e.target as Node)) e.preventDefault();
                }}
              >
                {/* Part code leads, description follows. The operator matches the
                    code on the box, and it's what gets logged — burying it under a
                    long description is how the wrong SKU gets picked. Every code
                    here is ours (sku_products); iTouching is not a source, because
                    its codes carry batch suffixes ("OCMC6 - B1" vs "OCMC6"). */}
                {[
                  { key: "cur", label: `This shift · ${jobLine}`, rows: currentShiftSkus, box: "border-b bg-primary/5", head: "text-primary" },
                  { key: "plan", label: `Planned · ${jobLine}`, rows: plannedSuggestions, box: "border-b bg-muted/30", head: "text-muted-foreground" },
                  { key: "prev", label: `Previous jobs · ${jobLine}`, rows: recentSuggestions, box: "border-b", head: "text-muted-foreground" },
                ].map((section) =>
                  section.rows.length === 0 ? null : (
                    <div key={section.key} className={section.box}>
                      <div className={`px-3 pt-2 pb-1 text-2xs font-semibold uppercase tracking-wider ${section.head}`}>
                        {section.label}
                      </div>
                      <ul className="divide-y">
                        {section.rows.map((s) => (
                          <li key={`${section.key}-${s.id}`}>
                            <button
                              type="button"
                              className="w-full p-2 text-left hover:bg-accent"
                              onClick={() => pickSku({ id: s.id, code: s.code, name: s.name })}
                            >
                              <div className="truncate font-mono text-sm font-bold">{s.code}</div>
                              <div className="truncate text-xs text-muted-foreground">{productLabel(s.name)}</div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ),
                )}

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
                  ) : hasSuggestions ? null : (
                    <div className="p-3 text-sm text-muted-foreground">No SKUs found</div>
                  )
                ) : (
                  <ul className="divide-y">
                    {hasSuggestions && (
                      <li className="px-3 pt-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Catalog
                      </li>
                    )}
                    {results.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="w-full text-left p-2 hover:bg-accent"
                          onClick={() => pickSku(s)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate font-mono text-sm font-bold">{s.code}</span>
                            {marketOf(s.name, s.code) && (
                              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-semibold text-primary">
                                {marketOf(s.name, s.code)}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{productLabel(s.name)}</div>
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
            className="text-2xs text-muted-foreground underline underline-offset-2"
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
            <div className="text-2xs text-warning-strong">
              Not linked to the catalog — will be logged exactly as typed. Admin reconciles it later.
            </div>
          )}
        </div>

        {/* Batch code (required) — dates can be typed in the same field.
            "B26188 07/2026 07/2028" → batch B26188, mfg 07/2026, exp 07/2028. */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Batch code
            {(mfgMonth || expMonth) && (
              <span className="ml-2 normal-case text-muted-foreground/70">
                · {mfgMonth ? mfgMonth.slice(5) + "/" + mfgMonth.slice(2, 4) : "—"} → {expMonth ? expMonth.slice(5) + "/" + expMonth.slice(2, 4) : "—"}
              </span>
            )}
          </div>
          <Input
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            onBlur={() => {
              const p = parseBatchInput(batch);
              if (p.batch !== batch) setBatch(p.batch);
              if (p.mfg) setMfgMonth(p.mfg);
              if (p.exp) setExpMonth(p.exp);
            }}
            placeholder="e.g. B26188 07/2026 07/2028"
            className="h-11"
            autoComplete="off"
          />
          <div className="text-2xs text-muted-foreground">
            Example: <span className="font-mono">B26188 07/2026 07/2028</span> — batch, then Manufactured (07/2026) and Expiry (07/2028). Type the batch on its own if you don't have the dates.
          </div>
        </div>

        {/* Send to (destination) — optional, with common suggestions */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Send to <span className="normal-case text-muted-foreground/60">(destination)</span></div>
          <Input
            list="log-prod-destinations"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="e.g. B&M, Stock, Applied..."
            className="h-11"
            autoComplete="off"
          />
          <datalist id="log-prod-destinations">
            {["Stock","Applied","Australia","B&M","Basix","Body & Fit","Capsules","Free Soul","Gel","Gymshark","H&B","Homebargains","Laperva / Body Builder","Lazer","LIDL","Peru","USA","V Health"].map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>

        {/* SKU not for EU */}
        <label className="flex items-center gap-2 select-none cursor-pointer">
          <Checkbox
            checked={notForEu}
            onCheckedChange={(v) => setNotForEu(v === true)}
          />
          <span className="text-sm font-medium">SKU not for EU</span>
        </label>


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
              <Button type="button" className="h-11 shrink-0 bg-success hover:bg-success/90 text-success-foreground" onClick={() => setStartTime(nowHM())}>
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
              <Button type="button" className="h-11 shrink-0 bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={() => setFinishTime(nowHM())}>
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

        {/* Two ways to finish, side by side rather than one under the other.
            The same SKU normally runs on several blenders, so "next blender" is the
            one an operator reaches for most of the shift — as a thinner outline button
            underneath the primary it read as the afterthought, and each save meant
            typing the product again.
            Stacked on a phone, side by side from sm up: the tablet on the line has the
            width, and two full-width buttons in a column is a lot of thumb travel. */}
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="h-14 w-full text-base font-semibold sm:order-2"
              onClick={() => onSave()}
              disabled={saving}
            >
              {saving
                ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Saving…</>
                : <><Plus className="h-5 w-5 mr-2" /> Save &amp; finish</>}
            </Button>
            <Button
              type="button"
              className="h-14 w-full text-base font-semibold sm:order-1"
              onClick={() => onSave({ keepProduct: true })}
              disabled={saving}
            >
              {saving
                ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Saving…</>
                : <><Repeat className="h-5 w-5 mr-2" /> Save &amp; next blender</>}
            </Button>
          </div>
          <div className="grid gap-1 text-2xs text-muted-foreground sm:grid-cols-2">
            <span className="sm:order-1">Keeps the product and batch — enter the blender and quantity only.</span>
            <span className="sm:order-2">Clears the whole form for a different product.</span>
          </div>
        </div>

        <LoggedThisShift sessionId={sessionId} />
      </CardContent>
    </Card>
  );
}

function LoggedThisShift({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
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
        .select("id, blender_number, blender_label, quantity, started_at, finished_at, created_at, production_item_id, production_items!inner(blender_ref, batch_code, manufacture_month, expiry_month, destination, not_for_eu, sku_code_text, sku:sku_products(code, name))")
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
        .select("id, actual_qty, batch_code, blender_ref, manufacture_month, expiry_month, destination, not_for_eu, created_at, sku_code_text, sku:sku_products(code, name), production_blender_entries(id)")
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
    if (!(await confirm({ title: "Delete this entry?", destructive: true, confirmText: "Delete" }))) return;
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
    if (!(await confirm({ title: "Delete this entry?", destructive: true, confirmText: "Delete" }))) return;
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
              const pi = e.production_items || {};
              const batchCode = pi.batch_code;
              const mm = (d?: string | null) => (d ? `${String(d).slice(5, 7)}/${String(d).slice(2, 4)}` : "");
              const mfg = mm(pi.manufacture_month);
              const exp = mm(pi.expiry_month);
              const dest = pi.destination;
              const nfe = !!pi.not_for_eu;
              return (
                <li key={e.id} className="flex items-center gap-3 p-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="font-mono text-sm font-semibold truncate">{sku?.code ?? e.production_items?.sku_code_text ?? "—"}</span>
                      <span className="text-xs text-muted-foreground truncate">{productLabel(sku?.name)}</span>
                      {batchCode && (
                        <span className="font-mono text-2xs text-foreground/80">{batchCode}{(mfg || exp) ? `  ${mfg || "—"} → ${exp || "—"}` : ""}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="inline-flex items-center rounded bg-secondary text-secondary-foreground px-1.5 py-0.5 text-2xs font-medium">
                        Blender {e.blender_label ?? e.blender_number}
                      </span>
                      {assembly && (
                        <span className="text-2xs text-muted-foreground">Assembly {assembly}</span>
                      )}
                      {dest && (
                        <span className="inline-flex items-center rounded bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary px-1.5 py-0.5 text-2xs font-medium">→ {dest}</span>
                      )}
                      {nfe && (
                        <span className="inline-flex items-center rounded bg-warning/10 text-warning-strong dark:bg-warning/15 dark:text-warning-strong px-1.5 py-0.5 text-2xs font-medium">Not for EU</span>
                      )}
                      {(e.started_at || e.finished_at) && (
                        <span className="text-2xs text-muted-foreground">
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
                    className="h-11 w-11 touch-manipulation text-muted-foreground hover:text-destructive-strong"
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
                    <span className="inline-flex items-center rounded bg-warning/10 text-warning-strong px-1.5 py-0.5 text-2xs font-medium">No blender</span>
                    {it.blender_ref && <span className="text-2xs text-muted-foreground">Assembly {it.blender_ref}</span>}
                    {it.batch_code && (
                      <span className="font-mono text-2xs text-foreground/80 truncate">
                        {it.batch_code}
                        {(it.manufacture_month || it.expiry_month)
                          ? `  ${it.manufacture_month ? `${String(it.manufacture_month).slice(5, 7)}/${String(it.manufacture_month).slice(2, 4)}` : "—"} → ${it.expiry_month ? `${String(it.expiry_month).slice(5, 7)}/${String(it.expiry_month).slice(2, 4)}` : "—"}`
                          : ""}
                      </span>
                    )}
                    {it.destination && (
                      <span className="inline-flex items-center rounded bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary px-1.5 py-0.5 text-2xs font-medium">→ {it.destination}</span>
                    )}
                    {it.not_for_eu && (
                      <span className="inline-flex items-center rounded bg-warning/10 text-warning-strong dark:bg-warning/15 dark:text-warning-strong px-1.5 py-0.5 text-2xs font-medium">Not for EU</span>
                    )}
                  </div>

                </div>
                <div className="text-base font-semibold tabular-nums">{Number(it.actual_qty).toLocaleString()}</div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 touch-manipulation text-muted-foreground hover:text-destructive-strong"
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
      {confirmDialog}
    </div>
  );
}