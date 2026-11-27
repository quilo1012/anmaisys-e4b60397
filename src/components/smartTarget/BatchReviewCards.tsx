import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useShiftHours } from "@/hooks/useShiftHours";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBatchFillStandards } from "@/hooks/useBatchFillStandards";
import { useItouchCycles } from "@/hooks/useItouchCycles";
import { useSkuFillTimes } from "@/hooks/useSkuFillTimes";
import { approvedLookup, fillKey } from "@/lib/approvedFillTimes";
import { DEFAULT_SHIFT_HOURS, type ShiftHours, deviationPct, reviewBatches, shiftStandards } from "@/lib/batchReview";
import { cn } from "@/lib/utils";

const fmt = (n: number | null | undefined, d = 2) => (n == null ? "—" : n.toFixed(d));
const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const norm = (s: string) => s.toLowerCase();

function Dev({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  return <span className={cn("tabular-nums font-medium", pct > 10 ? "text-destructive" : pct < -10 ? "text-warning" : "text-success")}>{pct > 0 ? "+" : ""}{pct}%</span>;
}

const hh = (n: number) => `${String(n).padStart(2, "0")}:00`;
/** Read-only summary of the factory shift hours, set on the Shift hours page. */
export function ShiftHoursNote() {
  const { hours } = useShiftHours();
  return <p className="text-sm text-muted-foreground">Day shift {hh(hours.dayStart)}–{hh(hours.dayEnd)} (London time), Night is the rest. Change it on <Link className="underline" to="/dashboard/shift-hours">Shift hours</Link>.</p>;
}

function useData(days: number) {
  const { hours } = useShiftHours();
  const { data, isLoading, error } = useBatchFillStandards(days);
  const { data: cycles } = useItouchCycles();
  const { data: sku } = useSkuFillTimes();
  const rows = useMemo(() => reviewBatches(data?.runs ?? [], data?.windows ?? [], hours), [data, hours]);
  const itouch = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ((cycles as { records?: { line: string; sku: string; cycleSeconds: number | null }[] } | undefined)?.records ?? [])) if (r.cycleSeconds != null) m.set(fillKey(r.line, r.sku), r.cycleSeconds);
    return m;
  }, [cycles]);
  const approved = useMemo(() => approvedLookup(sku), [sku]);
  const standard = useMemo(() => new Map((data?.standards ?? []).map((s) => [s.key, s])), [data]);
  return { rows, itouch, approved, standard, isLoading, error, truncated: data?.truncated };
}

