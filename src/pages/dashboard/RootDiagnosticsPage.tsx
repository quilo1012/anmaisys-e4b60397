import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, RefreshCw, Trash2, Loader2, Terminal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { logSystemError } from "@/lib/telemetry";
import { useMarkDiagnosticsSeen } from "@/hooks/useTelemetryBadge";

type Log = {
  id: string; created_at: string; user_id: string | null; user_role: string | null;
  error_type: string; message: string; stack_trace: string | null; route_path: string | null;
  metadata: Record<string, unknown> | null;
};

const rpc = supabase as unknown as {
  from: (t: string) => any;
};

const TYPE_COLOR: Record<string, string> = {
  REACT_CRASH: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  JS_ERROR: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  UNHANDLED_REJECTION: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  RLS_ERROR: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  API_ERROR: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  REALTIME: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
};

export default function RootDiagnosticsPage() {
  const [filter, setFilter] = useState<string>("all");
  const markSeen = useMarkDiagnosticsSeen();

  // Opening the page counts as "seen" — clears the sidebar crash badge.
  useEffect(() => { markSeen(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: logs = [], isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["telemetry-logs"],
    queryFn: async () => {
      const { data, error } = await rpc
        .from("system_telemetry_logs")
        .select("id, created_at, user_id, user_role, error_type, message, stack_trace, route_path, metadata")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Log[];
    },
  });

  const types = Array.from(new Set(logs.map((l) => l.error_type)));
  const shown = filter === "all" ? logs : logs.filter((l) => l.error_type === filter);

  const clearAll = async () => {
    if (!window.confirm("Delete ALL telemetry logs? This cannot be undone.")) return;
    const { error } = await rpc.from("system_telemetry_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { toast.error(error.message); return; }
    toast.success("Telemetry cleared");
    refetch();
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
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => logSystemError("API_ERROR", "Test log from Root Diagnostics")}>
              <Terminal className="h-4 w-4 mr-1" /> Test log
            </Button>
            <Button variant="outline" size="sm" className="text-destructive-strong" onClick={clearAll} disabled={!logs.length}>
              <Trash2 className="h-4 w-4 mr-1" /> Clear
            </Button>
          </div>
          }
        />

        {types.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFilter("all")} className={`rounded-full border px-3 py-1 text-xs ${filter === "all" ? "bg-primary text-primary-foreground" : "bg-card"}`}>All ({logs.length})</button>
            {types.map((t) => (
              <button key={t} onClick={() => setFilter(t)} className={`rounded-full border px-3 py-1 text-xs font-mono ${filter === t ? "bg-primary text-primary-foreground" : "bg-card"}`}>
                {t} ({logs.filter((l) => l.error_type === t).length})
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
                      <span className="font-normal text-muted-foreground text-xs tabular-nums">{format(new Date(l.created_at), "dd/MM HH:mm:ss")}</span>
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">{l.route_path} · {l.user_role ?? "?"}{l.user_id ? ` · ${l.user_id.slice(0, 8)}` : ""}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <p className="font-medium break-words">{l.message}</p>
                  {l.stack_trace && (
                    <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-2xs leading-relaxed text-muted-foreground">{l.stack_trace}</pre>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
