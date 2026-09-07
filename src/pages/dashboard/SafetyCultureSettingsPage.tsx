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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QUALITY_SEVERITIES } from "@/lib/qualityConstants";
import {
  CLASS_LABEL, blockingReasons, advisoryReasons, checkMark, reasonText,
  type ActionClass, type CheckState,
} from "@/lib/classificationLabels";
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
  external_id: string | null;
  title: string | null;
  recorded_at: string | null;
  external_site: string | null;
  classification: ActionClass | null;
  classification_checks: Record<string, CheckState> | null;
  classification_reasons: string[] | null;
  matched_rule_names: string[] | null;
  external_priority_id: string | null;
}

interface PriorityRow {
  priority_id: string;
  name: string;
  severity: string | null;
  rank: number;
}

export default function SafetyCultureSettingsPage() {
  const [state, setState] = useState<SyncState | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [needsClass, setNeedsClass] = useState<number>(0);
  const [rows, setRows] = useState<ClassRow[]>([]);
  const [priorities, setPriorities] = useState<PriorityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: status }, { data: logRows }, { count }, { data: classRows }, { data: prioRows }] = await Promise.all([
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
        .select(
          "line,leader_name,department,error_type,classification_status," +
          "external_id,title,recorded_at,external_site," +
          "classification,classification_checks,classification_reasons,matched_rule_names," +
          "external_priority_id",
        )
        .eq("source", "safetyculture")
        .limit(2000),
      // `sc_priorities` is newer than the generated type file, so this one query is
      // untyped. The shape is fixed by the migration and asserted by scPriority.test.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("sc_priorities")
        .select("priority_id,name,severity,rank")
        .order("rank"),
    ]);
    if (status) {
      setConfigured(status.configured);
      setOrgId(status.organization_id);
      setState(status.state ?? null);
    }
    setLogs((logRows ?? []) as unknown as LogRow[]);
    setNeedsClass(count ?? 0);
    setRows((classRows ?? []) as unknown as ClassRow[]);
    setPriorities((prioRows ?? []) as unknown as PriorityRow[]);
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

        <Priorities rows={rows} priorities={priorities} onSaved={load} />

        <Verdicts rows={rows} />

        <ClassificationBreakdown rows={rows} />



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

/**
 * What the rules actually decided: every imported action grouped by the line (or
 * area) it belongs to, its leader, and the quality error it describes. Anything
 * the rules could not settle stays visible as "to review" instead of being hidden.
 */


/**
 * What SafetyCulture's priorities are called.
 *
 * SafetyCulture sends a priority as a UUID and no name — there is no endpoint that
 * lists them — so the names live here, recorded once. Until a UUID is named, the
 * Quality screen shows "Not mapped" rather than printing the id, and this is where
 * that gets closed.
 *
 * The severity is not decoration: it is what the action is scored on. `action_points_at`
 * grades critical 5, high 4, medium 3, low 2, so naming a priority and grading it is
 * one decision, made in one place.
 */
