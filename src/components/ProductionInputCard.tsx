import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, ClipboardList, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

type Item = {
  id: string;
  sku_id: string;
  code: string;
  name: string;
  target_qty: number;
  actual_qty: number;
};

type BlenderRow = { id: string; production_item_id: string; blender_number: number; quantity: number };

interface Props {
  sessionId: string;
  sessionDate: string;
  line: string;
  shift: "DAY" | "NIGHT";
  ragPlanQty: number;
  items: Item[];
  canEdit: boolean;
}

/**
 * Operator "Production Input" — enter per-SKU produced quantities with optional
 * Blender 1..4 split. Writes to production_blender_entries (trigger updates
 * production_items.actual_qty), and optionally overrides rag_weekly_entries.actual_qty.
 */
export function ProductionInputCard({
  sessionId,
  sessionDate,
  line,
  shift,
  ragPlanQty,
  items,
  canEdit,
}: Props) {
  const qc = useQueryClient();
  const { user, profile } = useAuth() as any;

  // Group items by SKU code — if the same SKU appears more than once in the shift, show blender split.
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) {
      const key = it.code || it.sku_id;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    return Array.from(m.entries());
  }, [items]);

  const itemIds = items.map((i) => i.id);

  const blendersQ = useQuery({
    enabled: itemIds.length > 0,
    queryKey: ["blender-entries", sessionId, itemIds.join(",")],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_blender_entries")
        .select("id, production_item_id, blender_number, quantity")
        .in("production_item_id", itemIds);
      if (error) throw error;
      return (data || []) as BlenderRow[];
    },
    refetchInterval: 30_000,
  });

  const ragQ = useQuery({
    queryKey: ["rag-actual-stamp", sessionDate, line, shift],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("rag_weekly_entries")
        .select("actual_qty, updated_at, actual_updated_by, id")
        .eq("entry_date", sessionDate)
        .eq("line", line)
        .eq("shift", shift)
        .maybeSingle();
      return data as { actual_qty: number; updated_at: string; actual_updated_by: string | null; id: string } | null;
    },
    refetchInterval: 30_000,
  });

  // Local edit state: itemId -> { [blender]: value }
  const [values, setValues] = useState<Record<string, Record<number, string>>>({});
  const [totalOverride, setTotalOverride] = useState<string>("");
  const [manualTotal, setManualTotal] = useState(false);

  useEffect(() => {
    const next: Record<string, Record<number, string>> = {};
    for (const it of items) next[it.id] = {};
    for (const b of blendersQ.data || []) {
      if (!next[b.production_item_id]) next[b.production_item_id] = {};
      next[b.production_item_id][b.blender_number] = String(b.quantity);
    }
    setValues(next);
  }, [blendersQ.data, items.map((i) => i.id).join(",")]);

  const subtotalForItem = (itemId: string, showSplit: boolean) => {
    const v = values[itemId] || {};
    if (showSplit) {
      return [1, 2, 3, 4].reduce((s, n) => s + (Number(v[n] || 0) || 0), 0);
    }
    return Number(v[1] || 0) || 0;
  };

  const computedTotal = useMemo(() => {
    let sum = 0;
    for (const [code, its] of groups) {
      const split = its.length > 1;
      for (const it of its) sum += subtotalForItem(it.id, split);
    }
    return sum;
  }, [values, groups]);

  useEffect(() => {
    if (!manualTotal) setTotalOverride(String(computedTotal));
  }, [computedTotal, manualTotal]);

  const saveMut = useMutation({
    mutationFn: async () => {
      // 1) Delete existing blender rows for these items
      if (itemIds.length > 0) {
        const { error: delErr } = await (supabase as any)
          .from("production_blender_entries")
          .delete()
          .in("production_item_id", itemIds);
        if (delErr) throw delErr;
      }

      // 2) Insert fresh rows
      const rows: any[] = [];
      for (const [_code, its] of groups) {
        const split = its.length > 1;
        for (const it of its) {
          const v = values[it.id] || {};
          if (split) {
            for (const n of [1, 2, 3, 4]) {
              const q = Number(v[n] || 0) || 0;
              if (q > 0) rows.push({
                session_id: sessionId,
                production_item_id: it.id,
                blender_number: n,
                quantity: q,
                entered_by: user?.id ?? null,
              });
            }
          } else {
            const q = Number(v[1] || 0) || 0;
            if (q > 0) rows.push({
              session_id: sessionId,
              production_item_id: it.id,
              blender_number: 1,
              quantity: q,
              entered_by: user?.id ?? null,
            });
          }
        }
      }
      if (rows.length > 0) {
        const { error: insErr } = await (supabase as any)
          .from("production_blender_entries")
          .insert(rows);
        if (insErr) throw insErr;
      }

      // 3) If manual total override differs from computed sum, force RAG actual_qty.
      const totalToWrite = manualTotal ? Number(totalOverride || 0) : computedTotal;
      if (manualTotal && ragQ.data?.id) {
        const { error: ragErr } = await (supabase as any)
          .from("rag_weekly_entries")
          .update({
            actual_qty: totalToWrite,
            actual_updated_by: user?.id ?? null,
          })
          .eq("id", ragQ.data.id);
        if (ragErr) throw ragErr;
      } else if (ragQ.data?.id) {
        // Still stamp who saved
        await (supabase as any)
          .from("rag_weekly_entries")
          .update({ actual_updated_by: user?.id ?? null })
          .eq("id", ragQ.data.id);
      }
    },
    onSuccess: () => {
      toast.success("Production saved");
      setManualTotal(false);
      qc.invalidateQueries({ queryKey: ["blender-entries"] });
      qc.invalidateQueries({ queryKey: ["rag-actual-stamp"] });
      qc.invalidateQueries({ queryKey: ["lps-items", sessionId] });
      qc.invalidateQueries({ queryKey: ["lps-rag-plan"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (items.length === 0) return null;

  const stamp = ragQ.data?.updated_at ? new Date(ragQ.data.updated_at) : null;
  const stampBy = (profile as any)?.name || "";

  return (
    <Card className="mt-4 border-primary/30">
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-muted-foreground" />
            <span className="text-base font-semibold">Production Input</span>
          </div>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!canEdit || saveMut.isPending}
            className="h-11 px-5"
          >
            <Save className="h-4 w-4 mr-2" />
            Save shift totals
          </Button>
        </div>

        <div className="space-y-3">
          {groups.map(([code, its]) => {
            const split = its.length > 1;
            const first = its[0];
            const skuTargetTotal = its.reduce((s, i) => s + (i.target_qty || 0), 0);
            return (
              <div key={code} className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div>
                    <div className="font-mono text-sm font-semibold">{first.code}</div>
                    <div className="text-xs text-muted-foreground">{first.name}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Target (RAG): <span className="font-semibold tabular-nums text-foreground">{skuTargetTotal.toLocaleString()}</span>
                  </div>
                </div>

                {split ? (
                  <div className="space-y-2">
                    {its.map((it, idx) => (
                      <div key={it.id} className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground min-w-[70px]">Blender {idx + 1}</span>
                        {[1, 2, 3, 4].map((n) => (
                          <Input
                            key={n}
                            type="number"
                            inputMode="numeric"
                            className="h-9 w-24"
                            placeholder={`B${n}`}
                            value={values[it.id]?.[n] ?? ""}
                            onChange={(e) =>
                              setValues((prev) => ({
                                ...prev,
                                [it.id]: { ...(prev[it.id] || {}), [n]: e.target.value },
                              }))
                            }
                            disabled={!canEdit}
                          />
                        ))}
                        <span className="text-xs text-muted-foreground ml-auto">
                          Subtotal: <span className="font-semibold tabular-nums">{subtotalForItem(it.id, true).toLocaleString()}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Total Produced</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      className="h-9 w-32"
                      value={values[first.id]?.[1] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({
                          ...prev,
                          [first.id]: { ...(prev[first.id] || {}), 1: e.target.value },
                        }))
                      }
                      disabled={!canEdit}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t pt-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Total Produced This Shift</span>
            <Input
              type="number"
              inputMode="numeric"
              className={cn("h-10 w-36 font-semibold tabular-nums", manualTotal && "border-primary ring-2 ring-primary/30")}
              value={totalOverride}
              onChange={(e) => {
                setTotalOverride(e.target.value);
                setManualTotal(true);
              }}
              disabled={!canEdit}
            />
            {manualTotal && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => { setManualTotal(false); setTotalOverride(String(computedTotal)); }}
              >
                Reset to sum
              </Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {stamp ? (
              <>Last saved: {stamp.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{stampBy ? ` by ${stampBy}` : ""}</>
            ) : "Not saved yet"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
