import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ClipboardList, Clock, ExternalLink,
  Gauge, RotateCcw, Search, Timer, Wrench,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { DateRangeFilter, getPresetRange, type DateRange, type DateRangePreset } from "@/components/DateRangeFilter";
import { useMaintenanceProblemAnalysis } from "@/hooks/useMaintenanceProblemAnalysis";
import { useRole } from "@/hooks/useRole";
import { formatWONumber } from "@/lib/woFormat";
import { cn } from "@/lib/utils";
import {
  computeKpis, formatHours, groupByProblem, matchesSearch, sortGroups, STATUS_LABEL,
  type AnalysisRow, type GroupSortKey, type ProblemGroup, type StatusBucket,
} from "@/lib/maintenanceProblemAnalysis";

const DEFAULT_PRESET: DateRangePreset = "30d";
const QUICK: Array<{ preset: DateRangePreset; label: string }> = [
  { preset: "7d", label: "Last 7 days" },
  { preset: "30d", label: "Last 30 days" },
  { preset: "90d", label: "Last 90 days" },
  { preset: "month", label: "This month" },
];

const BUCKET_TONE: Record<StatusBucket, string> = {
  open: "bg-destructive/10 text-destructive-strong border-destructive/30",
  in_progress: "bg-warning/10 text-warning-strong border-warning/30",
  closed: "bg-success/10 text-success-strong border-success/30",
  force_closed: "bg-muted text-muted-foreground",
  rejected: "bg-muted text-muted-foreground",
  other: "bg-muted text-muted-foreground",
};