function Priorities({
  rows, priorities, onSaved,
}: { rows: ClassRow[]; priorities: PriorityRow[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, { name: string; severity: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.external_priority_id) {
      counts.set(r.external_priority_id, (counts.get(r.external_priority_id) ?? 0) + 1);
    }
  }
  const known = new Map(priorities.map((p) => [p.priority_id, p]));
  // Unnamed first: they are the only rows here that need anything doing.
  const ids = [...counts.keys()].sort((a, b) => {
    const na = known.has(a) ? 1 : 0;
    const nb = known.has(b) ? 1 : 0;
    return na - nb || (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
  });
  for (const p of priorities) if (!counts.has(p.priority_id)) ids.push(p.priority_id);

  const save = async (id: string) => {
    const d = draft[id] ?? { name: known.get(id)?.name ?? "", severity: known.get(id)?.severity ?? "" };
    if (!d.name.trim()) { toast.error("Give the priority a name"); return; }
    setSaving(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("sc_priorities")
      .upsert({
        priority_id: id,
        name: d.name.trim(),
        severity: d.severity || null,
        rank: known.get(id)?.rank ?? 100,
      }, { onConflict: "priority_id" });
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Saved ${d.name.trim()}`);
    onSaved();
  };

  if (!ids.length) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Priorities</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No priorities have arrived yet. They appear here after the first sync, ready to name.
          </p>
        </CardContent>
      </Card>
    );
  }

  const unnamed = ids.filter((id) => !known.has(id)).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Priorities</CardTitle>
        {unnamed > 0 && <Badge variant="destructive">{unnamed} still to name</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          SafetyCulture sends a priority as an id and no name. Name each one here, and say
          what it grades as — that grade is what the action scores.
        </p>
        <div className="space-y-2">
          {ids.map((id) => {
            const k = known.get(id);
            const d = draft[id] ?? { name: k?.name ?? "", severity: k?.severity ?? "" };
            const used = counts.get(id) ?? 0;
            return (
              <div key={id} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                <code className="font-mono text-xs text-muted-foreground" title={id}>
                  {id.slice(0, 8)}
                </code>
                <span className="text-xs text-muted-foreground">
                  {used} action{used === 1 ? "" : "s"}
                </span>
                <Input
                  className="h-9 w-36"
                  placeholder="Name"
                  value={d.name}
                  onChange={(e) => setDraft({ ...draft, [id]: { ...d, name: e.target.value } })}
                />
                <Select
                  value={d.severity || "__none__"}
                  onValueChange={(v) =>
                    setDraft({ ...draft, [id]: { ...d, severity: v === "__none__" ? "" : v } })}
                >
                  <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Grades as" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Does not grade</SelectItem>
                    {QUALITY_SEVERITIES.map((sv) => (
                      <SelectItem key={sv.value} value={sv.value}>{sv.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => void save(id)} disabled={saving === id}>
                  {saving === id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * What the gates actually decided, and — for anything they refused to decide — why.
 *
 * The counts are the honest headline: before this existed, fifteen records raised
 * outside Production were being shown as operational actions, and nothing on the
 * screen said so. `Excluded` is displayed rather than hidden for the same reason a
 * needs-review queue is displayed: a record that vanished quietly is a record nobody
 * can question.
 */
const ORDER: ActionClass[] = ["line", "leader", "quality_error", "needs_review", "excluded"];

const CHECK_ORDER: Array<[string, string]> = [
  ["site", "Site"],
  ["action_date", "Action date"],
  ["worker", "Worker"],
  ["line", "Line"],
];

function Verdicts({ rows }: { rows: ClassRow[] }) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.classification ?? "unclassified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const unclassified = counts.get("unclassified") ?? 0;
  const open = rows.filter(
    (r) => r.classification === "needs_review" || r.classification === "excluded",
  );

  const day = (v: string | null) =>
    v
      ? new Date(v).toLocaleDateString("en-GB", {
          day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London",
        })
      : "—";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Verdicts</CardTitle>
        {unclassified > 0 && (
          <Badge variant="outline">{unclassified} not yet run through the gates</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {ORDER.map((c) => (
            <div key={c} className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{CLASS_LABEL[c]}</div>
              <div className="text-2xl font-semibold tabular-nums">{counts.get(c) ?? 0}</div>
            </div>
          ))}
        </div>

        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is waiting on a person. Run a classification pass after changing a rule.
          </p>
        ) : (
          <ResponsiveTable
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action #</TableHead>
                    <TableHead>Action date</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Line</TableHead>
                    <TableHead>Checks</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {open.map((r) => (
                    <TableRow key={r.external_id ?? r.title ?? Math.random()}>
                      <TableCell className="font-mono text-xs">
                        {(r.external_id ?? "—").slice(0, 8)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{day(r.recorded_at)}</TableCell>
                      <TableCell className="max-w-[22rem] truncate">{r.title ?? "—"}</TableCell>
                      <TableCell>{r.line ?? r.department ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {CHECK_ORDER.map(([key, label]) => (
                          <span key={key} className="mr-2" title={label}>
                            {label.slice(0, 4)} {checkMark(r.classification_checks?.[key])}
                          </span>
                        ))}
                      </TableCell>
                      <TableCell className="text-xs">
                        {blockingReasons(r.classification_reasons).map((x) => (
                          <div key={x}>{reasonText(x)}</div>
                        ))}
                        {advisoryReasons(r.classification_reasons).map((x) => (
                          <div key={x} className="text-muted-foreground">{reasonText(x)}</div>
                        ))}
                        {(r.matched_rule_names ?? []).length > 0 && (
                          <div className="text-muted-foreground">
                            Matched: {(r.matched_rule_names ?? []).join(", ")}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
            cards={
              <div className="space-y-2">
                {open.map((r) => (
                  <div key={r.external_id ?? r.title ?? Math.random()} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.title ?? "—"}</span>
                      <Badge variant="secondary">
                        {CLASS_LABEL[(r.classification ?? "needs_review") as ActionClass]}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {day(r.recorded_at)} · {r.line ?? r.department ?? "No line"} ·{" "}
                      {r.external_site ?? "No site"}
                    </div>
                    <div className="mt-1 text-xs">
                      {blockingReasons(r.classification_reasons).map((x) => (
                        <div key={x}>{reasonText(x)}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

function ClassificationBreakdown({ rows }: { rows: ClassRow[] }) {
  const pending = rows.filter((r) => r.classification_status !== "classified");
  const groups = new Map<string, { leader: string; errors: Map<string, number>; total: number }>();
  for (const r of rows) {
    const key = r.line || r.department || "Not identified";
    const g = groups.get(key) ?? { leader: r.leader_name || "—", errors: new Map(), total: 0 };
    if (r.leader_name) g.leader = r.leader_name;
    const err = r.error_type || "Not identified";
    g.errors.set(err, (g.errors.get(err) ?? 0) + 1);
    g.total += 1;
    groups.set(key, g);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].total - a[1].total);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Classification — line, leader and quality error</CardTitle>
        <Badge variant={pending.length ? "destructive" : "secondary"}>
          {rows.length - pending.length} classified · {pending.length} to review
        </Badge>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing imported yet.</p>
        ) : (
          <ResponsiveTable
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line / area</TableHead>
                    <TableHead>Leader</TableHead>
                    <TableHead>Quality errors</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordered.map(([name, g]) => (
                    <TableRow key={name}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>{g.leader}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[...g.errors.entries()]
                          .sort((a, b) => b[1] - a[1])
                          .map(([e, n]) => `${e} (${n})`)
                          .join(" · ")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{g.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
            cards={
              <div className="space-y-2">
                {ordered.map(([name, g]) => (
                  <div key={name} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{name}</span>
                      <span className="text-sm tabular-nums">{g.total}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Leader: {g.leader}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {[...g.errors.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([e, n]) => `${e} (${n})`)
                        .join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
