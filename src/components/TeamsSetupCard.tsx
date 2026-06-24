import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, ExternalLink, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type LogRow = {
  id: string;
  event: string;
  title: string | null;
  success: boolean;
  status_code: number | null;
  attempts: number;
  error_message: string | null;
  created_at: string;
};

type Health = "healthy" | "degraded" | "down" | "unknown";

function computeHealth(rows: LogRow[]): Health {
  if (!rows.length) return "unknown";
  const last10 = rows.slice(0, 10);
  const failures = last10.filter((r) => !r.success).length;
  const lastFailed = !last10[0].success;
  if (failures === 0) return "healthy";
  if (lastFailed && failures >= 3) return "down";
  return "degraded";
}

const HEALTH_META: Record<Health, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  healthy:   { label: "Healthy",   className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", Icon: CheckCircle2 },
  degraded:  { label: "Degraded",  className: "bg-amber-500/15 text-amber-600 border-amber-500/30",       Icon: AlertTriangle },
  down:      { label: "Down",      className: "bg-red-500/15 text-red-600 border-red-500/30",             Icon: XCircle },
  unknown:   { label: "No data",   className: "bg-muted text-muted-foreground border-border",             Icon: AlertTriangle },
};

export function TeamsSetupCard() {
  const [sending, setSending] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    const { data, error } = await supabase
      .from("teams_webhook_logs" as any)
      .select("id,event,title,success,status_code,attempts,error_message,created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (!error && data) setLogs(data as unknown as LogRow[]);
    setLoadingLogs(false);
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const sendTest = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("notify-teams", {
        body: {
          event: "test",
          title: "Test Notification",
          message: "Microsoft Teams integration is working.",
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Test card sent to Teams");
    } catch (e: any) {
      toast.error(e.message || "Failed to send test card. Check TEAMS_WEBHOOK_URL secret.");
    } finally {
      setSending(false);
      loadLogs();
    }
  };

  const health = computeHealth(logs);
  const meta = HEALTH_META[health];
  const HealthIcon = meta.Icon;
  const last10 = logs.slice(0, 10);
  const recentFailures = last10.filter((r) => !r.success).length;
  const lastFailure = logs.find((r) => !r.success);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          Microsoft Teams
        </CardTitle>
        <CardDescription>
          Push Adaptive Card alerts to a Teams channel for critical work orders, unassigned WOs, and line stops.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status indicator */}
        <div className={`rounded-lg border p-3 ${meta.className}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <HealthIcon className="h-5 w-5" />
              <div>
                <div className="font-semibold leading-tight">Webhook status: {meta.label}</div>
                <div className="text-xs opacity-80">
                  {logs.length === 0
                    ? "No attempts recorded yet."
                    : `${recentFailures} failure${recentFailures === 1 ? "" : "s"} in last ${last10.length} attempt${last10.length === 1 ? "" : "s"}.`}
                  {lastFailure && (
                    <> · Last failure {new Date(lastFailure.created_at).toLocaleString()}.</>
                  )}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={loadLogs} disabled={loadingLogs}>
              <RefreshCw className={`h-4 w-4 ${loadingLogs ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
          <p className="font-medium">Setup steps</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>In Teams, open the target channel → <strong>Connectors</strong> → add <strong>Incoming Webhook</strong>.</li>
            <li>Copy the webhook URL.</li>
            <li>
              Add it as a secret named <Badge variant="secondary">TEAMS_WEBHOOK_URL</Badge> in backend settings.
            </li>
            <li>Send a test below.</li>
          </ol>
          <a
            href="https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Teams webhook docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <Button onClick={sendTest} disabled={sending} className="w-full sm:w-auto">
          <Send className="h-4 w-4 mr-2" />
          {sending ? "Sending..." : "Send test card"}
        </Button>

        {/* Recent attempts */}
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent attempts
          </div>
          {logs.length === 0 ? (
            <div className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
              No attempts recorded yet. Send a test to populate the history.
            </div>
          ) : (
            <div className="rounded-md border divide-y max-h-64 overflow-auto">
              {logs.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 p-2 text-sm">
                  <div className="flex items-start gap-2 min-w-0">
                    {r.success ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.title || r.event}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.event}
                        {r.status_code ? ` · HTTP ${r.status_code}` : ""}
                        {r.attempts > 1 ? ` · ${r.attempts} tries` : ""}
                        {r.error_message ? ` · ${r.error_message}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