function StatusBadge({ status, bucket }: { status: string; bucket: StatusBucket }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", BUCKET_TONE[bucket])}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/** London wall-clock — the factory's timezone, whatever the device says. */
function fmtLondon(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export default function MaintenanceProblemAnalysisPage() {
  const { can } = useRole();
  const [preset, setPreset] = useState<DateRangePreset>(DEFAULT_PRESET);
  const [range, setRange] = useState<DateRange>(() => getPresetRange(DEFAULT_PRESET));
  const [search, setSearch] = useState("");
  const [tableFilter, setTableFilter] = useState("");
  const [sortKey, setSortKey] = useState<GroupSortKey>("hours");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<string | null>(null);

  const { rows, activeRows, isLoading, error, refetch } = useMaintenanceProblemAnalysis(range);

  const matching = useMemo(() => rows.filter((r) => matchesSearch(r, search)), [rows, search]);
  const kpis = useMemo(() => computeKpis(matching), [matching]);
  const activeAllTime = useMemo(
    () => activeRows.filter((r) => matchesSearch(r, search)).length,
    [activeRows, search],
  );

  const groups = useMemo(() => {
    const all = groupByProblem(matching);
    const f = tableFilter.trim().toLowerCase();
    const filtered = f
      ? all.filter((g) => g.problem.toLowerCase().includes(f) || g.machines.some((m) => m.toLowerCase().includes(f)))
      : all;
    return sortGroups(filtered, sortKey, sortDir);
  }, [matching, tableFilter, sortKey, sortDir]);

  const selectedGroup = groups.find((g) => g.key === selected) ?? null;

  const applyPreset = (p: DateRangePreset) => {
    setPreset(p);
    setRange(getPresetRange(p));
    setSelected(null);
  };
  const reset = () => {
    applyPreset(DEFAULT_PRESET);
    setSearch("");
    setTableFilter("");
    setSortKey("hours");
    setSortDir("desc");
  };
  const toggleSort = (k: GroupSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const periodText = range.from
    ? `${format(range.from, "dd MMM yyyy")} – ${format(range.to ?? new Date(), "dd MMM yyyy")}`
    : "All time";

  const cards = [
    {
      label: "Total maintenance hours", value: formatHours(kpis.totalRepairSec), icon: Clock,
      sub: `Recorded repair time on ${kpis.ordersWithHours} of ${kpis.totalOrders} orders`,
      tint: "text-primary", bg: "bg-primary/10",
    },
    {
      label: "Total orders", value: String(kpis.totalOrders), icon: ClipboardList,
      sub: "Distinct orders raised in the period", tint: "text-primary", bg: "bg-primary/10",
    },
    {
      label: "Open orders", value: String(kpis.active), icon: AlertTriangle,
      sub: `${kpis.open} waiting · ${kpis.inProgress} in progress — raised in period. ${activeAllTime} open now, any date`,
      tint: "text-destructive-strong", bg: "bg-destructive/10",
    },
    {
      label: "Closed orders", value: String(kpis.closed), icon: CheckCircle2,
      sub: kpis.forceClosed || kpis.rejected
        ? `Finished/closed. Not counted: ${kpis.forceClosed} force-closed, ${kpis.rejected} rejected`
        : "Finished, completed or closed",
      tint: "text-success-strong", bg: "bg-success/10",
    },
    {
      label: "Average hours / order", value: formatHours(kpis.avgRepairSec), icon: Gauge,
      sub: kpis.ordersWithHours ? `Over ${kpis.ordersWithHours} orders with recorded time` : "No order has recorded time",
      tint: "text-warning-strong", bg: "bg-warning/10",
    },
    {
      label: "Line downtime", value: formatHours(kpis.totalDowntimeSec), icon: Timer,
      sub: `Separate from repair hours — ${kpis.ordersWithDowntime} orders stopped a line`,
      tint: "text-muted-foreground", bg: "bg-muted",
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          module="Maintenance"
          title="Maintenance Problem Analysis"
          description="Search a problem, pick a period, and see the hours and orders behind it"
          icon={<Wrench className="h-5 w-5" />}
        />

        {/* Filters */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setSelected(null); }}
                  placeholder="Search problem, category, machine, machine ID, line or WO number…"
                  className="pl-8"
                  aria-label="Search by problem"
                />
              </div>
              <DateRangeFilter
                value={range}
                preset={preset}
                onChange={(r, p) => { setPreset(p); setRange(r); setSelected(null); }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {QUICK.map((q) => (
                <Button
                  key={q.preset}
                  size="sm"
                  variant={preset === q.preset ? "default" : "outline"}
                  aria-pressed={preset === q.preset}
                  onClick={() => applyPreset(q.preset)}
                >
                  {q.label}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={reset}>
                <RotateCcw className="h-4 w-4 mr-1" /> Reset filters
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Period <strong>{periodText}</strong>, applied to the date each order was <strong>raised</strong> (reported),
              in factory time (Europe/London). Hours are <strong>recorded repair time</strong> — engineer start to finish,
              pauses excluded, one clock per order — the same figure MTTR uses. Line downtime is shown separately.
              Force-closed orders carry no hours. Warehouse orders are not included.
            </p>
          </CardContent>
        </Card>

        {error ? (
          <Card>
            <CardContent className="p-6">
              <EmptyState
                icon={AlertTriangle}
                title="Could not load maintenance orders"
                description={error.message}
                action={<Button variant="outline" onClick={refetch}>Try again</Button>}
              />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              {cards.map((k) => (
                <Card key={k.label}>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className={cn("rounded-lg p-2 shrink-0", k.bg)}>
                      <k.icon className={cn("h-5 w-5", k.tint)} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-2xl font-bold leading-tight tabular-nums" data-testid={`kpi-${k.label}`}>
                        {isLoading ? "…" : k.value}
                      </div>
                      <p className="text-xs font-medium">{k.label}</p>
                      {!isLoading && <p className="text-2xs text-muted-foreground mt-0.5">{k.sub}</p>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Problem summary */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">Problems</CardTitle>
                    <CardDescription>Grouped by problem description. Select a row to see its orders.</CardDescription>
                  </div>
                  <Input
                    value={tableFilter}
                    onChange={(e) => setTableFilter(e.target.value)}
                    placeholder="Filter table…"
                    className="md:w-64"
                    aria-label="Filter problem table"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Loading maintenance orders…</p>
                ) : groups.length === 0 ? (
                  <EmptyState
                    icon={Search}
                    title="No maintenance orders match"
                    description={search ? `Nothing matches "${search}" in ${periodText.toLowerCase()}.` : `No orders were raised in ${periodText.toLowerCase()}.`}
                  />
                ) : (
                  <ProblemTable
                    groups={groups}
                    selected={selected}
                    onSelect={(k) => setSelected((s) => (s === k ? null : k))}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                )}
              </CardContent>
            </Card>

            {selectedGroup && (
              <OrdersCard group={selectedGroup} showTechnician={can("wo.view")} canOpen={can("wo.view")} />
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function SortHead({ label, k, sortKey, sortDir, onSort, className }: {
  label: string; k: GroupSortKey; sortKey: GroupSortKey; sortDir: "asc" | "desc";
  onSort: (k: GroupSortKey) => void; className?: string;
}) {
  const active = sortKey === k;
  return (
    <TableHead className={className} aria-sort={active ? (sortDir === "desc" ? "descending" : "ascending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort(k)}>
        {label}
        {active && (sortDir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </TableHead>
  );
}

function ProblemTable({ groups, selected, onSelect, sortKey, sortDir, onSort }: {
  groups: ProblemGroup[]; selected: string | null; onSelect: (k: string) => void;
  sortKey: GroupSortKey; sortDir: "asc" | "desc"; onSort: (k: GroupSortKey) => void;
}) {
  const sp = { sortKey, sortDir, onSort };
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Problem / fault</TableHead>
            <TableHead>Machine / equipment</TableHead>
            <SortHead label="Orders" k="orders" {...sp} className="text-right" />
            <SortHead label="Recorded hours" k="hours" {...sp} className="text-right" />
            <SortHead label="Open" k="open" {...sp} className="text-right" />
            <TableHead className="text-right">In progress</TableHead>
            <TableHead className="text-right">Closed</TableHead>
            <SortHead label="Most recent" k="recent" {...sp} />
            <TableHead>Current status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const latestBucket = g.rows[0]?.bucket ?? "other";
            return (
              <TableRow
                key={g.key}
                data-state={selected === g.key ? "selected" : undefined}
                className="cursor-pointer"
                onClick={() => onSelect(g.key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(g.key); } }}
                tabIndex={0}
                aria-selected={selected === g.key}
              >
                <TableCell className="font-medium min-w-[12rem]">
                  {g.problem}
                  {g.category && <div className="text-2xs text-muted-foreground">{g.category}</div>}
                </TableCell>
                <TableCell className="min-w-[8rem]" title={g.machines.join(", ")}>
                  {g.machines[0] ?? "—"}
                  {g.machines.length > 1 && <span className="text-muted-foreground"> +{g.machines.length - 1} more</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{g.kpis.totalOrders}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatHours(g.kpis.totalRepairSec)}
                  {g.kpis.ordersWithHours < g.kpis.totalOrders && (
                    <div className="text-2xs text-muted-foreground">{g.kpis.ordersWithHours}/{g.kpis.totalOrders} timed</div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{g.kpis.open}</TableCell>
                <TableCell className="text-right tabular-nums">{g.kpis.inProgress}</TableCell>
                <TableCell className="text-right tabular-nums">{g.kpis.closed}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtLondon(g.lastOccurrence)}</TableCell>
                <TableCell>
                  {g.kpis.active > 0
                    ? <Badge variant="outline" className={BUCKET_TONE.open}>{g.kpis.active} active</Badge>
                    : <StatusBadge status={g.latestStatus} bucket={latestBucket} />}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function OrdersCard({ group, showTechnician, canOpen }: { group: ProblemGroup; showTechnician: boolean; canOpen: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{group.problem}</CardTitle>
        <CardDescription>
          {group.kpis.totalOrders} orders · {formatHours(group.kpis.totalRepairSec)} recorded repair time
          {" "}({group.kpis.ordersWithHours} timed) · {formatHours(group.kpis.totalDowntimeSec)} line downtime
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Problem</TableHead>
              <TableHead>Machine</TableHead>
              <TableHead>Line</TableHead>
              <TableHead>Reported</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Finished</TableHead>
              <TableHead className="text-right">Repair hours</TableHead>
              {showTechnician && <TableHead>Technician</TableHead>}
              <TableHead>Status</TableHead>
              {canOpen && <TableHead className="sr-only">Open</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.rows.map((r: AnalysisRow) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs whitespace-nowrap">{formatWONumber(r.wo_number, r.created_at)}</TableCell>
                <TableCell className="min-w-[10rem]">{r.description || "—"}</TableCell>
                <TableCell>{r.machine || r.intouch_machine_name || "—"}</TableCell>
                <TableCell>{r.line_at_time || "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtLondon(r.created_at)}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtLondon(r.started_at)}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtLondon(r.finished_at ?? r.completed_at)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.repairSec != null ? formatHours(r.repairSec) : <span className="text-muted-foreground" title={r.bucket === "force_closed" ? "Force-closed: no recorded repair time" : "No start/finish recorded"}>—</span>}
                </TableCell>
                {showTechnician && (
                  <TableCell>
                    {r.engineer_name || "—"}
                    {r.collaborator_names && r.collaborator_names.length > 0 && (
                      <div className="text-2xs text-muted-foreground">+ {r.collaborator_names.join(", ")}</div>
                    )}
                  </TableCell>
                )}
                <TableCell><StatusBadge status={r.status} bucket={r.bucket} /></TableCell>
                {canOpen && (
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      <Link to={`/dashboard/wo/${r.id}`} aria-label={`Open ${formatWONumber(r.wo_number, r.created_at)}`}>
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
