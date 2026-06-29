import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CircularProgress } from "@/components/ui/circular-progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Delete, Clock, Maximize2, Minimize2, MessageSquare, Save, AlertTriangle, Plus, LogOut } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateWorkOrder } from "@/hooks/useWorkOrders";
import { useActiveProblemDescriptions } from "@/hooks/useProblemDescriptions";
import appliedLogo from "@/assets/appliedlogo.jpeg";

import {
  ResponsiveDialogBody,
  dialogContentResponsive,
  dialogTitleResponsive,
  dialogFooterResponsive,
  dialogFieldLabelResponsive,
  dialogControlResponsive,
  dialogPrimaryActionResponsive,
} from "@/components/ResponsiveDialogShell";


type Shift = "DAY" | "NIGHT";

function currentShift(): Shift {
  const h = londonNow().hour;
  return h >= 6 && h < 18 ? "DAY" : "NIGHT";
}

function londonNow(date = new Date()): { ymd: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

function previousDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function sessionDateForShift(shift: Shift, date = new Date()): string {
  const london = londonNow(date);
  return shift === "NIGHT" && london.hour < 6 ? previousDate(london.ymd) : london.ymd;
}

function ragColor(pct: number): string {
  if (pct >= 95) return "bg-green-600";
  if (pct >= 80) return "bg-amber-500";
  return "bg-red-600";
}

interface ItemRow {
  id: string;
  sku_id: string;
  code: string;
  name: string;
  target_qty: number;
  actual_qty: number;
  intouch_qty: number | null;
}


const LS_LINE_KEY = "lps:line";
const LS_TABLET_KEY = "lps:tablet_id";
const EDIT_TABLET_ID = "1"; // only this tablet can edit actuals/observations

export default function LineProductionScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role, signOut, user } = useAuth();
  const isOperator = role === "operator";
  const [line, setLine] = useState<string>(() => localStorage.getItem(LS_LINE_KEY) || "");
  const [tabletId, setTabletId] = useState<string>(() => localStorage.getItem(LS_TABLET_KEY) || EDIT_TABLET_ID);
  const canEdit = true; // tablet is fixed via operator account; any paired tablet can edit its own line
  const [shift, setShift] = useState<Shift>(currentShift());
  const [now, setNow] = useState<Date>(new Date());
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [pad, setPad] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [assetScope, setAssetScope] = useState<"line" | "sealer_printer">("line");
  const activeSessionDate = useMemo(() => sessionDateForShift(shift, now), [shift, now]);

  // Operator is locked to current shift — auto-update as time passes.
  useEffect(() => {
    if (!isOperator) return;
    const cur = currentShift();
    if (cur !== shift) setShift(cur);
  }, [now, isOperator, shift]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleKiosk = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e: any) {
      toast.error(e?.message || "Fullscreen not available");
    }
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Listen for admin-triggered "refresh all tablets" broadcast
  useEffect(() => {
    const ch = supabase
      .channel("tablet-control", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "reload" }, () => {
        try { window.location.reload(); } catch { /* noop */ }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    if (line) localStorage.setItem(LS_LINE_KEY, line);
  }, [line]);

  useEffect(() => {
    localStorage.setItem(LS_TABLET_KEY, tabletId);
  }, [tabletId]);

  // Operator account context: allowed lines + tablet label (e.g. "Tablet 4")
  const operatorAcctQ = useQuery({
    queryKey: ["lps-operator-acct", user?.id],
    enabled: !!user?.id,
    staleTime: 0,
    queryFn: async () => {
      const uid = user?.id;
      if (!uid) return null;
      const { data } = await (supabase as any)
        .from("operator_line_accounts")
        .select("line_ids, label")
        .eq("user_id", uid)
        .maybeSingle();
      return data as { line_ids: string[]; label: string } | null;
    },
  });

  const linesQ = useQuery({
    queryKey: ["lps-lines-scoped", user?.id, operatorAcctQ.data?.line_ids?.join(",")],
    queryFn: async () => {
      const { data: lines, error } = await (supabase as any)
        .from("lines")
        .select("id, name, display_order")
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      const all = (lines || []) as { id: string; name: string }[];
      const allowed: string[] = operatorAcctQ.data?.line_ids ?? [];
      // Operators MUST be scoped to their account's lines. If account row is
      // missing or empty, show nothing instead of falling back to all lines.
      if (isOperator) return all.filter((l) => allowed.includes(l.id));
      if (!allowed || allowed.length === 0) return all;
      return all.filter((l) => allowed.includes(l.id));
    },
    enabled: !operatorAcctQ.isLoading && (!isOperator || !!operatorAcctQ.data),
  });

  // Auto-select first allowed line; clear stale stored line.
  useEffect(() => {
    const list = linesQ.data;
    if (!list) return;
    if (list.length >= 1 && (!line || !list.some((l) => l.name === line))) {
      setLine(list[0].name);
    }
  }, [linesQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock tabletId from the operator account label (e.g. "Tablet 4" -> "4")
  useEffect(() => {
    if (!isOperator) return;
    const lbl = operatorAcctQ.data?.label || "";
    const m = lbl.match(/(\d+)/);
    if (m && m[1] !== tabletId) setTabletId(m[1]);
  }, [isOperator, operatorAcctQ.data?.label]); // eslint-disable-line react-hooks/exhaustive-deps


  const sessionQ = useQuery({
    enabled: !!line,
    queryKey: ["lps-session", line, shift, activeSessionDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_sessions")
        .select("id, leader_name, locked, notes, intouch_good_total")
        .eq("line", line)
        .eq("session_date", activeSessionDate)
        .eq("shift", shift)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });

  const itemsQ = useQuery({
    enabled: !!sessionQ.data?.id,
    queryKey: ["lps-items", sessionQ.data?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_items")
        .select("id, sku_id, target_qty, actual_qty, intouch_qty, sku:sku_products(code, name)")
        .eq("session_id", sessionQ.data!.id);
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        sku_id: r.sku_id,
        code: r.sku?.code || "—",
        name: r.sku?.name || "—",
        target_qty: Number(r.target_qty ?? r.planned_qty ?? 0),
        actual_qty: Number(r.intouch_qty ?? r.actual_qty ?? 0),
        intouch_qty: r.intouch_qty == null ? null : Number(r.intouch_qty),
      })) as ItemRow[];

    },
    refetchInterval: 15_000,
  });

  // RAG Weekly plan for this line/shift/today — drives the displayed target
  const ragPlanQ = useQuery({
    enabled: !!line,
    queryKey: ["lps-rag-plan", line, shift, activeSessionDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rag_weekly_entries")
        .select("plan_qty")
        .eq("entry_date", activeSessionDate)
        .eq("line", line)
        .eq("shift", shift)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.plan_qty ?? 0);
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  // Realtime: refresh when RAG Weekly changes for this line/shift/today
  useEffect(() => {
    const channel = supabase
      .channel(`lps_rag_sync_${line}_${shift}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rag_weekly_entries" },
        (payload) => {
          const row: any = (payload as any).new ?? (payload as any).old ?? {};
          if (!row.entry_date) {
            qc.invalidateQueries({ queryKey: ["lps-rag-plan"] });
            return;
          }
          if (row.entry_date === activeSessionDate && row.line === line && row.shift === shift) {
            qc.invalidateQueries({ queryKey: ["lps-rag-plan", line, shift, activeSessionDate] });
            qc.invalidateQueries({ queryKey: ["lps-items", sessionQ.data?.id] });
            toast.info("Target updated from RAG Weekly");
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, line, shift, activeSessionDate, sessionQ.data?.id]);

  const items = itemsQ.data || [];

  const totals = useMemo(() => {
    const ragTotal = ragPlanQ.data || 0;
    // RAG Weekly plan_qty is the single source of truth for the shift target.
    const target = ragTotal;
    // Current Shift = live iTouching good total (independent of operator edits).
    // Fall back to the per-SKU sum only until the first iTouching sync stamps the session.
    const itouchTotal = Number((sessionQ.data as any)?.intouch_good_total ?? 0);
    const itemsSum = items.reduce((s, i) => s + (i.actual_qty || 0), 0);
    const actual = itouchTotal > 0 ? itouchTotal : itemsSum;
    const remaining = Math.max(0, target - actual);
    const pct = target > 0 ? (actual / target) * 100 : 0;
    return { target, actual, remaining, pct };
  }, [items, ragPlanQ.data, sessionQ.data]);

  const updateActual = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      const { error } = await (supabase as any)
        .from("production_items")
        .update({ actual_qty: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      // Narrow invalidation to this session only — avoids re-fetching every tablet view.
      qc.invalidateQueries({ queryKey: ["lps-items", sessionQ.data?.id] });
      toast.success("Saved");
    },
    onError: (e: any) => toast.error(e.message || "Failed to save"),
  });

  const syncSkus = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("intouch-sync-production", {
        body: { session_date: activeSessionDate, shift, line, force: true, debug_discover: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setLastSyncAt(new Date());
      qc.invalidateQueries({ queryKey: ["lps-session", line, shift, activeSessionDate] });
      qc.invalidateQueries({ queryKey: ["lps-items", sessionQ.data?.id] });
      toast.success("SKUs synced from iTouching");
    },
    onError: (e: any) => toast.error(e.message || "Sync failed"),
  });

  // Is this line mapped to an iTouching machine? Lines without a mapping
  // (e.g. Capsules Machine 1/2) are maintenance-only terminals.
  const currentLineId = useMemo(
    () => (linesQ.data || []).find((l) => l.name === line)?.id,
    [linesQ.data, line],
  );
  const intouchMapQ = useQuery({
    enabled: !!currentLineId,
    queryKey: ["lps-intouch-map", currentLineId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("intouch_machine_map")
        .select("intouch_machine_id, active")
        .eq("line_id", currentLineId)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { intouch_machine_id: string; active: boolean } | null;
    },
  });
  const hasItouch = !!intouchMapQ.data?.intouch_machine_id;

  // Auto-pull live actuals from iTouching for THIS line/shift so the operator
  // screen reflects real production without waiting for the global cron.
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  useEffect(() => {
    if (!line || !sessionQ.data?.id || !hasItouch) return;
    let cancelled = false;
    const run = async () => {
      try {
        await supabase.functions.invoke("intouch-sync-production", {
          body: { session_date: activeSessionDate, shift, line, force: true },
        });
        if (!cancelled) {
          setLastSyncAt(new Date());
          // Refresh session (intouch_good_total), items and RAG plan.
          qc.invalidateQueries({ queryKey: ["lps-session", line, shift, activeSessionDate] });
          qc.invalidateQueries({ queryKey: ["lps-items", sessionQ.data?.id] });
          qc.invalidateQueries({ queryKey: ["lps-rag-plan", line, shift, activeSessionDate] });
        }
      } catch { /* ignore — next tick retries */ }
    };
    run();
    const t = setInterval(run, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [line, shift, activeSessionDate, sessionQ.data?.id, hasItouch, qc]);

  // True when the sync ran but iTouching did not return a good-count for this line/shift.
  const intouchGoodMissing =
    hasItouch &&
    !!sessionQ.data &&
    !!lastSyncAt &&
    ((sessionQ.data as any)?.intouch_good_total === null || (sessionQ.data as any)?.intouch_good_total === undefined);

  // Per-shift observations (notes on production_sessions)
  const [notes, setNotes] = useState<string>("");
  useEffect(() => {
    setNotes(sessionQ.data?.notes ?? "");
  }, [sessionQ.data?.id, sessionQ.data?.notes]);

  const saveNotes = useMutation({
    mutationFn: async (value: string) => {
      if (!sessionQ.data?.id) throw new Error("No session");
      const { error } = await (supabase as any)
        .from("production_sessions")
        .update({ notes: value })
        .eq("id", sessionQ.data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lps-session", line, shift, activeSessionDate] });
      toast.success("Observations saved");
    },
    onError: (e: any) => toast.error(e.message || "Failed to save observations"),
  });

  // Open downtimes for current line/shift/date
  const openDowntimesQ = useQuery({
    queryKey: ["lps-open-downtimes", line, shift, activeSessionDate],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_downtimes")
        .select("id, category, reason, started_at, ended_at, occurred_date, shift, line")
        .eq("line", line)
        .eq("shift", shift)
        .eq("occurred_date", activeSessionDate)
        .is("ended_at", null)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        category: string | null;
        reason: string | null;
        started_at: string;
      }>;
    },
    refetchInterval: 30_000,
  });

  const openEditor = useCallback((row: ItemRow) => {
    if (!canEdit) {
      toast.error("Read-only");
      return;
    }
    setEditing(row);
    setPad(String(row.actual_qty || ""));
  }, [canEdit]);

  const padPress = useCallback((k: string) => {
    if (k === "C") return setPad("");
    if (k === "←") return setPad((p) => p.slice(0, -1));
    setPad((p) => {
      if (k === "." && p.includes(".")) return p;
      if (p.length >= 9) return p;
      return p === "0" && k !== "." ? k : p + k;
    });
  }, []);

  const saveEditor = async () => {
    if (!editing) return;
    const v = Number(pad);
    if (!Number.isFinite(v) || v < 0) {
      toast.error("Invalid value");
      return;
    }
    await updateActual.mutateAsync({ id: editing.id, value: v });
    setEditing(null);
  };

  return (
    <div className="min-h-screen bg-background p-3 md:p-6 select-none">
      {/* Header */}
      <Card className="mb-4">
        <CardContent className="p-3 md:p-4 flex flex-wrap items-center gap-3">
          <img
            src={appliedLogo}
            alt="Applied Nutrition"
            className="h-10 md:h-12 w-auto rounded-md object-cover shrink-0"
          />
          {!isOperator && (
            <Button variant="ghost" size="lg" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5 mr-2" /> Exit
            </Button>
          )}

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Line</span>
            {isOperator ? (
              <Badge className="h-12 px-4 text-xl font-bold">{line || "—"}</Badge>
            ) : (
              <Select value={line} onValueChange={setLine}>
                <SelectTrigger className="h-12 min-w-[180px] text-lg">
                  <SelectValue placeholder="Select line" />
                </SelectTrigger>
                <SelectContent>
                  {(linesQ.data || []).map((l) => (
                    <SelectItem key={l.id} value={l.name} className="text-lg">
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {isOperator ? (
            <Badge className="h-12 px-4 text-xl font-bold" variant="secondary">{shift}</Badge>
          ) : (
            <div className="flex gap-1">
              {(["DAY", "NIGHT"] as Shift[]).map((s) => (
                <Button
                  key={s}
                  size="lg"
                  variant={shift === s ? "default" : "outline"}
                  onClick={() => setShift(s)}
                  className="h-12 px-6"
                >
                  {s}
                </Button>
              ))}
            </div>
          )}
          <Badge variant="outline" className="h-10 px-3 text-sm">
            {activeSessionDate}
          </Badge>
          {/* Asset scope toggle: report problem for Line or Sealer/Printer */}
          <div className="flex gap-1" data-testid="asset-scope-toggle">
            <Button
              size="lg"
              variant={assetScope === "line" ? "default" : "outline"}
              onClick={() => setAssetScope("line")}
              className="h-12 px-4"
            >
              Line
            </Button>
            <Button
              size="lg"
              variant={assetScope === "sealer_printer" ? "default" : "outline"}
              onClick={() => setAssetScope("sealer_printer")}
              className="h-12 px-4"
            >
              Sealer / Printer
            </Button>
          </div>
          {/* Tablet selector removed — each operator login is bound to its own tablet/line */}

          <div className="ml-auto flex items-center gap-3">
            <SyncStatusIndicator
              isSyncing={itemsQ.isFetching || ragPlanQ.isFetching || sessionQ.isFetching || updateActual.isPending}
              error={updateActual.error || itemsQ.error || ragPlanQ.error}
              label={isOperator ? "" : "Sync"}
              className={isOperator ? "px-1.5 py-0.5 text-[10px] [&_span]:hidden" : ""}
            />

            <Button
              size="lg"
              className="h-12 bg-red-600 hover:bg-red-700 text-white"
              onClick={() => setRequestOpen(true)}
              disabled={!line}
            >
              <AlertTriangle className="h-5 w-5 mr-2" />
              Request Maintenance
            </Button>
            <Button variant="outline" size="lg" onClick={toggleKiosk} className="h-12">
              {isFullscreen ? <Minimize2 className="h-5 w-5 mr-2" /> : <Maximize2 className="h-5 w-5 mr-2" />}
              {isFullscreen ? "Exit Kiosk" : "Kiosk"}
            </Button>
            {!isOperator && (
              <Button
                variant="outline"
                size="lg"
                className="h-12"
                disabled={syncSkus.isPending || !line}
                onClick={() => syncSkus.mutate()}
              >
                {syncSkus.isPending ? "Syncing…" : "Sync SKUs"}
              </Button>
            )}
            <div className="flex items-center gap-2 text-2xl font-mono tabular-nums">
              <Clock className="h-6 w-6" />
              {now.toLocaleTimeString("en-GB", { hour12: false })}
            </div>
            <Button
              variant="outline"
              size="lg"
              className="h-12"
              onClick={async () => { await signOut(); navigate("/login"); }}
            >
              <LogOut className="h-5 w-5 mr-2" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>

      {!line && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground text-lg">
            Select a line to begin.
          </CardContent>
        </Card>
      )}

      {line && linesQ.data && currentLineId && intouchMapQ.isFetched && !hasItouch && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-10 text-center space-y-2">
            <div className="text-2xl font-semibold">Maintenance terminal</div>
            <div className="text-muted-foreground">
              <span className="font-medium">{line}</span> is not mapped to iTouching.
              <br />Use <strong>Request Maintenance</strong> above to open a work order.
              No production tracking is available for this line.
            </div>
          </CardContent>
        </Card>
      )}

      {line && hasItouch && !ragPlanQ.isLoading && (ragPlanQ.data ?? 0) <= 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-10 text-center space-y-2">
            <div className="text-2xl font-semibold text-amber-500">No planned shift today</div>
            <div className="text-muted-foreground">
              No target set for <span className="font-medium">{line}</span> · {shift} on {activeSessionDate}.
              <br />Ask the supervisor to fill the plan in RAG Weekly.
            </div>
          </CardContent>
        </Card>
      )}

      {line && hasItouch && (ragPlanQ.data ?? 0) > 0 && !sessionQ.isLoading && !sessionQ.data && (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <div className="text-xl font-semibold">No session yet for {line} – {shift}</div>
            <div className="text-muted-foreground">
              RAG plan = {(ragPlanQ.data ?? 0).toLocaleString()}. Start the shift to begin tracking actuals.
            </div>
            <Button
              className="h-12"
              onClick={async () => {
                const { error } = await (supabase as any)
                  .from("production_sessions")
                  .upsert(
                    { session_date: activeSessionDate, line, shift, notes: "[Started from tablet]" },
                    { onConflict: "session_date,line,shift" },
                  );
                if (error) { toast.error(error.message); return; }
                qc.invalidateQueries({ queryKey: ["lps-session", line, shift, activeSessionDate] });
                toast.success("Shift started");
              }}
            >
              Start shift
            </Button>
          </CardContent>
        </Card>
      )}


      {hasItouch && sessionQ.data && (ragPlanQ.data ?? 0) > 0 && (
        <>
          {intouchGoodMissing && (
            <Card className="mb-3 border-amber-500/50 bg-amber-500/10">
              <CardContent className="p-3 flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div className="flex-1 text-amber-700 dark:text-amber-300">
                  <strong>iTouching live count unavailable</strong> for {line} · {shift}. Showing manual SKU sums until the next sync returns data.
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => syncSkus.mutate()}
                  disabled={syncSkus.isPending}
                >
                  {syncSkus.isPending ? "Syncing…" : "Sync now"}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* KPI — Production Performance style */}
          {(() => {
            const eff = totals.pct;
            const gap = totals.actual - totals.target;
            const borderColor = eff >= 100 ? "border-green-500" : eff >= 80 ? "border-amber-500" : "border-red-500";
            const headerBg = eff >= 100 ? "bg-green-500/15" : eff >= 80 ? "bg-amber-500/15" : "bg-red-500/15";
            const headerText = eff >= 100 ? "text-green-600 dark:text-green-400" : eff >= 80 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
            return (
              <Card className={cn("overflow-hidden border-l-4 mb-4", borderColor)}>
                <div className={cn("px-4 py-2 flex items-center justify-between", headerBg, headerText)}>
                  <div className="font-semibold">{line}</div>
                  <div className="text-xs">{sessionQ.data.leader_name ?? "—"} · {shift}</div>
                </div>
                <CardContent className="p-4 md:p-6 flex items-center gap-6 flex-wrap">
                  <CircularProgress value={eff} size={120} strokeWidth={10} />
                  <div className="flex-1 min-w-[200px] space-y-1 text-base md:text-lg">
                    <div className="flex justify-between"><span className="text-muted-foreground">Target</span><span className="font-semibold tabular-nums">{totals.target.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Current Shift</span><span className="font-semibold tabular-nums text-primary">{totals.actual.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Gap</span><span className={cn("font-semibold tabular-nums", gap >= 0 ? "text-green-500" : "text-red-500")}>{gap.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Remaining</span><span className="font-semibold tabular-nums">{totals.remaining.toLocaleString()}</span></div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Progress */}
          <Card className="mb-4">
            <CardContent className="p-4 md:p-6 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold">Shift progress</span>
                <span className="text-2xl font-bold tabular-nums">
                  {totals.pct.toFixed(1)}%
                </span>
              </div>
              <div className="h-5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full transition-all", ragColor(totals.pct))}
                  style={{ width: `${Math.min(100, totals.pct)}%` }}
                />
              </div>
              {sessionQ.data.leader_name && (
                <div className="text-sm text-muted-foreground">
                  Leader: <span className="font-medium">{sessionQ.data.leader_name}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* SKU list */}
          <div className="grid gap-3 md:grid-cols-2">
            {items.length === 0 && !itemsQ.isLoading && (
              <Card className="md:col-span-2">
                <CardContent className="p-8 text-center text-muted-foreground">
                  No SKUs for this session.
                </CardContent>
              </Card>
            )}
            {items.map((it) => {
              const effTarget = it.target_qty > 0
                ? it.target_qty
                : (items.length > 0 ? Math.round((ragPlanQ.data || 0) / items.length) : 0);
              return (
                <SkuCard
                  key={it.id}
                  item={it}
                  effTarget={effTarget}
                  onOpen={openEditor}
                />
              );
            })}
          </div>

          {/* Shift observations */}
          <Card className="mt-4">
            <CardContent className="p-4 md:p-6 space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-muted-foreground" />
                <span className="text-base font-semibold">Shift observations</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  Downtime, problems, notes for this shift
                </span>
              </div>
              {(openDowntimesQ.data?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  {openDowntimesQ.data!.map((d) => {
                    const mins = Math.max(0, Math.round((Date.now() - new Date(d.started_at).getTime()) / 60000));
                    const h = Math.floor(mins / 60);
                    const m = mins % 60;
                    return (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 rounded-md border border-orange-500/60 bg-orange-500/10 px-3 py-2"
                      >
                        <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {d.category || "Downtime"}
                            {d.reason ? <span className="text-muted-foreground"> — {d.reason}</span> : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {h}h {m}m em andamento
                          </div>
                        </div>
                        <Badge variant="destructive" className="shrink-0">Em andamento</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="E.g. Filler 2 stopped 14:20–14:55 (sensor), changeover SKU-123→SKU-456 at 16:00…"
                className="min-h-[120px] text-base"
                readOnly={!canEdit}
              />
              <div className="flex justify-end">
                <Button
                  className="h-12 px-6"
                  onClick={() => saveNotes.mutate(notes)}
                  disabled={!canEdit || saveNotes.isPending || notes === (sessionQ.data?.notes ?? "")}
                >
                  <Save className="h-5 w-5 mr-2" />
                  Save observations
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Numpad editor */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {editing?.code}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                · Target {editing?.target_qty.toLocaleString()}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-muted p-4 text-right text-5xl font-mono tabular-nums min-h-[80px]">
              {pad || "0"}
            </div>
            {editing && editing.target_qty > 0 && (
              <div className="text-right text-sm text-muted-foreground">
                {((Number(pad || 0) / editing.target_qty) * 100).toFixed(1)}% of target
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "←"].map((k) => (
                <Button
                  key={k}
                  variant={k === "←" ? "secondary" : "outline"}
                  className="h-16 text-2xl"
                  onClick={() => padPress(k)}
                >
                  {k === "←" ? <Delete className="h-6 w-6" /> : k}
                </Button>
              ))}
            </div>
            <Button variant="outline" className="w-full h-12" onClick={() => setPad("")}>
              Clear
            </Button>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-12" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button className="h-12" onClick={saveEditor} disabled={updateActual.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RequestOrderDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        line={line}
        operatorLabel={operatorAcctQ.data?.label || `Tablet ${tabletId}`}
        assetScope={assetScope}
      />
    </div>
  );
}

const SkuCard = memo(function SkuCard({
  item,
  effTarget,
  onOpen,
}: {
  item: ItemRow;
  effTarget: number;
  onOpen: (row: ItemRow) => void;
}) {
  const pct = effTarget > 0 ? (item.actual_qty / effTarget) * 100 : 0;
  const done = pct >= 100;
  return (
    <Card
      onClick={() => onOpen({ ...item, target_qty: effTarget })}
      className={cn(
        "cursor-pointer active:scale-[0.99] transition",
        done && "bg-emerald-500/10 border-emerald-500/40",
      )}
    >
      <CardContent className="p-5 md:p-6 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono font-bold text-base flex items-center gap-2">
              {item.code}
              {item.target_qty === 0 && effTarget === 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Intouch
                </Badge>
              )}
            </div>
            <div className="text-sm text-muted-foreground truncate">{item.name}</div>
          </div>
          <Badge variant="outline" className="text-base tabular-nums shrink-0">
            {effTarget === 0 ? "No plan" : `${pct.toFixed(0)}%`}
          </Badge>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-3xl font-bold tabular-nums">
            {item.actual_qty.toLocaleString()}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">
            / {effTarget.toLocaleString()}
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full transition-all", ragColor(pct))}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
});

// placeholder removed

function RequestOrderDialog({
  open,
  onOpenChange,
  line,
  operatorLabel,
  assetScope = "line",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  line: string;
  operatorLabel: string;
  assetScope?: "line" | "sealer_printer";
}) {
  const createWO = useCreateWorkOrder();
  const problemsQ = useActiveProblemDescriptions();
  const [problem, setProblem] = useState<string>("");
  const [customDesc, setCustomDesc] = useState<string>("");
  const [priority, setPriority] = useState<string>("high");
  const [machine, setMachine] = useState<string>("");
  const [requestedBy, setRequestedBy] = useState<string>("");
  const [lineStatus, setLineStatus] = useState<"stopped" | "running">("stopped");

  // Lookup line_id for the selected line name
  const lineQ = useQuery({
    enabled: open && !!line,
    queryKey: ["lps-req-line-id", line],
    queryFn: async () => {
      const { data } = await (supabase as any).from("lines").select("id").eq("name", line).maybeSingle();
      return data?.id as string | null;
    },
  });

  // Machines on this line (optional)
  const machinesQ = useQuery({
    enabled: open && !!lineQ.data,
    queryKey: ["lps-req-machines", lineQ.data],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("machines")
        .select("id, name, fixed_line, current_line, line")
        .or(`fixed_line.eq.${line},current_line.eq.${line},line.eq.${line}`);
      return (data || []) as { id: string; name: string }[];
    },
  });

  const submit = async () => {
    const description = problem === "__custom__" || !problem ? customDesc.trim() : problem;
    if (!description) {
      toast.error("Please describe the problem");
      return;
    }
    try {
      await createWO.mutateAsync({
        requester_name: requestedBy.trim() || operatorLabel || "Operator",
        machine: machine || "",
        description,
        priority: lineStatus === "stopped" ? "high" : priority,
        line_id: lineQ.data || null,
        line_stopped: lineStatus === "stopped",
      } as any);
      toast.success("Maintenance order opened");
      onOpenChange(false);
      setProblem(""); setCustomDesc(""); setMachine(""); setRequestedBy(""); setPriority("high"); setLineStatus("stopped");
    } catch (e: any) {
      toast.error(e?.message || "Failed to open order");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="maintenance-dialog"
        className={dialogContentResponsive}
      >
        <DialogHeader>
          <DialogTitle className={dialogTitleResponsive}>
            <AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6 text-red-500 shrink-0" />
            <span className="truncate">Request Maintenance — {line}</span>
          </DialogTitle>
        </DialogHeader>
        <ResponsiveDialogBody data-testid="maintenance-dialog-body">
          <div className="space-y-2">
            <Label className={dialogFieldLabelResponsive}>Line status</Label>
            <div
              data-testid="line-status-grid"
              className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3"
            >
              <Button
                type="button"
                variant={lineStatus === "stopped" ? "default" : "outline"}
                className={`h-12 sm:h-14 text-sm sm:text-base whitespace-normal ${lineStatus === "stopped" ? "bg-red-600 hover:bg-red-700 text-white" : ""}`}
                onClick={() => setLineStatus("stopped")}
              >
                🛑 Machine stopped
              </Button>
              <Button
                type="button"
                variant={lineStatus === "running" ? "default" : "outline"}
                className={`h-12 sm:h-14 text-sm sm:text-base whitespace-normal ${lineStatus === "running" ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
                onClick={() => { setLineStatus("running"); setPriority("medium"); }}
              >
                ⚙️ Running — needs maintenance
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label className={dialogFieldLabelResponsive}>Requested by</Label>
            <Input
              className={dialogControlResponsive}
              placeholder={operatorLabel || "Your name / tablet"}
              value={requestedBy}
              onChange={(e) => setRequestedBy(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className={dialogFieldLabelResponsive}>Machine (optional)</Label>
            <Select value={machine || "__none__"} onValueChange={(v) => setMachine(v === "__none__" ? "" : v)}>
              <SelectTrigger className={dialogControlResponsive}><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Any —</SelectItem>
                {(machinesQ.data || []).map((m) => (
                  <SelectItem key={m.id} value={m.name} className="text-base sm:text-lg">{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className={dialogFieldLabelResponsive}>Problem</Label>
            <Select value={problem} onValueChange={setProblem}>
              <SelectTrigger className={dialogControlResponsive}><SelectValue placeholder="Select problem" /></SelectTrigger>
              <SelectContent>
                {(problemsQ.data || []).map((p: any) => (
                  <SelectItem key={p.id} value={p.name} className="text-base sm:text-lg">{p.name}</SelectItem>
                ))}
                <SelectItem value="__custom__" className="text-base sm:text-lg">— Other (describe) —</SelectItem>
              </SelectContent>
            </Select>
            {(problem === "__custom__" || !problem) && (
              <Textarea
                className="min-h-[80px] text-base mt-2"
                placeholder="Describe the problem"
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
              />
            )}
          </div>
        </ResponsiveDialogBody>
        <DialogFooter className={dialogFooterResponsive}>
          <Button variant="outline" className={dialogPrimaryActionResponsive} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className={`${dialogPrimaryActionResponsive} bg-red-600 hover:bg-red-700 text-white`}
            onClick={submit}
            disabled={createWO.isPending}
          >
            <Plus className="h-5 w-5 mr-2" /> {createWO.isPending ? "Opening…" : "Open Order"}
          </Button>
        </DialogFooter>
      </DialogContent>

    </Dialog>
  );
}
