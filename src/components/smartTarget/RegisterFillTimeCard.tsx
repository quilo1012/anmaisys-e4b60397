import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRegisterSkuFillTime, useSkuFillTimes, type TimeBasis } from "@/hooks/useSkuFillTimes";
import { parseFillTime } from "@/lib/fillSpeedMatrixEditor";

const MACHINES = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Line 6", "Gel Machine", "Tablet Line", "Capsules Machine 1", "Capsules Machine 2"];
const DEFAULT_UNITS: Record<string, string> = { "Line 4": "2", "Gel Machine": "2", "Capsules Machine 1": "5", "Capsules Machine 2": "21" };

/** Records the real fill time of a SKU on a line; Smart Target reads it as the approved standard. */
export function RegisterFillTimeCard() {
  const { data } = useSkuFillTimes();
  const reg = useRegisterSkuFillTime();
  const [machine, setMachine] = useState("Line 1");
  const [sku, setSku] = useState(""); const [name, setName] = useState("");
  const [secs, setSecs] = useState(""); const [basis, setBasis] = useState<TimeBasis>("per_cycle");
  const [units, setUnits] = useState("1");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const s = parseFillTime(secs); const u = Number(units);
  const valid = sku.trim() && s !== null && (basis === "per_unit" || (Number.isInteger(u) && u > 0));
  if (data === null) return null;
  const pickMachine = (m: string) => { setMachine(m); setUnits(DEFAULT_UNITS[m] ?? "1"); };
  const save = async () => {
    setMsg(null);
    try {
      await reg.mutateAsync({ machine_name: machine, sku_code: sku.trim().toUpperCase(), product_description: name.trim(), approved_seconds: s!, time_basis: basis, units_per_cycle: basis === "per_cycle" ? u : null });
      setMsg({ ok: true, text: `Saved ${sku.trim().toUpperCase()} on ${machine}: ${s} s.` }); setSku(""); setName(""); setSecs("");
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save" }); }
  };
  return (
    <Card>
      <CardHeader><CardTitle>Record real fill time</CardTitle>
        <p className="text-sm text-muted-foreground">Saved for everyone. Smart Target uses it instead of iTouch for this SKU on this line.</p></CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Line / machine
          <select value={machine} onChange={(e) => pickMachine(e.target.value)} className="mt-1 block h-14 rounded-md border bg-background px-3">{MACHINES.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="text-sm">SKU<Input value={sku} onChange={(e) => setSku(e.target.value)} autoComplete="off" className="mt-1 h-14 w-36" /></label>
        <label className="text-sm">Product<Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className="mt-1 h-14 w-64" /></label>
        <label className="text-sm">Fill time (s)<Input value={secs} onChange={(e) => setSecs(e.target.value)} inputMode="decimal" autoComplete="off" className="mt-1 h-14 w-28 text-right" /></label>
        <label className="text-sm">Basis
          <select value={basis} onChange={(e) => setBasis(e.target.value as TimeBasis)} className="mt-1 block h-14 rounded-md border bg-background px-3"><option value="per_cycle">per cycle</option><option value="per_unit">per unit</option></select></label>
        {basis === "per_cycle" && <label className="text-sm">Units / cycle<Input value={units} onChange={(e) => setUnits(e.target.value)} inputMode="numeric" autoComplete="off" className="mt-1 h-14 w-24 text-right" /></label>}
        <Button className="h-14 px-6" disabled={!valid || reg.isPending} onClick={save}>{reg.isPending ? "Saving…" : "Save"}</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "w-full text-sm text-primary" : "w-full text-sm text-destructive"}>{msg.text}</p>}
      </CardContent>
    </Card>
  );
}
