import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calculator, Zap, Clock } from "lucide-react";

const SHIFT_MIN = 660; // available production minutes per shift

type SkuRow = { id: string; code: string; name: string; target_per_hour: number | null };

type Estimate = {
  line: string;
  upm: number; // units per minute (effective, blended actual/standard)
  source: "actual" | "standard";
  runs: number;
  minutes: number;
  shifts: number;
  remainderMin: number; // unused minutes in last shift
};

function fmtDuration(min: number) {
  if (!isFinite(min) || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ProductionForecastPage() {
  const [search, setSearch] = useState("");
  const [skuId, setSkuId] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [line, setLine] = useState<string>("any");
  const [calculated, setCalculated] = useState<{ sku: SkuRow; qty: number; line: string } | null>(null);

  const { data: skus = [] } = useQuery({
    queryKey: ["forecast-skus"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sku_products")
        .select("id, code, name, target_per_hour")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as SkuRow[];
    },
  });

  // Lines list (independent from estimates so dropdown is populated up-front)
  const { data: allLines = [] } = useQuery({
    queryKey: ["forecast-lines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lines")
        .select("name")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((l: any) => l.name as string);
    },
  });

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return skus
      .filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
      .slice(0, 8);
  }, [skus, search]);

  const { data: estimates, isFetching, refetch } = useQuery({
    queryKey: ["forecast", calculated?.sku.id, calculated?.qty, calculated?.line],
    enabled: !!calculated,
    queryFn: async (): Promise<Estimate[]> => {
      if (!calculated) return [];
      const { sku, qty, line: pickedLine } = calculated;
      const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

      // target_per_hour is units/hour → convert to units/minute
      const stdUpm = Number(sku.target_per_hour ?? 0) / 60;

      // Pull historical runs for this SKU in last 90 days
      const { data: sessions } = await supabase
        .from("production_sessions")
        .select("id, line, session_date")
        .gte("session_date", since);
      const sessionMap = new Map((sessions ?? []).map((s) => [s.id, s]));
      const ids = Array.from(sessionMap.keys());

      const perLine = new Map<string, { actual: number; target: number; runs: number }>();
      if (ids.length) {
        const { data: items } = await supabase
          .from("production_items")
          .select("session_id, sku_id, target_qty, planned_qty, actual_qty")
          .eq("sku_id", sku.id)
          .in("session_id", ids);
        for (const it of items ?? []) {
          const s = sessionMap.get(it.session_id);
          if (!s) continue;
          const target = Number(it.target_qty ?? it.planned_qty ?? 0);
          const actual = Number(it.actual_qty ?? 0);
          if (target <= 0 && actual <= 0) continue;
          const prev = perLine.get(s.line) ?? { actual: 0, target: 0, runs: 0 };
          prev.actual += actual;
          prev.target += target;
          prev.runs += 1;
          perLine.set(s.line, prev);
        }
      }

      // Decide which lines to forecast for
      const candidateLines = pickedLine === "any"
        ? Array.from(new Set([...allLines, ...perLine.keys()]))
        : [pickedLine];

      const rows: Estimate[] = [];
      for (const ln of candidateLines) {
        const agg = perLine.get(ln);
        // Actual UPM = units produced ÷ minutes worked.
        // We don't store per-item duration, so approximate using SHIFT_MIN per run
        // (each production_items row maps to one shift session).
        const actualUpm = agg && agg.runs > 0 && agg.actual > 0
          ? agg.actual / (agg.runs * SHIFT_MIN)
          : 0;
        const useActual = !!agg && agg.runs >= 2 && actualUpm > 0;
        const upm = useActual ? actualUpm : stdUpm;
        if (!upm || !isFinite(upm) || upm <= 0) continue;
        const minutes = qty / upm;
        const shifts = Math.ceil(minutes / SHIFT_MIN);
        const remainderMin = shifts * SHIFT_MIN - minutes;
        rows.push({
          line: ln,
          upm,
          source: useActual ? "actual" : "standard",
          runs: agg?.runs ?? 0,
          minutes,
          shifts,
          remainderMin,
        });
      }

      rows.sort((a, b) => a.minutes - b.minutes);
      return rows;
    },
  });

  const fastest = estimates && estimates.length ? estimates[0] : null;

  const onCalc = () => {
    const sku = skus.find((s) => s.id === skuId);
    const n = Number(qty.replace(/[,\s]/g, ""));
    if (!sku || !n || n <= 0) return;
    setCalculated({ sku, qty: n, line });
    setTimeout(() => refetch(), 0);
  };

  const lineOptions = allLines;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Production Forecast</h1>
          <p className="text-sm text-muted-foreground">Estimate how long a production run will take based on historical UPM and Time & Motion standards.</p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Calculator className="h-4 w-4" /> Inputs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="md:col-span-2 relative">
              <Label className="mb-1 block">Product</Label>
              <Input
                placeholder="Type product name or code…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSkuId(""); }}
              />
              {!skuId && suggestions.length > 0 && (
                <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                      onClick={() => { setSkuId(s.id); setSearch(`${s.code} — ${s.name}`); }}
                    >
                      <div className="font-medium">{s.code} — {s.name}</div>
                      <div className="text-xs text-muted-foreground">UPM std: {s.target_per_hour ?? "—"}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="mb-1 block">Quantity</Label>
              <Input
                inputMode="numeric"
                placeholder="e.g. 5000"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^0-9,]/g, ""))}
              />
            </div>
            <div>
              <Label className="mb-1 block">Line (optional)</Label>
              <Select value={line} onValueChange={setLine}>
                <SelectTrigger><SelectValue placeholder="Any line" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any line</SelectItem>
                  {lineOptions.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-4">
              <Button onClick={onCalc} disabled={!skuId || !qty}>
                <Calculator className="h-4 w-4 mr-2" /> Calculate forecast
              </Button>
            </div>
          </CardContent>
        </Card>

        {calculated && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Estimate for {calculated.qty.toLocaleString()} × {calculated.sku.code} — {calculated.sku.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isFetching && <p className="text-sm text-muted-foreground">Calculating…</p>}
              {!isFetching && (!estimates || estimates.length === 0) && (
                <p className="text-sm text-muted-foreground">
                  No historical runs and no UPM standard for this SKU. Set a standard in SKU Products to enable forecasting.
                </p>
              )}
              {!isFetching && estimates && estimates.map((e) => (
                <div key={e.line} className="rounded-md border p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium flex items-center gap-2">
                      {e.line}
                      {fastest && e.line === fastest.line && (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600 gap-1"><Zap className="h-3 w-3" /> Fastest</Badge>
                      )}
                      <Badge variant="outline" className="capitalize">{e.source}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-muted-foreground">UPM: <span className="font-mono">{e.upm.toFixed(2)}</span></span>
                      <span className="text-muted-foreground">Runs: {e.runs}</span>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3 text-sm">
                    <div className="rounded bg-muted/40 p-2">
                      <div className="text-xs text-muted-foreground">Total time</div>
                      <div className="font-semibold flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDuration(e.minutes)}</div>
                    </div>
                    <div className="rounded bg-muted/40 p-2">
                      <div className="text-xs text-muted-foreground">Shifts needed</div>
                      <div className="font-semibold">{e.shifts} × {SHIFT_MIN}m</div>
                    </div>
                    <div className="rounded bg-muted/40 p-2">
                      <div className="text-xs text-muted-foreground">{e.shifts === 1 ? "Free time in shift" : "Last shift slack"}</div>
                      <div className="font-semibold">{fmtDuration(e.remainderMin)}</div>
                    </div>
                  </div>
                  {e.shifts > 1 && (
                    <div className="text-xs text-muted-foreground">
                      Plan:{" "}
                      {Array.from({ length: e.shifts }).map((_, i) => {
                        const isLast = i === e.shifts - 1;
                        const units = isLast
                          ? calculated.qty - Math.round(e.upm * SHIFT_MIN) * (e.shifts - 1)
                          : Math.round(e.upm * SHIFT_MIN);
                        return (
                          <span key={i} className="mr-2">
                            Shift {i + 1}: <span className="font-mono">{Math.max(0, units).toLocaleString()}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
