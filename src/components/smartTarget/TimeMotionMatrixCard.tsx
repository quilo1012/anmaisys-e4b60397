import { useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TIME_MOTION, TIME_MOTION_SOURCE, OTHER_MACHINES } from "@/lib/timeMotionMatrix";
import { packSizeKg } from "@/lib/packSize";
import { bayInk, bayWash } from "@/lib/lineBay";
import {
  fillSpeedMetrics,
  lineFillTimeKey,
  machineFillTimeKey,
  parseFillTime,
  readFillTimeOverrides,
  writeFillTimeOverrides,
} from "@/lib/fillSpeedMatrixEditor";
import { cn } from "@/lib/utils";

const LINES = Object.keys(TIME_MOTION).map(Number);
const kgLabel = (kg: number) => (kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg} kg`);
const wholeNumber = (value: number) => Math.round(value).toLocaleString("en-GB");

/** Recommended fill speeds with locally saved fill-time corrections. */
export function TimeMotionMatrixCard() {
  const [line, setLine] = useState<number | string>("all");
  const [query, setQuery] = useState("");
  const [overrides, setOverrides] = useState<Record<string, number>>(() => readFillTimeOverrides());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState(false);
  const kg = packSizeKg(query) ?? (Number(query.replace(",", ".")) > 0 ? Number(query.replace(",", ".")) : null);
  const lines = line === "all" ? LINES : typeof line === "number" ? [line] : [];
  const machines = line === "all" ? OTHER_MACHINES : OTHER_MACHINES.filter((m) => m.name === line);
  const editedCount = Object.keys(overrides).length;

  useEffect(() => {
    try {
      writeFillTimeOverrides(overrides);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [overrides]);

  const secondsFor = (key: string, original: number) => {
    const draft = drafts[key];
    return (draft === undefined ? null : parseFillTime(draft)) ?? overrides[key] ?? original;
  };

  const changeFillTime = (key: string, original: number, value: string) => {
    setDrafts((current) => ({ ...current, [key]: value }));
    const seconds = parseFillTime(value);
    if (seconds === null) return;
    setOverrides((current) => {
      const next = { ...current };
      if (Math.abs(seconds - original) <= 0.000001) delete next[key];
      else next[key] = seconds;
      return next;
    });
  };

  const clearInvalidDraft = (key: string) => {
    if (drafts[key] === undefined || parseFillTime(drafts[key]) !== null) return;
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const resetCorrections = () => {
    if (!window.confirm("Reset all fill-time corrections to the reviewed sheet values?")) return;
    setOverrides({});
    setDrafts({});
  };

  const max = useMemo(() => Math.max(...LINES.flatMap((l) => TIME_MOTION[l].map(([pack, perHour, seconds]) => {
    const key = lineFillTimeKey(l, pack);
    return fillSpeedMetrics(secondsFor(key, seconds), seconds, perHour).perHour;
  }))), [drafts, overrides]);

  return (
    <Card data-testid="time-motion-matrix">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Fill speed matrix</CardTitle>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Recommended speed per line and pack size, from the {TIME_MOTION_SOURCE}. Edit any fill time in seconds; per-hour and per-minute rates update automatically. Corrections are saved in this browser.
            </p>
          </div>
          {editedCount > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-warning text-warning">{editedCount} {editedCount === 1 ? "correction" : "corrections"}</Badge>
              <Button type="button" variant="outline" size="sm" onClick={resetCorrections}>
                <RotateCcw className="mr-2 h-4 w-4" /> Reset corrections
              </Button>
            </div>
          )}
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
                  if (!r) return <Badge key={l} variant="outline" className="ml-2 opacity-60">Line {l}: not on sheet</Badge>;
                  const key = lineFillTimeKey(l, r[0]);
                  const seconds = secondsFor(key, r[2]);
                  const metrics = fillSpeedMetrics(seconds, r[2], r[1]);
                  return <Badge key={l} variant="outline" className={cn("ml-2", "border-primary")}>Line {l}: {seconds.toFixed(2)} s · {wholeNumber(metrics.perHour)}/h</Badge>;
                })}</>}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {saveError && <p role="alert" className="mb-4 text-sm text-destructive">This browser could not save your corrections. Keep this page open and allow browser storage before trying again.</p>}
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
                    <tr><th className="p-2 text-left">Pack</th><th className="p-2 text-left">Tubs/h</th><th className="p-2 text-right">UPM</th><th className="p-2 text-right">Fill time (s)</th></tr>
                  </thead>
                  <tbody>
                    {TIME_MOTION[l].map(([p, tph, s, basis]) => {
                      const key = lineFillTimeKey(l, p);
                      const seconds = secondsFor(key, s);
                      const metrics = fillSpeedMetrics(seconds, s, tph);
                      const hit = kg !== null && Math.abs(p - kg) < 0.0005;
                      const invalid = drafts[key] !== undefined && parseFillTime(drafts[key]) === null;
                      return (
                        <tr key={p} title={basis || undefined} className={cn("border-t", hit && "bg-primary/15 font-semibold")}>
                          <td className="whitespace-nowrap p-2">{kgLabel(p)}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 rounded bg-muted"><div className="h-2 rounded" style={{ width: `${Math.min(100, (metrics.perHour / max) * 100)}%`, backgroundColor: bayInk(`Line ${l}`) }} /></div>
                              <span className="w-14 text-right tabular-nums">{wholeNumber(metrics.perHour)}</span>
                            </div>
                          </td>
                          <td className="p-2 text-right tabular-nums">{metrics.perMinute.toFixed(1)}</td>
                          <td className="p-2 text-right">
                            <Input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={drafts[key] ?? String(seconds)}
                              onChange={(event) => changeFillTime(key, s, event.target.value)}
                              onBlur={() => clearInvalidDraft(key)}
                              aria-label={`Line ${l} ${kgLabel(p)} fill time in seconds`}
                              aria-invalid={invalid}
                              className={cn("ml-auto h-9 w-24 text-right font-semibold tabular-nums", metrics.edited && "border-warning bg-warning/5")}
                            />
                          </td>
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                      <tr><th className="p-2 text-left">Pack</th><th className="p-2 text-right">Per hour</th><th className="p-2 text-right">Per min</th><th className="p-2 text-right">Fill time (s)</th></tr>
                    </thead>
                    <tbody>
                      {m.rows.map((r) => {
                        const key = machineFillTimeKey(m.name, r.pack);
                        const seconds = secondsFor(key, r.seconds);
                        const metrics = fillSpeedMetrics(seconds, r.seconds, r.perHour, r.fillsPerCycle ?? 1);
                        const invalid = drafts[key] !== undefined && parseFillTime(drafts[key]) === null;
                        return (
                          <tr key={r.pack} className="border-t align-top">
                            <td className="p-2"><div className="font-medium">{r.pack}</div>{r.product && <div className="text-xs text-muted-foreground">{r.product}</div>}{r.basis && <div className="text-xs text-muted-foreground">{r.basis}</div>}{r.note && <div className="text-xs text-warning">{r.note}</div>}</td>
                            <td className="whitespace-nowrap p-2 text-right tabular-nums">{wholeNumber(metrics.perHour)} {r.unit}</td>
                            <td className="whitespace-nowrap p-2 text-right tabular-nums">{metrics.perMinute.toLocaleString("en-GB", { maximumFractionDigits: 1 })}</td>
                            <td className="p-2 text-right">
                              <Input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                value={drafts[key] ?? String(seconds)}
                                onChange={(event) => changeFillTime(key, r.seconds, event.target.value)}
                                onBlur={() => clearInvalidDraft(key)}
                                aria-label={`${m.name} ${r.pack} fill time in seconds`}
                                aria-invalid={invalid}
                                className={cn("ml-auto h-9 w-24 text-right font-semibold tabular-nums", metrics.edited && "border-warning bg-warning/5")}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
