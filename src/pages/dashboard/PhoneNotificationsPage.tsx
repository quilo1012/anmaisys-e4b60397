import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { BellRing, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { usePushStateRows } from "@/hooks/usePushStateRows";
import { pushDevicesView } from "@/lib/diagnosticsView";
import { pushVerdictHint, type PushVerdict } from "@/lib/pushDiagnostics";

/**
 * Whether the server can reach each person's phone.
 *
 * These are the PUSH_STATE readings (src/lib/pushDiagnostics.ts): each device saying, once
 * a day, how push stands on it. They lived on Root Diagnostics until 18/11/2026, where a
 * list of mostly working phones was read twice in one day as "more errors". Root
 * Diagnostics keeps only the faults; the whole picture is here.
 */

const VERDICT: Record<PushVerdict, { label: string; cls: string }> = {
  fault: { label: "Fault", cls: "bg-destructive/15 text-destructive-strong border-destructive/30" },
  person: { label: "Waiting on the person", cls: "bg-muted text-muted-foreground border-border" },
  ok: { label: "Working", cls: "bg-success/15 text-success-strong border-success/30" },
};

const PLATFORM: Record<string, string> = { ios: "iPhone", android: "Android", desktop: "Computer", other: "Other device" };

function deviceLabel(meta: Record<string, unknown> | null): string {
  const m = meta ?? {};
  const platform = PLATFORM[String(m.platform)] ?? "Device";
  const opened = m.display === "standalone" ? "installed app" : "browser tab";
  return `${platform} · ${opened}`;
}

type Filter = "all" | PushVerdict;

export default function PhoneNotificationsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const { data: rows = [], isLoading, isError, refetch, isRefetching } = usePushStateRows();
  const { devices, summary } = useMemo(() => pushDevicesView(rows), [rows]);

  const ids = useMemo(
    () => Array.from(new Set(devices.map((d) => d.user_id).filter((id): id is string => !!id))).sort(),
    [devices],
  );
  // Names, so the list says who to talk to rather than a fragment of an id.
  const { data: names = {} } = useQuery({
    queryKey: ["phone-notifications-names", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { in: (k: string, v: string[]) => Promise<{ data: { id: string; name: string | null }[] | null; error: unknown }> } };
      }).from("profiles").select("id, name").in("id", ids);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.name ?? ""])) as Record<string, string>;
    },
  });

  const shown = filter === "all" ? devices : devices.filter((d) => d.verdict === filter);
  const chip = (value: Filter, label: string, count: number) => (
    <button
      key={value}
      onClick={() => setFilter(value)}
      className={`rounded-full border px-3 py-1 text-xs ${filter === value ? "bg-primary text-primary-foreground" : "bg-card"}`}
    >
      {label} ({count})
    </button>
  );

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          title="Phone Notifications"
          description="Whether the server can reach each person's phone — one line per device, its latest reading from the last two weeks. Admin only."
          icon={<BellRing className="h-5 w-5 text-primary" />}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/root-diagnostics")}>
                <ShieldAlert className="h-4 w-4 mr-1" /> Root Diagnostics
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                <RefreshCw className={`h-4 w-4 mr-1 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          }
        />

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : isError ? (
          <Card><CardContent className="p-6 text-sm text-destructive-strong">Failed to load the readings (are you admin?).</CardContent></Card>
        ) : devices.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">No phone has reported in the last two weeks.</CardContent></Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 text-sm space-y-1">
                <p>
                  <span className="font-semibold text-success-strong">{summary.ok} working</span>
                  {" · "}
                  <span className="font-semibold">{summary.person} waiting on the person</span>
                  {" · "}
                  <span className={`font-semibold ${summary.fault ? "text-destructive-strong" : ""}`}>
                    {summary.fault} {summary.fault === 1 ? "fault" : "faults"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  "Waiting on the person" is a phone opened in a Safari tab, notifications never turned on, or
                  blocked in its settings. The app already shows them how to fix it on every screen, and only they
                  can say yes. Faults are the app's to fix, and also appear on Root Diagnostics.
                </p>
              </CardContent>
            </Card>

            <div className="flex flex-wrap gap-2">
              {chip("all", "All", devices.length)}
              {chip("fault", "Faults", summary.fault)}
              {chip("person", "Waiting on the person", summary.person)}
              {chip("ok", "Working", summary.ok)}
            </div>

            {shown.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">Nothing in this group.</CardContent></Card>
            ) : (
              <div className="space-y-2">
                {shown.map((d) => (
                  <Card key={d.id}>
                    <CardContent className="p-4 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge className={`${VERDICT[d.verdict].cls} border text-2xs`}>{VERDICT[d.verdict].label}</Badge>
                          <span className="font-semibold">
                            {(d.user_id && names[d.user_id]) || (d.user_id ? d.user_id.slice(0, 8) : "Unknown")}
                          </span>
                          <span className="text-xs text-muted-foreground">{d.user_role ?? "?"}</span>
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {deviceLabel(d.metadata)} · {format(new Date(d.created_at), "dd/MM HH:mm")}
                        </span>
                      </div>
                      <p className="text-sm">{pushVerdictHint(d.metadata)}</p>
                      <p className="font-mono text-2xs text-muted-foreground break-words">{d.message}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
