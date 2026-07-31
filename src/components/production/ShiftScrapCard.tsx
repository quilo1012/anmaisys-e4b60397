import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- production_items carries columns newer than the generated types
const db = supabase as any;

interface ScrapRow {
  id: string;
  sku_code_text: string | null;
  batch_code: string | null;
  actual_qty: number | null;
  scrap_qty: number | null;
  sku?: { code: string | null } | null;
}

/**
 * What the shift threw away.
 *
 * Production without scrap only measures one half of the job: a line can beat its
 * target by running fast and binning the difference, and until now the system had no
 * way of knowing. The column has existed all along and was never once filled — 0 of
 * 118 items in the last thirty days — which is why nothing that reads it could be
 * trusted.
 *
 * Recorded per item, not per shift: scrap belongs to a product and a batch, and a
 * single number for the shift cannot be traced back to what was actually wasted.
 *
 * Blank is not zero. An item nobody has touched shows empty, because "no scrap
 * recorded" and "we scrapped nothing" are different claims and a quality system should
 * not confuse them.
 */
export function ShiftScrapCard({ sessionId, locked }: { sessionId: string | null; locked?: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data: items = [] } = useQuery({
    queryKey: ["shift-scrap", sessionId],
    enabled: !!sessionId,
    queryFn: async (): Promise<ScrapRow[]> => {
      const { data, error } = await db
        .from("production_items")
        .select("id, sku_code_text, batch_code, actual_qty, scrap_qty, sku:sku_products(code)")
        .eq("session_id", sessionId)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Re-seed when the rows change, but never overwrite what someone is typing.
  useEffect(() => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const it of items) {
        if (next[it.id] === undefined) next[it.id] = it.scrap_qty == null ? "" : String(it.scrap_qty);
      }
      return next;
    });
  }, [items]);

  const save = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number | null }) => {
      const { error } = await db.from("production_items").update({ scrap_qty: value }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift-scrap", sessionId] }),
    onError: (e) => toast.error((e as Error).message || "Could not save the scrap figure"),
  });

  const totals = useMemo(() => {
    const produced = items.reduce((s, i) => s + Number(i.actual_qty ?? 0), 0);
    const recorded = items.filter((i) => i.scrap_qty != null);
    const scrap = recorded.reduce((s, i) => s + Number(i.scrap_qty ?? 0), 0);
    return {
      produced,
      scrap,
      recorded: recorded.length,
      // Of what was produced, not of the whole shift: a percentage against a
      // denominator that includes unrecorded items would read lower than the truth.
      pct: produced > 0 ? (scrap / produced) * 100 : null,
    };
  }, [items]);

  if (!sessionId || items.length === 0) return null;

  const commit = (id: string) => {
    const raw = (draft[id] ?? "").trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      toast.error("Scrap has to be a number, and cannot be negative");
      return;
    }
    const current = items.find((i) => i.id === id)?.scrap_qty ?? null;
    if (value === current) return;
    setSavingId(id);
    save.mutate({ id, value }, { onSettled: () => setSavingId(null) });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trash2 className="h-4 w-4 text-muted-foreground" /> Scrap this shift
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {totals.recorded} of {items.length} recorded
            {totals.pct !== null && totals.recorded > 0 && (
              <> · <b className={cn(totals.pct > 2 && "text-destructive-strong")}>{totals.pct.toFixed(1)}%</b> of what was produced</>
            )}
          </span>
        </div>
        <CardDescription>
          What was made and thrown away. Leave it blank if nobody has counted yet — blank means not
          recorded, not zero.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {items.map((it) => {
          const label = it.sku?.code || it.sku_code_text || "—";
          const dirty = (draft[it.id] ?? "") !== (it.scrap_qty == null ? "" : String(it.scrap_qty));
          return (
            <div key={it.id} className="flex items-center gap-2 rounded border p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{label}</div>
                <div className="truncate text-2xs text-muted-foreground">
                  {it.batch_code ? `Batch ${it.batch_code} · ` : ""}
                  {Number(it.actual_qty ?? 0).toLocaleString()} produced
                </div>
              </div>
              <Input
                inputMode="numeric"
                placeholder="—"
                disabled={locked}
                value={draft[it.id] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [it.id]: e.target.value.replace(/[^\d]/g, "") }))}
                onBlur={() => commit(it.id)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="h-11 w-24 text-right tabular-nums"
                aria-label={`Scrap for ${label}`}
              />
              <span className="w-5 shrink-0 text-muted-foreground">
                {savingId === it.id ? <Loader2 className="h-4 w-4 animate-spin" />
                  : dirty ? null
                  : it.scrap_qty != null ? <Check className="h-4 w-4 text-success-strong" /> : null}
              </span>
            </div>
          );
        })}
        {locked && (
          <p className="pt-1 text-2xs text-muted-foreground">
            This shift is locked. Scrap can no longer be changed here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default ShiftScrapCard;
