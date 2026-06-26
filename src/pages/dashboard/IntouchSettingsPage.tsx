import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, CheckCircle2, AlertCircle, Loader2, Plug, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { invokeFunction } from "@/lib/invokeFunction";

const PROJECT_REF = (import.meta.env.VITE_SUPABASE_URL || "")
  .replace("https://", "")
  .split(".")[0];
const WEBHOOK_URL = `https://${PROJECT_REF}.functions.supabase.co/intouch-webhook`;

export default function IntouchSettingsPage() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<null | { ok: boolean; msg: string }>(null);

  const syncNow = async () => {
    setSyncing(true);
    setSyncResult(null);
    const { data, error } = await invokeFunction<any>("intouch-sync-production", { force: true });
    setSyncing(false);
    if (error) {
      setSyncResult({ ok: false, msg: error.message || "Sync failed" });
      toast.error("Sync failed");
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

      </div>
    </DashboardLayout>
  );
}
