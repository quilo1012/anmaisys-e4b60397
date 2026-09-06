import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertCircle, CheckCircle2, ClipboardCheck, Copy, Loader2, PlugZap, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { invokeFunction } from "@/lib/invokeFunction";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveTable } from "@/components/ResponsiveTable";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

/**
 * Settings → Integrations → SafetyCulture.
 *
 * Shows what the integration has been doing and lets an admin test it or run it
 * by hand. The API token is never fetched here — the only thing this screen can
 * learn about it is whether one exists.
 */

const PROJECT_REF = (import.meta.env.VITE_SUPABASE_URL || "")
  .replace("https://", "")
  .split(".")[0];
const WEBHOOK_URL = `https://${PROJECT_REF}.functions.supabase.co/safetyculture-webhook`;

interface SyncState {
  cursor_modified_after: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  actions_imported: number;
  actions_updated: number;
  actions_skipped: number;
  error_count: number;
  enabled: boolean;
  import_from: string | null;
  actions_found: number;
  actions_ignored: number;
  actions_needs_review: number;
  window_start: string | null;
  window_end: string | null;
}

interface LogRow {
  id: string;
  event: string;
  action_id: string | null;
  action_title: string | null;
  message: string | null;
  created_at: string;
}

const when = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";

const BAD = ["auth_error", "api_error", "classification_error", "line_leader_error", "rate_limited", "timeout"];

function EventBadge({ event }: { event: string }) {
  const variant = BAD.includes(event)
    ? "destructive"
    : event === "created" || event === "updated"
      ? "default"
      : "secondary";
  return <Badge variant={variant as never}>{event.replace(/_/g, " ")}</Badge>;
}

interface ClassRow {
  line: string | null;
  leader_name: string | null;
  department: string | null;
  error_type: string | null;
  classification_status: string | null;
}

