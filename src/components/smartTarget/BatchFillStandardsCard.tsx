import { useMemo, useState } from "react";
import { ChevronRight, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBatchFillStandards } from "@/hooks/useBatchFillStandards";
import { useSkuFillTimes, useRegisterSkuFillTime, useApproveSkuFillTime } from "@/hooks/useSkuFillTimes";
import { useItouchCycles } from "@/hooks/useItouchCycles";
import { approvedLookup, fillKey, machineKey } from "@/lib/approvedFillTimes";
import { type BatchStandard, MIN_BATCHES } from "@/lib/batchFillStandards";

const fmt = (v: number | null | undefined) => v == null ? "—" : v.toFixed(3);

export function BatchFillStandardsCard() {
  const [days, setDays] = useState(90);
  const [machine, setMachine] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BatchStandard | null>(null);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const history = useBatchFillStandards(days);
  const register = useSkuFillTimes();
  const cycles = useItouchCycles();
  const add = useRegisterSkuFillTime();
  const update = useApproveSkuFillTime();
  const busy = add.isPending || update.isPending;
  const approved = useMemo(() => approvedLookup(register.data), [register.data]);
  const itouch = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cycles.data?.records ?? []) {
      if (c.cycleSeconds != null && c.cycleSeconds > 0 && c.cavities != null && c.cavities > 0) m.set(fillKey(c.line, c.sku), c.cycleSeconds / c.cavities);
    }
    return m;
  }, [cycles.data]);
  const machines = [...new Set((history.data?.standards ?? []).map((r) => r.line))];
  const rows = (history.data?.standards ?? []).filter((r) => (machine === "all" || machineKey(r.line) === machineKey(machine)) && `${r.sku} ${r.name ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const approve = async () => {
    if (!selected?.ready || !selected.standardSeconds || !verified || history.data?.truncated || !register.data) return;
    setError(null);
    try {
      const existing = register.data.find((r) => fillKey(r.machine_name, r.sku_code) === selected.key);
      // The measured result is seconds per unit: never divide it again by cavities.
      const seconds = Number(selected.standardSeconds.toFixed(6));
      if (existing) await update.mutateAsync({ id: existing.id, approved_seconds: seconds, time_basis: "per_unit", units_per_cycle: null });
      else await add.mutateAsync({ machine_name: selected.line, sku_code: selected.sku, product_description: selected.name ?? selected.sku, approved_seconds: seconds, time_basis: "per_unit", units_per_cycle: null });
      setSaved(`${selected.line} · ${selected.sku} — ${fmt(seconds)} s/unit approved`);
      setSelected(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the approved standard."); }
  };
  return (
    <section className="space-y-4 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Production-based standards</h2><p className="text-sm text-muted-foreground">Completed batches · median running seconds per unit</p></div>
        <Button variant="outline" size="icon" aria-label="Refresh batch history" disabled={history.isFetching} onClick={() => void history.refetch()}><RefreshCw className="h-4 w-4" /></Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search production standards" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SKU or product…" autoComplete="off" className="h-12 max-w-xs" />
        <select aria-label="Production standards machine" className="h-12 rounded-md border bg-background px-3" value={machine} onChange={(e) => setMachine(e.target.value)}><option value="all">All machines</option>{machines.map((m) => <option key={m}>{m}</option>)}</select>
        {[30, 90, 180].map((d) => <Button key={d} variant={days === d ? "default" : "outline"} className="h-12" onClick={() => setDays(d)}>{d} days</Button>)}
      </div>
      {saved && <p role="status" className="text-sm text-primary">{saved}</p>}
      {history.error ? <p role="alert" className="text-sm text-destructive">Could not load batch history. <Button variant="link" onClick={() => void history.refetch()}>Retry</Button></p>
        : history.isPending ? <p className="text-sm text-muted-foreground">Loading batch history…</p>
        : <>
          <p className="text-xs text-muted-foreground">{history.data?.batches ?? 0} production records · {history.data?.excluded ?? 0} excluded (missing or overlapping batch times, unlocated stops, or runs under 5 minutes). At least {MIN_BATCHES} usable batches required for approval. No shift-hour estimates.</p>
          {history.data?.truncated && <p role="alert" className="text-sm text-destructive">History is incomplete for this period. Approval is disabled; choose a shorter period.</p>}
          <div className="max-h-[520px] overflow-auto rounded-md border">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground"><tr><th className="p-3 text-left">Line / SKU</th><th className="p-3 text-right">Batches used</th><th className="p-3 text-right">iTouch s/unit</th><th className="p-3 text-right">Approved s/unit</th><th className="p-3 text-right">Production s/unit</th><th className="p-3 text-right">Units/h</th><th className="p-3 text-right">Review</th></tr></thead>
              <tbody>{rows.map((r) => { const a = approved.get(r.key); return <tr key={r.key} className="border-t"><td className="p-3"><div className="text-xs text-muted-foreground">{r.line}</div><div className="font-semibold">{r.sku}</div><div className="max-w-64 truncate text-xs text-muted-foreground" title={r.name ?? ""}>{r.name}</div></td><td className="p-3 text-right tabular-nums">{r.used}<div className="text-xs text-muted-foreground">{r.samples.filter((s) => s.outlier).length} outliers</div></td><td className="p-3 text-right tabular-nums">{fmt(itouch.get(r.key))}</td><td className="p-3 text-right tabular-nums">{fmt(a ? a.seconds / a.unitsPerCycle : null)}</td><td className="p-3 text-right font-semibold tabular-nums">{fmt(r.standardSeconds)}</td><td className="p-3 text-right tabular-nums">{r.unitsPerHour?.toFixed(0) ?? "—"}</td><td className="p-3 text-right"><Button variant="outline" onClick={() => { setSelected(r); setVerified(false); setError(null); }}>Review<ChevronRight className="ml-1 h-4 w-4" /></Button></td></tr>; })}
              {!rows.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No usable completed batches in this period.</td></tr>}</tbody>
            </table>
          </div>
        </>}
      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open && !busy) setSelected(null); }}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{selected?.line} · {selected?.sku}</DialogTitle></DialogHeader>
          <p className="text-sm">Production median: <strong>{fmt(selected?.standardSeconds)} s/unit</strong> · {selected?.used} usable batches</p>
          <div className="max-h-72 overflow-auto rounded-md border"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-2 text-left">Date / batch</th><th className="p-2 text-right">Units</th><th className="p-2 text-right">Run min</th><th className="p-2 text-right">s/unit</th></tr></thead><tbody>{selected?.samples.map((s, i) => <tr key={i} className="border-t"><td className="p-2">{s.date}<div className="text-xs text-muted-foreground">{s.batch ?? "No batch reference"}{s.outlier ? " · Outlier excluded" : ""}</div></td><td className="p-2 text-right">{s.quantity}</td><td className="p-2 text-right">{s.runMinutes}</td><td className="p-2 text-right">{fmt(s.secondsPerUnit)}</td></tr>)}</tbody></table></div>
          {!selected?.ready && <p className="text-sm text-muted-foreground">Not enough batches to approve a production-based standard.</p>}
          {register.data === null && <p role="alert" className="text-sm text-destructive">The SKU register is not active. Approval is unavailable.</p>}
          {register.error && <p role="alert" className="text-sm text-destructive">Could not load the approved standards.</p>}
          <label className="flex items-start gap-3 text-sm"><Checkbox checked={verified} disabled={busy} onCheckedChange={(v) => setVerified(v === true)} /><span>Batch start/end times and downtime are verified. This will replace the approved standard for this SKU on this machine.</span></label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button><Button disabled={busy || !verified || !selected?.ready || !register.data || history.data?.truncated} onClick={approve}><Check className="mr-2 h-4 w-4" />{busy ? "Saving…" : "Approve production standard"}</Button></div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
