import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { ArrowLeft, Delete, Clock, Maximize2, Minimize2, MessageSquare, Save } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";

type Shift = "DAY" | "NIGHT";

function currentShift(): Shift {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? "DAY" : "NIGHT";
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
}

const LS_LINE_KEY = "lps:line";

export default function LineProductionScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [line, setLine] = useState<string>(() => localStorage.getItem(LS_LINE_KEY) || "");
  const [shift, setShift] = useState<Shift>(currentShift());
  const [now, setNow] = useState<Date>(new Date());
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [pad, setPad] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

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

  useEffect(() => {
    if (line) localStorage.setItem(LS_LINE_KEY, line);
  }, [line]);

  const linesQ = useQuery({
    queryKey: ["lps-lines"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("lines")
        .select("id, name, display_order")
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
  });

  const sessionQ = useQuery({
    enabled: !!line,
    queryKey: ["lps-session", line, shift, todayISO()],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_sessions")
        .select("id, leader_name, locked, notes")
        .eq("line", line)
        .eq("session_date", todayISO())
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
        .select("id, sku_id, target_qty, actual_qty, sku:sku_products(code, name)")
        .eq("session_id", sessionQ.data!.id);
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        sku_id: r.sku_id,
        code: r.sku?.code || "—",
        name: r.sku?.name || "—",
        target_qty: Number(r.target_qty ?? r.planned_qty ?? 0),
        actual_qty: Number(r.actual_qty ?? 0),
      })) as ItemRow[];
    },
    refetchInterval: 15_000,
  });

  // RAG Weekly plan for this line/shift/today — drives the displayed target
  const ragPlanQ = useQuery({
    enabled: !!line,
    queryKey: ["lps-rag-plan", line, shift, todayISO()],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rag_weekly_entries")
        .select("plan_qty")
        .eq("entry_date", todayISO())
        .eq("line", line)
        .eq("shift", shift)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.plan_qty ?? 0);
    },
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
          if (row.entry_date === todayISO() && row.line === line && row.shift === shift) {
            qc.invalidateQueries({ queryKey: ["lps-rag-plan", line, shift, todayISO()] });
            qc.invalidateQueries({ queryKey: ["lps-items", sessionQ.data?.id] });
            toast.info("Target updated from RAG Weekly");
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, line, shift, sessionQ.data?.id]);

  const rawItems = itemsQ.data || [];
  const items = useMemo(() => {
    const ragTotal = ragPlanQ.data || 0;
    if (ragTotal <= 0 || rawItems.length === 0) return rawItems;
    const base = Math.floor(ragTotal / rawItems.length);
    const rem = ragTotal - base * rawItems.length;
    return rawItems.map((i, idx) => ({
      ...i,
      target_qty: base + (idx < rem ? 1 : 0),
    }));
  }, [rawItems, ragPlanQ.data]);

  const totals = useMemo(() => {
    const target = items.reduce((s, i) => s + (i.target_qty || 0), 0);
    const actual = items.reduce((s, i) => s + (i.actual_qty || 0), 0);
    const remaining = Math.max(0, target - actual);
    const pct = target > 0 ? (actual / target) * 100 : 0;
    return { target, actual, remaining, pct };
  }, [items]);

  const updateActual = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      const { error } = await (supabase as any)
        .from("production_items")
        .update({ actual_qty: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lps-items"] });
      toast.success("Saved");
    },
    onError: (e: any) => toast.error(e.message || "Failed to save"),
  });

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
      qc.invalidateQueries({ queryKey: ["lps-session", line, shift, todayISO()] });
      toast.success("Observations saved");
    },
    onError: (e: any) => toast.error(e.message || "Failed to save observations"),
  });

  const openEditor = (row: ItemRow) => {
    setEditing(row);
    setPad(String(row.actual_qty || ""));
  };

  const padPress = (k: string) => {
    if (k === "C") return setPad("");
    if (k === "←") return setPad((p) => p.slice(0, -1));
    if (k === "." && pad.includes(".")) return;
    if (pad.length >= 9) return;
    setPad((p) => (p === "0" && k !== "." ? k : p + k));
  };

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
          <Button variant="ghost" size="lg" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5 mr-2" /> Exit
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Line</span>
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
          </div>
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
          <div className="ml-auto flex items-center gap-3">
            <SyncStatusIndicator
              isSyncing={itemsQ.isFetching || ragPlanQ.isFetching || sessionQ.isFetching || updateActual.isPending}
              error={updateActual.error || itemsQ.error || ragPlanQ.error}
            />
            <Button variant="outline" size="lg" onClick={toggleKiosk} className="h-12">
              {isFullscreen ? <Minimize2 className="h-5 w-5 mr-2" /> : <Maximize2 className="h-5 w-5 mr-2" />}
              {isFullscreen ? "Exit Kiosk" : "Kiosk"}
            </Button>
            <div className="flex items-center gap-2 text-2xl font-mono tabular-nums">
              <Clock className="h-6 w-6" />
              {now.toLocaleTimeString("en-GB", { hour12: false })}
            </div>
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

      {line && !sessionQ.isLoading && !sessionQ.data && (
        <Card>
          <CardContent className="p-10 text-center space-y-2">
            <div className="text-xl font-semibold">No session for {line} – {shift}</div>
            <div className="text-muted-foreground">
              Ask the supervisor to create / import the production plan in the Planner.
            </div>
          </CardContent>
        </Card>
      )}

      {sessionQ.data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3 md:gap-4 mb-4">
            <Card>
              <CardContent className="p-4 md:p-6">
                <div className="text-sm text-muted-foreground">Target</div>
                <div className="text-3xl md:text-5xl font-bold tabular-nums">
                  {totals.target.toLocaleString()}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 md:p-6">
                <div className="text-sm text-muted-foreground">Actual</div>
                <div className="text-3xl md:text-5xl font-bold tabular-nums text-primary">
                  {totals.actual.toLocaleString()}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 md:p-6">
                <div className="text-sm text-muted-foreground">Remaining</div>
                <div className="text-3xl md:text-5xl font-bold tabular-nums">
                  {totals.remaining.toLocaleString()}
                </div>
              </CardContent>
            </Card>
          </div>

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
              const pct = it.target_qty > 0 ? (it.actual_qty / it.target_qty) * 100 : 0;
              const done = pct >= 100;
              return (
                <Card
                  key={it.id}
                  onClick={() => openEditor(it)}
                  className={cn(
                    "cursor-pointer active:scale-[0.99] transition",
                    done && "bg-emerald-500/10 border-emerald-500/40",
                  )}
                >
                  <CardContent className="p-5 md:p-6 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-base flex items-center gap-2">
                          {it.code}
                          {it.target_qty === 0 && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              Intouch
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">{it.name}</div>
                      </div>
                      <Badge variant="outline" className="text-base tabular-nums shrink-0">
                        {it.target_qty === 0 ? "No plan" : `${pct.toFixed(0)}%`}
                      </Badge>
                    </div>

                    <div className="flex items-baseline justify-between">
                      <span className="text-3xl font-bold tabular-nums">
                        {it.actual_qty.toLocaleString()}
                      </span>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        / {it.target_qty.toLocaleString()}
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
            })}
          </div>
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
    </div>
  );
}