export default function SafetyCultureSettingsPage() {
  const [state, setState] = useState<SyncState | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [needsClass, setNeedsClass] = useState<number>(0);
  const [rows, setRows] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: status }, { data: logRows }, { count }, { data: classRows }] = await Promise.all([
      invokeFunction<{ configured: boolean; organization_id: string | null; state: SyncState }>(
        "safetyculture-sync",
        { mode: "status" },
      ),
      (supabase as never as typeof supabase)
        .from("sc_sync_logs")
        .select("id,event,action_id,action_title,message,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      (supabase as never as typeof supabase)
        .from("quality_actions")
        .select("id", { count: "exact", head: true })
        .eq("source", "safetyculture")
        .eq("needs_classification", true),
      (supabase as never as typeof supabase)
        .from("quality_actions")
        .select("line,leader_name,department,error_type,classification_status")
        .eq("source", "safetyculture")
        .limit(2000),
    ]);
    if (status) {
      setConfigured(status.configured);
      setOrgId(status.organization_id);
      setState(status.state ?? null);
    }
    setLogs((logRows ?? []) as unknown as LogRow[]);
    setNeedsClass(count ?? 0);
    setRows((classRows ?? []) as unknown as ClassRow[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const classifyPending = async () => {
    setClassifying(true);
    const { data, error } = await invokeFunction<{
      examined: number; classified: number; needs_review: number;
    }>("safetyculture-classify", { scope: "pending" });
    setClassifying(false);
    if (error) toast.error(error.message ?? "Classification failed");
    else {
      toast.success(
        `${data?.classified ?? 0} action(s) classified, ${data?.needs_review ?? 0} still to review.`,
      );
    }
    void load();
  };


  const test = async () => {
    setTesting(true);
    setTestResult(null);
    const { data, error } = await invokeFunction<{ ok: boolean; actions_visible: number }>(
      "safetyculture-sync",
      { mode: "test" },
    );
    setTesting(false);
    if (error || !data?.ok) {
      setTestResult({ ok: false, msg: error?.message ?? "Connection failed" });
      return;
    }
    setTestResult({ ok: true, msg: "SafetyCulture accepted the credentials." });
  };

  const syncNow = async () => {
    setSyncing(true);
    const { data, error } = await invokeFunction<{
      read: number; created: number; updated: number; unchanged: number; errors: number;
    }>("safetyculture-sync", { mode: "sync" });
    setSyncing(false);
    if (error) {
      toast.error(error.message ?? "Sync failed");
    } else {
      toast.success(
        `Read ${data?.read ?? 0} action(s): ${data?.created ?? 0} new, ${data?.updated ?? 0} updated.`,
      );
    }
    void load();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          title="SafetyCulture"
          description="Quality actions raised in SafetyCulture arrive here on their own — nobody re-types them."
          icon={<ClipboardCheck className="h-5 w-5" />}
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Integration status</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={test} disabled={testing}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                Test connection
              </Button>
              <Button variant="outline" size="sm" onClick={classifyPending} disabled={classifying}>
                {classifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
                Classify pending
              </Button>
              <Button size="sm" onClick={syncNow} disabled={syncing}>
                {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sync now
              </Button>

            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Fact label="Credentials">
                    {configured ? (
                      <span className="flex items-center gap-1 text-emerald-500">
                        <CheckCircle2 className="h-4 w-4" /> Configured
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-destructive">
                        <AlertCircle className="h-4 w-4" /> Missing
                      </span>
                    )}
                  </Fact>
                  <Fact label="Organisation ID">
                    <span className="font-mono text-xs">{orgId || "—"}</span>
                  </Fact>
                  <Fact label="Last successful sync">{when(state?.last_success_at)}</Fact>
                  <Fact label="Last attempt">{when(state?.last_attempt_at)}</Fact>
                  <Fact label="Imported (last run)">
                    <span className="tabular-nums">{state?.actions_imported ?? 0}</span>
                  </Fact>
                  <Fact label="Updated (last run)">
                    <span className="tabular-nums">{state?.actions_updated ?? 0}</span>
                  </Fact>
                  <Fact label="Errors (last run)">
                    <span className="tabular-nums">{state?.error_count ?? 0}</span>
                  </Fact>
                  <Fact label="Needs classification">
                    <span className="tabular-nums">{needsClass}</span>
                  </Fact>
                  <Fact label="Importing from">
                    {state?.import_from
                      ? new Date(state.import_from).toLocaleDateString("en-GB", { dateStyle: "medium" })
                      : "—"}
                  </Fact>
                  <Fact label="Found in window (last run)">
                    <span className="tabular-nums">{state?.actions_found ?? 0}</span>
                  </Fact>
                  <Fact label="Ignored — before window">
                    <span className="tabular-nums">{state?.actions_ignored ?? 0}</span>
                  </Fact>
                  <Fact label="Needs review (last run)">
                    <span className="tabular-nums">{state?.actions_needs_review ?? 0}</span>
                  </Fact>
                  <Fact label="Period covered (last run)">
                    <span className="text-xs">
                      {when(state?.window_start)} → {when(state?.window_end)}
                    </span>
                  </Fact>
                </div>

                {state?.last_error && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <span className="font-medium">Last error: </span>{state.last_error}
                  </div>
                )}

                {testResult && (
                  <div
                    className={`rounded-md border p-3 text-sm ${
                      testResult.ok
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-destructive/40 bg-destructive/10"
                    }`}
                  >
                    {testResult.msg}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Only actions raised on or after the import date above are brought in.
                  A catch-up runs automatically every hour. Actions normally arrive within seconds
                  through the webhook below.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Webhook address</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Paste this into SafetyCulture so changes reach us immediately. Add the shared secret as
              a <span className="font-mono text-xs">x-safetyculture-secret</span> header.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={WEBHOOK_URL} className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  void navigator.clipboard.writeText(WEBHOOK_URL);
                  toast.success("Address copied");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ResponsiveTable
                table={
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="whitespace-nowrap text-xs tabular-nums">{when(l.created_at)}</TableCell>
                          <TableCell><EventBadge event={l.event} /></TableCell>
                          <TableCell className="max-w-[22rem] truncate">{l.action_title ?? "—"}</TableCell>
                          <TableCell className="max-w-[22rem] truncate text-xs text-muted-foreground">{l.message ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                }
                cards={
                  <div className="space-y-2">
                    {logs.map((l) => (
                      <div key={l.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <EventBadge event={l.event} />
                          <span className="text-xs tabular-nums text-muted-foreground">{when(l.created_at)}</span>
                        </div>
                        <div className="mt-1 truncate text-sm">{l.action_title ?? "—"}</div>
                        {l.message && (
                          <div className="mt-0.5 text-xs text-muted-foreground">{l.message}</div>
                        )}
                      </div>
                    ))}
                  </div>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{children}</div>
    </div>
  );
}
