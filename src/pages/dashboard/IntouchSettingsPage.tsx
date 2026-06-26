import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Copy, CheckCircle2, AlertCircle, Loader2, Plug, RefreshCw, PowerOff, List, Search } from "lucide-react";
import { toast } from "sonner";
import { invokeFunction } from "@/lib/invokeFunction";
import { supabase } from "@/integrations/supabase/client";

const PROJECT_REF = (import.meta.env.VITE_SUPABASE_URL || "")
  .replace("https://", "")
  .split(".")[0];
const WEBHOOK_URL = `https://${PROJECT_REF}.functions.supabase.co/intouch-webhook`;

export default function IntouchSettingsPage() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<null | { ok: boolean; msg: string }>(null);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<any>(null);

  const [machines, setMachines] = useState<any[] | null>(null);
  const [loadingMachines, setLoadingMachines] = useState(false);
  const [machineErr, setMachineErr] = useState<string | null>(null);
  const [machineFilter, setMachineFilter] = useState("");

  const [syncDisabled, setSyncDisabled] = useState<boolean>(false);
  const [togglingFlag, setTogglingFlag] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("system_settings")
        .select("id, intouch_sync_enabled")
        .limit(1)
        .maybeSingle();
      if (data) setSyncDisabled(data.intouch_sync_enabled === false);
    })();
  }, []);

  const toggleSync = async (disabled: boolean) => {
    setTogglingFlag(true);
    const { data: row } = await (supabase as any)
      .from("system_settings").select("id").limit(1).maybeSingle();
    if (!row?.id) {
      toast.error("system_settings row missing");
      setTogglingFlag(false);
      return;
    }
    const { error } = await (supabase as any)
      .from("system_settings")
      .update({ intouch_sync_enabled: !disabled })
      .eq("id", row.id);
    setTogglingFlag(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSyncDisabled(disabled);
    toast.success(disabled ? "Sync disabled (cron + manual)" : "Sync enabled");
  };

  const syncNow = async () => {
    if (syncDisabled) {
      toast.error("Sync is disabled. Enable it first.");
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    const { data, error } = await invokeFunction<any>("intouch-sync-production", { force: true });
    setSyncing(false);
    if (error) {
      setSyncResult({ ok: false, msg: error.message || "Sync failed" });
      toast.error("Sync failed");
    } else if (data?.skipped) {
      setSyncResult({ ok: false, msg: "Sync disabled in settings" });
    } else {
      const summary = data?.summary || data?.message || JSON.stringify(data ?? {}).slice(0, 160);
      setSyncResult({ ok: true, msg: `Synced · ${summary}` });
      toast.success("Sync complete");
    }
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
      toast.error("Failed to load machines");
      return;
    }
    // API may return array directly or wrapped under .Machines / .data
    const list = Array.isArray(data) ? data : (data?.Machines ?? data?.data ?? data?.value ?? []);
    setMachines(Array.isArray(list) ? list : []);
    toast.success(`${Array.isArray(list) ? list.length : 0} machines loaded`);
  };


  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold">iTouching Integration</h1>
          <p className="text-sm text-muted-foreground">
            Setup, test and monitor the iTouching i4 connection.
          </p>
        </div>

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
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300")
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
              <RefreshCw className="h-5 w-5" /> Sync now
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Force sync of the current shift production from iTouching (Plan / SKU / Actual). Runs the same job as the 06:30 / 18:30 cron.
            </p>
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <PowerOff className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="sync-disabled" className="text-sm font-medium">
                  Disable current-shift sync
                </Label>
              </div>
              <Switch
                id="sync-disabled"
                checked={syncDisabled}
                disabled={togglingFlag}
                onCheckedChange={toggleSync}
              />

            </div>
            <Button onClick={syncNow} disabled={syncing || syncDisabled}>
              {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sync current shift
            </Button>
            {syncResult && (
              <div
                className={
                  "flex items-start gap-2 rounded-md border p-3 text-sm " +
                  (syncResult.ok
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300")
                }
              >
                {syncResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <span className="break-all">{syncResult.msg}</span>
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

      </div>
    </DashboardLayout>
  );
}
