import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TIME_MOTION, TIME_MOTION_SOURCE, OTHER_MACHINES } from "@/lib/timeMotionMatrix";
import { packSizeKg } from "@/lib/packSize";
import { bayInk, bayWash } from "@/lib/lineBay";
import { cn } from "@/lib/utils";

const LINES = Object.keys(TIME_MOTION).map(Number);
const kgLabel = (kg: number) => (kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg} kg`);

/** Recommended fill speeds per line and pack size, as on the Time & Motion review sheet. Type a product or size to find its row. */
export function TimeMotionMatrixCard() {
  const [line, setLine] = useState<number | string>("all");
  const [query, setQuery] = useState("");
  const kg = packSizeKg(query) ?? (Number(query.replace(",", ".")) > 0 ? Number(query.replace(",", ".")) : null);
  const lines = line === "all" ? LINES : typeof line === "number" ? [line] : [];
  const machines = line === "all" ? OTHER_MACHINES : OTHER_MACHINES.filter((m) => m.name === line);
  const max = useMemo(() => Math.max(...LINES.flatMap((l) => TIME_MOTION[l].map((r) => r[1]))), []);

  return (
    <Card data-testid="time-motion-matrix">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>Fill speed matrix</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Recommended speed per line and pack size, from the {TIME_MOTION_SOURCE}. Type a product name (e.g. "A.B.E 375G") or a size in kg to find it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Product or pack size…" className="h-12 max-w-sm" autoComplete="off" />
          {(["all", ...LINES, ...OTHER_MACHINES.map((m) => m.name)] as (number | string)[]).map((l) => (
            <button key={l} type="button" onClick={() => setLine(l)}
              className={cn("inline-flex h-12 items-center gap-2 rounded-lg border px-4 text-sm font-medium", line === l ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
              {l !== "all" && <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: bayInk(typeof l === "number" ? `Line ${l}` : l) }} aria-hidden />}
              {l === "all" ? "All" : typeof l === "number" ? `Line ${l}` : l}
            </button>
          ))}
        </div>
        {query && (
          <p className="text-sm">
            {kg === null ? <span className="text-muted-foreground">No pack size found in "{query}".</span>
              : <>Pack size <b>{kgLabel(kg)}</b>: {lines.map((l) => {
                  const r = TIME_MOTION[l].find((x) => Math.abs(x[0] - kg) < 0.0005);
                  return <Badge key={l} variant="outline" className={cn("ml-2", r ? "border-primary" : "opacity-60")}>Line {l}: {r ? `${r[2].toFixed(2)} s · ${Math.round(r[1])}/h` : "not on sheet"}</Badge>;
                })}</>}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className={cn("grid gap-4", lines.length > 1 ? "md:grid-cols-2 xl:grid-cols-3" : "")}>
          {lines.map((l) => (
            <div key={l} className="overflow-hidden rounded-lg border" style={{ borderTop: `4px solid ${bayInk(`Line ${l}`)}` }}>
              <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor: bayWash(`Line ${l}`) }}>
                <span className="flex items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: bayInk(`Line ${l}`) }} aria-hidden />Line {l}</span>
                <span className="text-xs text-muted-foreground">{TIME_MOTION[l].length} sizes</span>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                    <tr><th className="p-2 text-left">Pack</th><th className="p-2 text-left">Tubs/h</th><th className="p-2 text-right">UPM</th><th className="p-2 text-right">Fill time</th></tr>
                  </thead>
                  <tbody>
                    {TIME_MOTION[l].map(([p, tph, s, basis]) => {
                      const hit = kg !== null && Math.abs(p - kg) < 0.0005;
                      return (
                        <tr key={p} title={basis || undefined} className={cn("border-t", hit && "bg-primary/15 font-semibold")}>
                          <td className="whitespace-nowrap p-2">{kgLabel(p)}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 rounded bg-muted"><div className="h-2 rounded" style={{ width: `${(tph / max) * 100}%`, backgroundColor: bayInk(`Line ${l}`) }} /></div>
                              <span className="w-12 text-right tabular-nums">{Math.round(tph)}</span>
                            </div>
                          </td>
                          <td className="p-2 text-right tabular-nums">{(tph / 60).toFixed(1)}</td>
                          <td className="p-2 text-right font-semibold tabular-nums">{s.toFixed(2)} s</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
        {machines.length > 0 && (
          <div className={cn("grid gap-4 md:grid-cols-2", lines.length > 0 && "mt-6")}>
            {machines.map((m) => (
              <div key={m.name} className="overflow-hidden rounded-lg border" style={{ borderTop: `4px solid ${bayInk(m.name)}` }}>
                <div className="flex items-center gap-2 px-3 py-2 font-semibold" style={{ backgroundColor: bayWash(m.name) }}><span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: bayInk(m.name) }} aria-hidden />{m.name}</div>
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                    <tr><th className="p-2 text-left">Pack</th><th className="p-2 text-right">Per hour</th><th className="p-2 text-right">Fill time</th></tr>
                  </thead>
                  <tbody>
                    {m.rows.map((r) => (
                      <tr key={r.pack} className="border-t align-top">
                        <td className="p-2"><div className="font-medium">{r.pack}</div>{r.product && <div className="text-xs text-muted-foreground">{r.product}</div>}{r.note && <div className="text-xs text-warning">{r.note}</div>}</td>
                        <td className="p-2 text-right tabular-nums">{r.perHour.toLocaleString("en-GB")} {r.unit}</td>
                        <td className="p-2 text-right font-semibold tabular-nums">{r.seconds.toFixed(2)} s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
