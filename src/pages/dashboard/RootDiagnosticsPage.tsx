import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, RefreshCw, Trash2, Loader2, Terminal, BellRing } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { logSystemError } from "@/lib/telemetry";
import { useMarkDiagnosticsSeen } from "@/hooks/useTelemetryBadge";
import { diagnosticsView } from "@/lib/diagnosticsView";
import { pushVerdictHint } from "@/lib/pushDiagnostics";
import { usePushStateRows, type TelemetryLog as Log } from "@/hooks/usePushStateRows";

const rpc = supabase as unknown as {
  from: (t: string) => any;
};

const TYPE_COLOR: Record<string, string> = {
  REACT_CRASH: "bg-destructive/15 text-destructive-strong border-destructive/30",
  JS_ERROR: "bg-destructive/15 text-destructive-strong border-destructive/30",
  UNHANDLED_REJECTION: "bg-warning/15 text-warning-strong border-warning/30",
  RLS_ERROR: "bg-warning/15 text-warning-strong border-warning/30",
  API_ERROR: "bg-warning/15 text-warning-strong border-warning/30",
  REALTIME: "bg-primary/15 text-primary border-primary/30",
  // Deliberately not a warning colour. These are refusals the person who hit them
  // could fix by typing something else, on a screen that told them how — worth having
  // in the list, and worth not looking like the ones that need somebody.
  USER_ERROR: "bg-muted text-muted-foreground border-border",
  // Also deliberately not a warning colour. The screen that logged this already
  // rendered the right answer without the column; what is left is a migration to
  // apply, which is a job, not an incident.
  SCHEMA_DRIFT: "bg-muted text-muted-foreground border-border",
  PUSH_STATE: "bg-muted text-muted-foreground border-border",
  // A request sent before the token was there (`requestAuth`). The grant is fine.
  NO_SESSION: "bg-muted text-muted-foreground border-border",
};

/** The only PUSH_STATE rows listed here are faults (the rest are on Phone Notifications). */
const PUSH_FAULT = "bg-destructive/15 text-destructive-strong border-destructive/30";

/** What a logged RLS/API failure was asking for — the card is useless without it. */
function requestLine(m: Record<string, unknown> | null): string | null {
  if (!m || !m.resource) return null;
  return [m.method, m.resource, m.status && `→ ${m.status}`, m.code && `(${m.code})`].filter(Boolean).join(" ");
}

export default function RootDiagnosticsPage() {
  const [filter, setFilter] = useState<string>("all");
  const markSeen = useMarkDiagnosticsSeen();
  const navigate = useNavigate();

  // Opening the page counts as "seen" — clears the sidebar crash badge.
  useEffect(() => { markSeen(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: logs = [], isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["telemetry-logs"],
    queryFn: async () => {
      const { data, error } = await rpc
        .from("system_telemetry_logs")
        .select("id, created_at, user_id, user_role, error_type, message, stack_trace, route_path, metadata")
        // Phones' daily readings are read on their own (`usePushStateRows`): ~40 a day
        // would otherwise crowd the errors out of the newest 200.
        .neq("error_type", "PUSH_STATE")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Log[];
    },
  });
  const pushRows = usePushStateRows();

  const { chips, problems, shown, readings } = diagnosticsView(logs, pushRows.data ?? [], filter);
  const refreshAll = () => { void refetch(); void pushRows.refetch(); };

  const clearAll = async () => {
    if (!window.confirm("Delete ALL telemetry logs? This cannot be undone.")) return;
    const { error } = await rpc.from("system_telemetry_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { toast.error(error.message); return; }
    toast.success("Telemetry cleared");
    refreshAll();
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          title="Root Diagnostics"
          description="Errors captured across the app — React crashes, JS errors, rejected promises and logged RLS/API failures. Admin only."
          icon={<ShieldAlert className="h-5 w-5 text-destructive-strong" />}
          actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/phone-notifications")}>
              <BellRing className="h-4 w-4 mr-1" /> Phone notifications
            </Button>
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={isRefetching || pushRows.isRefetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isRefetching || pushRows.isRefetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => logSystemError("API_ERROR", "Test log from Root Diagnostics")}>
              <Terminal className="h-4 w-4 mr-1" /> Test log
            </Button>
            <Button variant="outline" size="sm" className="text-destructive-strong" onClick={clearAll} disabled={!logs.length && !(pushRows.data?.length)}>
              <Trash2 className="h-4 w-4 mr-1" /> Clear
            </Button>
          </div>
          }
        />

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFilter("all")} className={`rounded-full border px-3 py-1 text-xs ${filter === "all" ? "bg-primary text-primary-foreground" : "bg-card"}`}>All ({problems.length})</button>
            {chips.map(({ type, count }) => (
              <button key={type} onClick={() => setFilter(type)} className={`rounded-full border px-3 py-1 text-xs font-mono ${filter === type ? "bg-primary text-primary-foreground" : "bg-card"}`}>
                {type} ({count})
              </button>
            ))}
          </div>
        )}


        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : isError ? (
          <Card><CardContent className="p-6 text-sm text-destructive-strong">Failed to load telemetry (are you admin?).</CardContent></Card>
        ) : shown.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">No errors captured. 🎉</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {shown.map((l) => (
              <Card key={l.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Badge className={`${TYPE_COLOR[l.error_type] ?? "bg-muted"} border font-mono text-2xs`}>{l.error_type}</Badge>
                      {l.error_type === "PUSH_STATE" && (
                        <Badge className={`${PUSH_FAULT} border text-2xs`}>Fault</Badge>
                      )}
                      <span className="font-normal text-muted-foreground text-xs tabular-nums">{format(new Date(l.created_at), "dd/MM HH:mm:ss")}</span>
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">{l.route_path} · {l.user_role ?? "?"}{l.user_id ? ` · ${l.user_id.slice(0, 8)}` : ""}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <p className="font-medium break-words">{l.message}</p>
                  {l.error_type === "PUSH_STATE" && (
                    <p className="text-xs text-muted-foreground break-words">{pushVerdictHint(l.metadata)}</p>
                  )}
                  {requestLine(l.metadata) && (
                    <p className="font-mono text-xs text-muted-foreground break-words">{requestLine(l.metadata)}</p>
                  )}
                  {l.stack_trace && (
                    <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-2xs leading-relaxed text-muted-foreground">{l.stack_trace}</pre>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {readings > 0 && (
          <p className="text-xs text-muted-foreground">
            Not errors, not listed: {readings} {readings === 1 ? "request" : "requests"} sent before sign-in had finished
            (NO_SESSION). The grant was fine and the next request carried the token.
          </p>
        )}
      </div>
    </DashboardLayout>
  );
}
