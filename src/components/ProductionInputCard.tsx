import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Check, Loader2, Trash2, X, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatMinutes } from "@/lib/formatDuration";

type Item = {
  id: string;
  sku_id: string;
  code: string;
  name: string;
  target_qty: number;
  actual_qty: number;
  is_manual?: boolean;
};

interface Props {
  sessionId: string;
  sessionDate: string;
  line: string;
  shift: "DAY" | "NIGHT";
  ragPlanQty: number;
  items: Item[];
  canEdit: boolean;
}

function ragText(pct: number): string {
  if (pct >= 90) return "text-green-600";
  if (pct >= 70) return "text-amber-500";
  return "text-red-600";
}

/**
 * Operator "Production Input" — manual-only per-SKU entry.
 * Shows Order Qty, estimated fill time (from sku_line_speeds.avg_units_per_hour),
 * a Total Produced field (100% manual, no iTouching pre-fill), and % completion.
 */
export function ProductionInputCard({
  sessionId,
  sessionDate: _sessionDate,
  line,
  shift,
  ragPlanQty: _ragPlanQty,
  items,
  canEdit,
}: Props) {
  const qc = useQueryClient();

  const skuCodes = useMemo(
    () => Array.from(new Set(items.map((i) => i.code).filter(Boolean))),
    [items],
  );

  // Lookup average units-per-hour from sku_line_speeds for est. fill time.
  const speedsQ = useQuery({
    enabled: !!line && skuCodes.length > 0,
    queryKey: ["sku-line-speeds", line, shift, skuCodes.sort().join(",")],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sku_line_speeds")
        .select("sku_code, avg_units_per_hour")
        .eq("line_name", line)
        .in("sku_code", skuCodes);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of data || []) {
        const v = Number(r.avg_units_per_hour || 0);
        if (v > 0) map.set(r.sku_code, v);
      }
      return map;
    },
  });

  // Local editable Total Produced per item.
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    setValues((prev) => {
      const next: Record<string, string> = {};
      for (const it of items) {
        next[it.id] = prev[it.id] ?? String(it.actual_qty ?? 0);
      }
      return next;
    });
  }, [items.map((i) => `${i.id}:${i.actual_qty}`).join("|")]);

  const [saveState, setSaveState] = useState<Record<string, "idle" | "saving" | "saved">>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["my-prod-items", sessionId] });
    qc.invalidateQueries({ queryKey: ["blender-entries"] });
    qc.invalidateQueries({ queryKey: ["lps-items", sessionId] });
    qc.invalidateQueries({ queryKey: ["rag-actual-stamp"] });
  };

  const saveItem = async (it: Item) => {
    const raw = values[it.id];
    const n = Number(raw ?? 0);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Enter a valid quantity");
      return;
    }
    setSaveState((s) => ({ ...s, [it.id]: "saving" }));
    const { error } = await (supabase as any)
      .from("production_items")
      .update({ actual_qty: n })
      .eq("id", it.id);
    if (error) {
      toast.error(error.message);
      setSaveState((s) => ({ ...s, [it.id]: "idle" }));
      return;
    }
    setSaveState((s) => ({ ...s, [it.id]: "saved" }));
    invalidateAll();
    setTimeout(() => setSaveState((s) => ({ ...s, [it.id]: "idle" })), 2000);
  };

  const deleteItem = async (it: Item) => {
    setDeletingId(it.id);
    try {
      await (supabase as any).from("production_blender_entries").delete().eq("production_item_id", it.id);
      const { error } = await (supabase as any).from("production_items").delete().eq("id", it.id);
      if (error) throw error;
      toast.success(`Removed ${it.code} from this shift`);
      setConfirmDelete(null);
      invalidateAll();
    } catch (e: any) {
      toast.error(e.message || "Failed to remove SKU");
    } finally {
      setDeletingId(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <Card className="mt-4 border-primary/30">
      <CardContent className="p-4 md:p-6 space-y-3">
        {items.map((it) => {
          const state = saveState[it.id] || "idle";
          const uph = speedsQ.data?.get(it.code);
          const orderQty = Number(it.target_qty || 0);
          const fillMinutes = uph && orderQty > 0 ? (orderQty / uph) * 60 : null;
          const producedQty = Number(values[it.id] ?? it.actual_qty ?? 0) || 0;
          const pct = orderQty > 0 ? (producedQty / orderQty) * 100 : 0;

          return (
            <div key={it.id} className="rounded-lg border bg-card/50 p-3 space-y-3">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <div className="font-mono text-sm font-semibold">{it.code}</div>
                  <div className="text-xs text-muted-foreground">{it.name}</div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-md border bg-background/60 px-3 py-2">
                      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <Clock className="h-3 w-3" /> Standard Fill Time
                      </div>
                      <div className="mt-1 text-base font-bold tabular-nums">
                        {fillMinutes !== null ? formatMinutes(fillMinutes) : "—"}
                      </div>
                    </div>
                    <div className="rounded-md border bg-background/60 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Completion</div>
                      <div className={cn("mt-1 text-base font-bold tabular-nums", ragText(pct))}>{pct.toFixed(0)}%</div>
                    </div>
                  </div>
                </div>
                {canEdit && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmDelete(it.id)}
                    aria-label={`Remove ${it.code}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {confirmDelete === it.id && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                  <div className="text-sm">
                    Remove this SKU from this shift? This won't affect the schedule in iTouching.
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="h-8"
                      disabled={deletingId === it.id}
                      onClick={() => deleteItem(it)}
                    >
                      {deletingId === it.id ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4 mr-1" />
                      )}
                      Confirm
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={deletingId === it.id}
                      onClick={() => setConfirmDelete(null)}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Produced</div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    className="h-10 w-full tabular-nums"
                    placeholder="Enter quantity produced..."
                    value={values[it.id] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [it.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); saveItem(it); }
                    }}
                    disabled={!canEdit}
                  />
                </div>
                <Button
                  type="button"
                  className={cn(
                    "h-10",
                    state === "saved" && "bg-green-600 hover:bg-green-600 text-white",
                  )}
                  variant={state === "saved" ? "default" : "default"}
                  disabled={!canEdit || state === "saving"}
                  onClick={() => saveItem(it)}
                >
                  {state === "saving" ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : state === "saved" ? (
                    <Check className="h-4 w-4 mr-1" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  {state === "saved" ? "Saved" : "Save"}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
