import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useItouchCycles } from "@/hooks/useItouchCycles";
import { useApproveSkuFillTime, useSkuFillTimes, type SkuFillTime, type TimeBasis } from "@/hooks/useSkuFillTimes";
import { parseFillTime } from "@/lib/fillSpeedMatrixEditor";
import { bayInk } from "@/lib/lineBay";
import { cn } from "@/lib/utils";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const fmt = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(2)} s`);

function ApproveRow({ row, itouch }: { row: SkuFillTime; itouch: number | null }) {
  const approve = useApproveSkuFillTime();
  const [secs, setSecs] = useState(row.approved_seconds == null ? "" : String(row.approved_seconds));
  const [basis, setBasis] = useState<TimeBasis>(row.time_basis === "unconfirmed" ? "per_cycle" : row.time_basis);
  const [units, setUnits] = useState(row.units_per_cycle == null ? "" : String(row.units_per_cycle));
  const [err, setErr] = useState<string | null>(null);
  const s = parseFillTime(secs); const u = units ? Number(units) : null;
  const valid = s !== null && (basis === "per_unit" || (u !== null && Number.isInteger(u) && u > 0));
  const save = async () => {
    setErr(null);
    try { await approve.mutateAsync({ id: row.id, approved_seconds: s, time_basis: basis, units_per_cycle: basis === "per_cycle" ? u : null }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save"); }
  };
  return (
    <tr className="border-t align-middle">
      <td className="p-2"><div className="font-medium">{row.sku_code}</div><div className="max-w-[260px] truncate text-xs text-muted-foreground" title={row.product_description}>{row.product_description}</div></td>
      <td className="p-2 text-right tabular-nums">{fmt(itouch)}</td>
      <td className="p-2 text-right tabular-nums">{fmt(row.suggested_seconds)}</td>
      <td className="p-2 text-right tabular-nums text-muted-foreground">{fmt(row.median_seconds)}<div className="text-[11px]">{row.sample_shifts ?? 0} shifts</div></td>
      <td className="p-2">
        <div className="flex items-center justify-end gap-2">
          <Input value={secs} onChange={(e) => setSecs(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="s" aria-label={`${row.sku_code} approved seconds`} className="h-9 w-20 text-right font-semibold" />
          <select value={basis} onChange={(e) => setBasis(e.target.value as TimeBasis)} aria-label={`${row.sku_code} basis`} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="per_cycle">per cycle</option><option value="per_unit">per unit</option>
          </select>
          {basis === "per_cycle" && <Input value={units} onChange={(e) => setUnits(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="units" aria-label={`${row.sku_code} units per cycle`} className="h-9 w-16 text-right" />}
          <Button size="sm" disabled={!valid || approve.isPending} onClick={save}>{row.approved_seconds == null ? "Approve" : "Update"}</Button>
        </div>
        {err && <p role="alert" className="mt-1 text-right text-xs text-destructive">{err}</p>}
      </td>
    </tr>
  );
}

/** Per-SKU fill time register: iTouch next to the suggested and approved standard. */
export function SkuFillTimesCard() {
  const { data, isLoading, error } = useSkuFillTimes();
  const { data: cycles } = useItouchCycles();
  const [machine, setMachine] = useState("all");
  const [q, setQ] = useState("");
  const itouchOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ((cycles as { records?: { line: string; sku: string; cycleSeconds: number | null }[] } | undefined)?.records ?? [])) if (r.cycleSeconds != null) m.set(`${norm(r.line)}|${norm(r.sku)}`, r.cycleSeconds);
    return (row: SkuFillTime) => m.get(`${norm(row.machine_name)}|${norm(row.sku_code)}`) ?? null;
  }, [cycles]);
  const machines = useMemo<string[]>(() => [...new Set<string>((data ?? []).map((r) => r.machine_name))], [data]);
  const rows = (data ?? []).filter((r) => (machine === "all" || r.machine_name === machine) && (!q || norm(`${r.sku_code} ${r.product_description}`).includes(norm(q))));
  const approved = (data ?? []).filter((r) => r.approved_seconds != null).length;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Fill time per SKU</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">iTouch, suggested and approved fill time for every machine and SKU. Approved values are shared with everyone.</p>
          </div>
          {data && <div className="flex gap-2"><Badge variant="outline">{data.length} SKUs</Badge><Badge variant="outline" className="border-primary text-primary">{approved} approved</Badge></div>}
        </div>
        {data && (
          <div className="flex flex-wrap gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU or product…" autoComplete="off" className="h-12 max-w-xs" />
            {["all", ...machines].map((m) => (
              <button key={m} type="button" onClick={() => setMachine(m)} className={cn("inline-flex h-12 items-center gap-2 rounded-lg border px-4 text-sm font-medium", machine === m ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
                {m !== "all" && <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: bayInk(m) }} aria-hidden />}{m === "all" ? "All" : m}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : error ? <p role="alert" className="text-sm text-destructive">Could not load the SKU register.</p>
          : data === null ? <p className="text-sm text-muted-foreground">The SKU register is not active in this database yet.</p>
          : (
            <div className="max-h-[560px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="p-2 text-left">SKU</th><th className="p-2 text-right">iTouch</th><th className="p-2 text-right">Suggested</th><th className="p-2 text-right">Median</th><th className="p-2 text-right">Approved</th></tr>
                </thead>
                <tbody>
                  {machines.filter((m) => machine === "all" || m === machine).map((m) => {
                    const list = rows.filter((r) => r.machine_name === m);
                    if (!list.length) return null;
                    return [
                      <tr key={m}><td colSpan={5} className="p-2 font-semibold" style={{ borderTop: `3px solid ${bayInk(m)}` }}>{m} <span className="text-xs font-normal text-muted-foreground">· {list.length}</span></td></tr>,
                      ...list.map((r) => <ApproveRow key={r.id} row={r} itouch={itouchOf(r)} />),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