function Filters({ lines, line, setLine, q, setQ, days, setDays }: { lines: string[]; line: string; setLine: (v: string) => void; q: string; setQ: (v: string) => void; days: number; setDays: (v: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select value={line} onValueChange={setLine}>
        <SelectTrigger className="h-12 w-48"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">All lines</SelectItem>{lines.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
        <SelectTrigger className="h-12 w-36"><SelectValue /></SelectTrigger>
        <SelectContent>{[30, 90, 180].map((d) => <SelectItem key={d} value={String(d)}>Last {d} days</SelectItem>)}</SelectContent>
      </Select>
      <Input className="h-12 w-56" placeholder="Search SKU" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
    </div>
  );
}

/** Every batch per line with times, stops and real run time, for review before approving. */
export function BatchReviewCard() {
  const [days, setDays] = useState(90); const [line, setLine] = useState("all"); const [q, setQ] = useState("");
  const { rows, itouch, standard, isLoading, error, truncated } = useData(days);
  const lines = useMemo(() => [...new Set(rows.map((r) => r.run.line))].filter(Boolean).sort(), [rows]);
  const list = rows.filter((r) => (line === "all" || r.run.line === line) && (!q || norm(`${r.run.sku} ${r.run.name ?? ""}`).includes(norm(q)))).slice(0, 200);
  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>Batches per line</CardTitle>
        <p className="text-sm text-muted-foreground">Each completed batch with its start, finish, stops inside it and real run time. Review these before approving a standard. Deviation compares the batch with the iTouch time.</p>
        <Filters {...{ lines, line, setLine, q, setQ, days, setDays }} />
        <ShiftHoursNote />
      </CardHeader>
      <CardContent>
        {error ? <p className="text-destructive">Could not load batches.</p> : isLoading ? <p className="text-muted-foreground">Loading batches…</p> : (
          <div className="max-h-[640px] overflow-auto">
            {truncated && <p className="mb-2 text-sm text-warning">Too many batches to load in full — choose a shorter period.</p>}
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground"><tr>
                <th className="p-2 text-left">Line / SKU</th><th className="p-2 text-left">Batch</th><th className="p-2 text-left">Shift</th><th className="p-2 text-left">Start → finish</th>
                <th className="p-2 text-right">Units</th><th className="p-2 text-right">Total min</th><th className="p-2 text-right">Stops min</th><th className="p-2 text-right">Run min</th>
                <th className="p-2 text-right">Real s/unit</th><th className="p-2 text-right">Batch std</th><th className="p-2 text-right">iTouch</th><th className="p-2 text-right">vs iTouch</th>
              </tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={12} className="p-4 text-center text-muted-foreground">No completed batches with start and finish times.</td></tr>}
                {list.map((r, i) => { const k = fillKey(r.run.line, r.run.sku); const it = itouch.get(k); return (
                  <tr key={i} className="border-t">
                    <td className="p-2"><div className="font-medium">{r.run.line} · {r.run.sku}</div><div className="text-xs text-muted-foreground">{r.run.name}</div></td>
                    <td className="p-2">{r.run.batch ?? "—"}</td>
                    <td className="p-2"><Badge variant="outline" className={r.shift === "Day" ? "border-sky-500 text-sky-500" : "border-indigo-500 text-indigo-400"}>{r.shift}</Badge></td>
                    <td className="whitespace-nowrap p-2">{time(r.run.startedAt)} → {time(r.run.finishedAt)}</td>
                    <td className="p-2 text-right tabular-nums">{r.run.quantity}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(r.totalMinutes, 0)}</td>
                    <td className="p-2 text-right tabular-nums">{r.stopMinutes == null ? <span className="text-warning" title="A stop has no usable times">?</span> : fmt(r.stopMinutes, 0)}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(r.runMinutes, 0)}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(r.secondsPerUnit)}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(standard.get(k)?.standardSeconds)}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(it)}</td>
                    <td className="p-2 text-right"><Dev pct={deviationPct(it, r.secondsPerUnit)} /></td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Per line, SKU and shift: real median from batches against the iTouch and approved times. */
export function ShiftStandardsCard({ title = "Standards by shift" }: { title?: string }) {
  const [days, setDays] = useState(90); const [line, setLine] = useState("all"); const [q, setQ] = useState("");
  const { rows, itouch, approved, standard, isLoading, error } = useData(days);
  const all = useMemo(() => shiftStandards(rows), [rows]);
  const lines = useMemo(() => [...new Set(all.map((r) => r.line))].sort(), [all]);
  const list = all.filter((r) => (line === "all" || r.line === line) && (!q || norm(`${r.sku} ${r.name ?? ""}`).includes(norm(q))));
  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">Real seconds per unit from completed batches (stops removed), split by Day and Night shift, with the deviation from the iTouch time. Red = more than 10% slower.</p>
        <Filters {...{ lines, line, setLine, q, setQ, days, setDays }} />
        <ShiftHoursNote />
      </CardHeader>
      <CardContent>
        {error ? <p className="text-destructive">Could not load batches.</p> : isLoading ? <p className="text-muted-foreground">Loading batches…</p> : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground"><tr>
                <th className="p-2 text-left">Line / SKU</th><th className="p-2 text-left">Shift</th><th className="p-2 text-right">Batches</th><th className="p-2 text-right">Real s/unit</th>
                <th className="p-2 text-right">Overall std</th><th className="p-2 text-right">Approved</th><th className="p-2 text-right">iTouch</th><th className="p-2 text-right">vs iTouch</th>
              </tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No usable batches yet.</td></tr>}
                {list.map((r) => { const k = fillKey(r.line, r.sku); const it = itouch.get(k); return (
                  <tr key={r.key} className="border-t">
                    <td className="p-2"><div className="font-medium">{r.line} · {r.sku}</div><div className="text-xs text-muted-foreground">{r.name}</div></td>
                    <td className="p-2">{r.shift}</td>
                    <td className="p-2 text-right tabular-nums">{r.batches}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(r.medianSeconds)}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(standard.get(k)?.standardSeconds)}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(approved.get(k)?.seconds)}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(it)}</td>
                    <td className="p-2 text-right"><Dev pct={deviationPct(it, r.medianSeconds)} /></td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
