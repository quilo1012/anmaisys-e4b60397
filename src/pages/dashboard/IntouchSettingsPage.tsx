import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Copy, CheckCircle2, AlertCircle, Loader2, Plug, RefreshCw, PowerOff, List, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { invokeFunction } from "@/lib/invokeFunction";
import { supabase } from "@/integrations/supabase/client";

const PROJECT_REF = (import.meta.env.VITE_SUPABASE_URL || "")
  .replace("https://", "")
  .split(".")[0];
const WEBHOOK_URL = `https://${PROJECT_REF}.functions.supabase.co/intouch-webhook`;

export default function IntouchSettingsPage() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<any>(null);

  const [machines, setMachines] = useState<any[] | null>(null);
  const [loadingMachines, setLoadingMachines] = useState(false);
  const [machineErr, setMachineErr] = useState<string | null>(null);
  const [machineFilter, setMachineFilter] = useState("");





  const [syncDisabled, setSyncDisabled] = useState<boolean>(false);
  const [togglingFlag, setTogglingFlag] = useState(false);
  const [autoWoEnabled, setAutoWoEnabled] = useState<boolean>(false);
  const [togglingAutoWo, setTogglingAutoWo] = useState(false);

  const [unmappedLines, setUnmappedLines] = useState<{ id: string; name: string }[]>([]);
  const [loadingUnmapped, setLoadingUnmapped] = useState(false);

  const loadUnmappedLines = async () => {
    setLoadingUnmapped(true);
    try {
      const [{ data: lines, error: lErr }, { data: maps, error: mErr }] = await Promise.all([
        (supabase as any).from("lines").select("id, name").order("name"),
        (supabase as any).from("intouch_machine_map").select("line_id").not("line_id", "is", null),
      ]);
      if (lErr) throw lErr;
      if (mErr) throw mErr;
      const mapped = new Set((maps ?? []).map((r: any) => r.line_id));
      setUnmappedLines((lines ?? []).filter((l: any) => !mapped.has(l.id)));
    } catch (e: any) {
      console.error("[IntouchSettings] unmapped lines load failed", e);
    } finally {
      setLoadingUnmapped(false);
    }
  };

  useEffect(() => { loadUnmappedLines(); }, []);


  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from("system_settings")
        .select("id, intouch_sync_enabled, intouch_auto_wo_enabled")
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("[IntouchSettings] failed to load system_settings", error);
        toast.error(`Failed to load iTouching settings: ${error.message}`);
        return;
      }
      if (data) {
        setSyncDisabled(data.intouch_sync_enabled === false);
        setAutoWoEnabled(data.intouch_auto_wo_enabled === true);
      }
    })();
  }, []);

  const toggleAutoWo = async (enabled: boolean) => {
    setTogglingAutoWo(true);
    const { data: row } = await (supabase as any)
      .from("system_settings").select("id").limit(1).maybeSingle();
    if (!row?.id) { toast.error("system_settings row missing"); setTogglingAutoWo(false); return; }
    const { error } = await (supabase as any)
      .from("system_settings")
      .update({ intouch_auto_wo_enabled: enabled })
      .eq("id", row.id);
    setTogglingAutoWo(false);
    if (error) { toast.error(error.message); return; }
    setAutoWoEnabled(enabled);
    toast.success(enabled ? "Auto WO from iTouching: ON" : "Auto WO from iTouching: OFF");
  };


  /**
   * The sync writes production_items, and that write path destroyed a shift's
   * logged output more than once. Switching it back ON therefore asks for the
   * admin PIN. The check is server-side in set_intouch_sync_enabled(); this
   * dialog only collects the PIN. Direct column writes are revoked, so there is
   * no way round it via the API either.
   *
   * Switching it OFF needs no PIN — making the safe direction harder to reach
   * would be backwards.
   */
  const [pinPrompt, setPinPrompt] = useState(false);
  const [pinValue, setPinValue] = useState("");

  const applySyncFlag = async (enabled: boolean, pin: string) => {
    setTogglingFlag(true);
    const { error } = await (supabase as any).rpc("set_intouch_sync_enabled", {
      _enabled: enabled,
      _pin: pin,
    });
    setTogglingFlag(false);
    if (error) {
      toast.error(error.message || "Could not change the sync setting");
      return false;
    }
    setSyncDisabled(!enabled);
    toast.success(enabled ? "Sync enabled" : "Sync disabled (cron + manual)");
    return true;
  };

  const confirmEnableSync = async () => {
    const ok = await applySyncFlag(true, pinValue.trim());
    if (ok) { setPinPrompt(false); setPinValue(""); }
  };

  const toggleSync = async (disabled: boolean) => {
    if (disabled) {
      // Turning it OFF — no PIN, but the RPC still audits who did it.
      await applySyncFlag(false, "");
      return;
    }
    setPinValue("");
    setPinPrompt(true);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const { data, error } = await invokeFunction<any>("intouch-poll", { test: true });
    setTesting(false);
    if (error) {
      setTestResult({ ok: false, msg: error.message || "Connection failed" });
    } else {
      setTestResult({ ok: true, msg: `OK · ${JSON.stringify(data ?? {}).slice(0, 120)}` });
    }
  };

  const probeToken = async () => {
    setProbing(true);
    setProbeResult(null);
    const { data, error } = await invokeFunction<any>("intouch-token-check", {});
    setProbing(false);
    if (error) {
      setProbeResult({ error: error.message || "Probe failed" });
      toast.error("Probe failed");
    } else {
      setProbeResult(data);
      toast.success("Probe complete");
    }
  };

  const loadMachines = async () => {
    setLoadingMachines(true);
    setMachineErr(null);
    const { data, error } = await invokeFunction<any>("intouch-list-machines", {});
    setLoadingMachines(false);
    if (error) {
      setMachineErr(error.message || "Failed to load machines");
      toast.error("Failed to load machines", {
        action: { label: "Retry", onClick: () => loadMachines() },
      });
      return;
    }
    // Normalized: { machines: [{ guid, name, line, raw }] }. Fallback to legacy shapes.
    const list = Array.isArray(data?.machines)
      ? data.machines
      : Array.isArray(data) ? data : (data?.Machines ?? data?.data ?? data?.value ?? []);
    setMachines(Array.isArray(list) ? list : []);
    toast.success(`${Array.isArray(list) ? list.length : 0} machines loaded`);
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-5xl">
        <PageHeader
          title="iTouching Integration"
          description="Set up, test and monitor the iTouching i4 connection."
          icon={<Plug className="h-5 w-5" />}
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link to="/dashboard/intouch-machines">
                <Plug className="h-4 w-4 mr-1" />Open Machine Map
              </Link>
            </Button>
          }
        />

        {unmappedLines.length > 0 && (
          <Card className="border-warning/40 bg-warning/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-warning-strong">
                <AlertCircle className="h-5 w-5" />
                {unmappedLines.length} line{unmappedLines.length === 1 ? "" : "s"} without iTouching mapping
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                These production lines have no entry in the Machine Map. Sync, "Send to iTouching" and automatic Maintenance Orders will skip them until they are mapped to an iTouching MachineID.
              </p>
              <div className="flex flex-wrap gap-2">
                {unmappedLines.map((l) => (
                  <span key={l.id} className="inline-flex items-center rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs font-medium text-warning-strong">
                    {l.name}
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={loadUnmappedLines} disabled={loadingUnmapped}>
                  {loadingUnmapped ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                  Refresh
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className={autoWoEnabled ? "border-success/50" : "border-warning/50"}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                Auto Maintenance Orders from iTouching stop codes
              </span>
              <span className={"text-xs font-semibold px-2 py-1 rounded " + (autoWoEnabled ? "bg-success/15 text-success-strong" : "bg-warning/15 text-warning-strong")}>
                {autoWoEnabled ? "ON" : "OFF"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              When ON, the iTouching poller opens Maintenance Orders automatically when a mapped machine enters a downtime state with an approved stop code. When OFF, the poll still runs but no order is created.
            </p>
            <div className="flex items-center gap-3">
              <Switch
                checked={autoWoEnabled}
                onCheckedChange={toggleAutoWo}
                disabled={togglingAutoWo}
              />
              <span className="text-sm">{autoWoEnabled ? "Enabled — orders will be opened automatically" : "Disabled — no automatic orders"}</span>
            </div>
          </CardContent>
        </Card>


        {/* "Full resync now" removed. It called intouch-sync-production across every
            line at once, and that write path deleted operator-logged output whenever
            iTouching's schedule disagreed with it — 11,473 units on 29/07 alone, and
            roughly 19,000 across the preceding week. The production sync is switched
            off (settings flag + cron jobs + admin PIN to re-enable), so the button
            had nothing left to do except carry that risk. */}

        <Card>
          <CardHeader><CardTitle className="text-lg">Setup guide</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="font-semibold mb-1">1 · Secrets</div>
              <p className="text-muted-foreground">
                Confirm <code>INTOUCH_API_URL</code>, <code>INTOUCH_API_TOKEN</code> and{" "}
                <code>INTOUCH_WEBHOOK_SECRET</code> are configured in backend secrets.
              </p>
            </div>
            <div>
              <div className="font-semibold mb-1">2 · Edge Functions</div>
              <p className="text-muted-foreground">
                <code>intouch-poll</code>, <code>intouch-webhook</code> and{" "}
                <code>intouch-sync-production</code> are deployed automatically.
              </p>
            </div>
            <div>
              <div className="font-semibold mb-1">3 · Webhook URL</div>
              <p className="text-muted-foreground mb-2">
                Paste this in iTouching Admin → Integrations:
              </p>
              <div className="flex gap-2">
                <Input readOnly value={WEBHOOK_URL} className="font-mono text-xs" />
                <Button variant="outline" onClick={() => copy(WEBHOOK_URL)}>
                  <Copy className="h-4 w-4 mr-2" /> Copy
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Plug className="h-5 w-5" /> Test connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={testConnection} disabled={testing}>
              {testing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Test iTouching API
            </Button>
            {testResult && (
              <div
                className={
                  "flex items-start gap-2 rounded-md border p-3 text-sm " +
                  (testResult.ok
                    ? "border-success/40 bg-success/10 text-success-strong"
                    : "border-destructive/40 bg-destructive/10 text-destructive-strong")
                }
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <span className="break-all">{testResult.msg}</span>
              </div>
            )}
          </CardContent>
        </Card>


        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertCircle className="h-5 w-5" /> Token mode check
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Probes the iTouching API with the configured token and shows the raw response so you can tell if it is a test/sandbox or production key.
            </p>
            <Button onClick={probeToken} disabled={probing} variant="outline">
              {probing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}
              Check token mode
            </Button>
            {probeResult && (
              <div className="space-y-2">
                {probeResult.detection && (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                    <div><strong>Detected mode:</strong> {probeResult.detection.mode}</div>
                    {probeResult.detection.hits?.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Keywords found: {probeResult.detection.hits.join(", ")}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      URL: <code>{probeResult.intouch_url}</code> · Token: <code>{probeResult.token}</code>
                    </div>
                  </div>
                )}
                <pre className="text-xs bg-muted/40 border border-border rounded-md p-3 overflow-auto max-h-96">
{JSON.stringify(probeResult, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <List className="h-5 w-5" /> iTouching Machines (GUIDs)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Fetches all machines from iTouching. To link one to a line, use the{" "}
              <Link to="/dashboard/intouch-machines" className="underline">Machine Map</Link>.
              The machine's <strong>Code</strong> is its own asset code, never the iTouching GUID.
            </p>
            <div className="flex gap-2">
              <Button onClick={loadMachines} disabled={loadingMachines}>
                {loadingMachines ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <List className="h-4 w-4 mr-2" />}
                Load machines
              </Button>
              {machines && machines.length > 0 && (
                <div className="relative flex-1">
                  <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Filter by name or GUID…"
                    value={machineFilter}
                    onChange={(e) => setMachineFilter(e.target.value)}
                    className="pl-8"
                  />
                </div>
              )}
            </div>

            {machineErr && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-strong">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="break-all">{machineErr}</span>
              </div>
            )}
            {machines && (
              <div className="rounded-md border border-border divide-y divide-border max-h-[480px] overflow-auto">
                {machines.length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground">No machines returned.</div>
                )}
                {machines
                  .filter((m: any) => {
                    if (!machineFilter) return true;
                    const q = machineFilter.toLowerCase();
                    const name = (m.name ?? m.Name ?? m.MachineName ?? "").toString().toLowerCase();
                    const guid = (m.guid ?? m.MachineID ?? m.MachineId ?? m.MachineGuid ?? m.MachineGUID ?? m.Guid ?? m.GUID ?? m.Id ?? m.ID ?? m.id ?? "").toString().toLowerCase();
                    return name.includes(q) || guid.includes(q);
                  })
                  .map((m: any, i: number) => {
                    const name = m.name ?? m.Name ?? m.MachineName ?? "(unnamed)";
                    const guid = m.guid ?? m.MachineID ?? m.MachineId ?? m.MachineGuid ?? m.MachineGUID ?? m.Guid ?? m.GUID ?? m.Id ?? m.ID ?? m.id ?? "";
                    const line = m.line ?? m.LineName ?? m.Line ?? "";
                    return (
                      <div key={guid || i} className="flex items-center gap-2 p-2 text-sm hover:bg-muted/40">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {line && <span className="mr-2">[{line}]</span>}
                            <code className="font-mono">{guid}</code>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => copy(String(guid))}>
                          <Copy className="h-3 w-3 mr-1" /> GUID
                        </Button>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>


        {/* "Production Sync Status" removed with the production sync itself. It
            reported on intouch-sync-production runs, and that sync is off — the panel
            would only ever show a stale success from before it was disabled. */}


        {/* "iTouching Products / SKUs" removed. Importing that catalogue is what
            put 324 batch-suffixed duplicates into sku_products ("OCMC6 - B1" beside
            "OCMC6"), which made the operator log codes the system did not hold. The
            catalogue is maintained in SKU Products now. */}

      </div>

    
      {/* Admin PIN required to switch the sync back ON. Server-side check lives
          in set_intouch_sync_enabled(); this only collects the PIN. */}
      <Dialog open={pinPrompt} onOpenChange={(o) => { if (!o) { setPinPrompt(false); setPinValue(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enable iTouching sync</DialogTitle>
            <DialogDescription>
              This sync writes to production records. It has previously removed operator-logged
              output, so enabling it requires the admin PIN and is written to the audit log.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoFocus
            value={pinValue}
            onChange={(e) => setPinValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && pinValue.trim()) void confirmEnableSync(); }}
            placeholder="Admin PIN"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPinPrompt(false); setPinValue(""); }}>Cancel</Button>
            <Button disabled={!pinValue.trim() || togglingFlag} onClick={() => void confirmEnableSync()}>
              {togglingFlag && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enable sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
