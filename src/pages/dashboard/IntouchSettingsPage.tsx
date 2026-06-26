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
  const [autoMapping, setAutoMapping] = useState(false);
  const [autoMapResult, setAutoMapResult] = useState<null | {
    matched: number; saved: number; skipped: number; total: number;
    details: { intouch: string; matched?: string; guid: string; status: "saved" | "skipped" | "already" | "error"; reason?: string }[];
  }>(null);


  const [syncDisabled, setSyncDisabled] = useState<boolean>(false);
  const [togglingFlag, setTogglingFlag] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from("system_settings")
        .select("id, intouch_sync_enabled")
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("[IntouchSettings] failed to load system_settings", error);
        toast.error(`Failed to load iTouching settings: ${error.message}`);
        return;
      }
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
    // Normalized: { machines: [{ guid, name, line, raw }] }. Fallback to legacy shapes.
    const list = Array.isArray(data?.machines)
      ? data.machines
      : Array.isArray(data) ? data : (data?.Machines ?? data?.data ?? data?.value ?? []);
    setMachines(Array.isArray(list) ? list : []);
    toast.success(`${Array.isArray(list) ? list.length : 0} machines loaded`);
  };

  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/[_\-\/]+/g, " ")
      .replace(/[^a-z0-9 ]+/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const tokens = (s: string) => new Set(normalize(s).split(" ").filter(Boolean));

  const similarity = (a: string, b: string) => {
    const na = normalize(a), nb = normalize(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const ta = tokens(a), tb = tokens(b);
    const inter = [...ta].filter((t) => tb.has(t)).length;
    const union = new Set([...ta, ...tb]).size;
    const jaccard = union ? inter / union : 0;
    const contains = na.includes(nb) || nb.includes(na) ? 0.85 : 0;
    return Math.max(jaccard, contains);
  };

  // Manual alias map: iTouching name (normalized) -> list of DB machine name patterns to match
  // Supports one-to-many (e.g. Filler Line 5 -> Line 5A + Line 5B share the same GUID)
  const ALIASES: { intouch: RegExp; dbPatterns: RegExp[] }[] = [
    { intouch: /tablet/i, dbPatterns: [/^tablet/i] },
    { intouch: /filler.*5|^line\s*5/i, dbPatterns: [/^line\s*5a$/i, /^line\s*5b$/i] },
    { intouch: /filler.*6|^line\s*6/i, dbPatterns: [/^line\s*6a$/i, /^line\s*6b$/i] },
    { intouch: /gel/i, dbPatterns: [/gel\s*packing/i] },
    { intouch: /unscheduled/i, dbPatterns: [/unscheduled/i] },
  ];


  const autoMapMachines = async () => {
    if (!machines || machines.length === 0) {
      toast.error("Load iTouching machines first");
      return;
    }
    setAutoMapping(true);
    setAutoMapResult(null);
    try {
      const { data: dbMachines, error } = await (supabase as any)
        .from("machines")
        .select("id, name, code");
      if (error) throw error;
      const dbList: { id: string; name: string; code: string | null }[] = dbMachines || [];

      const details: any[] = [];
      let matched = 0, saved = 0, skipped = 0;

      const applyUpdate = async (row: typeof dbList[number], name: string, guid: string) => {
        if ((row.code || "").trim().toLowerCase() === guid.toLowerCase()) {
          details.push({ intouch: name, matched: row.name, guid, status: "already" });
          return;
        }
        const { error: updErr } = await (supabase as any)
          .from("machines").update({ code: guid }).eq("id", row.id);
        if (updErr) {
          details.push({ intouch: name, matched: row.name, guid, status: "error", reason: updErr.message });
        } else {
          saved++;
          details.push({ intouch: name, matched: row.name, guid, status: "saved" });
        }
      };

      for (const m of machines) {
        const name: string = (m.name ?? m.Name ?? m.MachineName ?? "").toString();
        const guid: string = (m.guid ?? m.MachineID ?? m.MachineId ?? m.MachineGuid ?? m.MachineGUID ?? m.Guid ?? m.GUID ?? m.Id ?? m.ID ?? m.id ?? "").toString();
        if (!name || !guid) {
          skipped++;
          details.push({ intouch: name || "(unnamed)", guid, status: "skipped", reason: "missing name/guid" });
          continue;
        }

        // 1) Try alias map (supports one-to-many). Alias is EXCLUSIVE — if it matches by name,
        // we never fall through to fuzzy (prevents e.g. "Tablet Line" matching "Line 5A").
        const alias = ALIASES.find((a) => a.intouch.test(name));
        if (alias) {
          const targets = dbList.filter((r) => alias.dbPatterns.some((p) => p.test(r.name || "")));
          if (targets.length > 0) {
            matched++;
            for (const row of targets) await applyUpdate(row, name, guid);
          } else {
            skipped++;
            details.push({ intouch: name, guid, status: "skipped", reason: "alias matched but no DB machine found" });
          }
          continue;
        }


        // 2) Fallback to fuzzy similarity (lowered threshold)
        let best: { row: typeof dbList[number]; score: number } | null = null;
        for (const row of dbList) {
          const score = similarity(name, row.name || "");
          if (!best || score > best.score) best = { row, score };
        }
        if (!best || best.score < 0.3) {
          skipped++;
          details.push({ intouch: name, guid, status: "skipped", reason: `no match (best ${best?.score.toFixed(2) ?? "0"})` });
          continue;
        }
        matched++;
        await applyUpdate(best.row, name, guid);
      }

      setAutoMapResult({ matched, saved, skipped, total: machines.length, details });
      toast.success(`Auto-map: ${saved} saved, ${skipped} skipped`);
    } catch (e: any) {
      toast.error(e.message || "Auto-map failed");

    } finally {
      setAutoMapping(false);
    }
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

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <List className="h-5 w-5" /> iTouching Machines (GUIDs)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Fetches all machines from iTouching. Copy each GUID and paste it into the matching
              machine's <strong>Code</strong> field on the Machines page so the integration can map them.
            </p>
            <div className="flex gap-2">
              <Button onClick={loadMachines} disabled={loadingMachines}>
                {loadingMachines ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <List className="h-4 w-4 mr-2" />}
                Load machines
              </Button>
              {machines && machines.length > 0 && (
                <Button onClick={autoMapMachines} disabled={autoMapping} variant="secondary">
                  {autoMapping ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}
                  Auto-map all machines
                </Button>
              )}
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
            {autoMapResult && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-2">
                <div className="font-medium">
                  Auto-map summary: {autoMapResult.saved} saved · {autoMapResult.matched - autoMapResult.saved} already mapped · {autoMapResult.skipped} skipped · {autoMapResult.total} total
                </div>
                <div className="max-h-48 overflow-auto text-xs font-mono space-y-1">
                  {autoMapResult.details.map((d, i) => (
                    <div key={i} className={
                      d.status === "saved" ? "text-green-600 dark:text-green-400" :
                      d.status === "already" ? "text-muted-foreground" :
                      d.status === "error" ? "text-red-600 dark:text-red-400" :
                      "text-amber-600 dark:text-amber-400"
                    }>
                      [{d.status}] {d.intouch}{d.matched ? ` → ${d.matched}` : ""}{d.reason ? ` (${d.reason})` : ""}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {machineErr && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
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

      </div>
    </DashboardLayout>
  );
}
