import { useState } from "react";
import { Figure } from "@/components/ui/Figure";
import { PageHeader } from "@/components/ui/PageHeader";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateRangeFilter, getPresetRange, type DateRange, type DateRangePreset } from "@/components/DateRangeFilter";
import { ShiftFilter } from "@/components/ShiftFilter";
import { useOpsShift, OPS_RANGE_KEY } from "@/hooks/useOpsFilters";
import { useReportSummary } from "@/hooks/useReportSummary";
import { FileBarChart, Gauge, Clock, Wrench, AlertTriangle, ChevronRight, Printer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BackButton } from "@/components/BackButton";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** `4h 10m`, or `—` when there is nothing to show. */
function mins(n: number): string {
  if (!n) return "—";
  return n < 60 ? `${n}m` : `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, "0")}m`;
}

function Section({
  title, icon: Icon, accent, to, onOpen, children,
}: {
  title: string; icon: LucideIcon; accent: string; to: string;
  onOpen: (url: string) => void; children: React.ReactNode;
}) {
  return (
    <Card className={`border-l-4 ${accent}`}>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {title}
          </div>
          {/* The period travels with you: every screen reads the same stored range,
              so the detail opens on exactly the window summarised here. */}
          <Button variant="ghost" size="sm" className="h-7 text-xs print:hidden" onClick={() => onOpen(to)}>
            Detail <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{children}</div>
      </CardContent>
    </Card>
  );
}

/**
 * One period, four areas, one page.
 *
 * Production, downtime, maintenance and quality each had a screen that could export
 * its own corner of the week, and nowhere put them together — so "how did last month
 * go" meant opening four screens and setting four date ranges. This asks the
 * question once.
 *
 * It is a summary, not a fifth source. Every figure comes from the same place its own
 * screen reads, and each section links through to that screen on the same period, so
 * the number here and the number there cannot drift apart.
 */
export default function ReportsPage() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<DateRangePreset>("7d");
  const [range, setRange] = useState<DateRange>(() => getPresetRange("7d"));
  const [shift, setShift] = useOpsShift();

  const from = range.from ? iso(range.from) : iso(new Date());
  const to = range.to ? iso(range.to) : from;
  const { data } = useReportSummary(from, to, shift);
  const s = data!;

  const periodLabel = from === to
    ? format(new Date(`${from}T00:00:00`), "EEEE d MMMM yyyy")
    : `${format(new Date(`${from}T00:00:00`), "d MMM")} — ${format(new Date(`${to}T00:00:00`), "d MMM yyyy")}`;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* Off the paper: this page prints, and the Print button beside it is already
          dropped by the print stylesheet. */}
      <BackButton className="print:hidden" />

      <PageHeader
        icon={<FileBarChart className="h-5 w-5 text-muted-foreground" />}
        title="Reports"
        description={`${periodLabel}${shift !== "ALL" ? ` · ${shift === "DAY" ? "Day shift" : "Night shift"}` : ""}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <DateRangeFilter
          value={range}
          preset={preset}
          onChange={(r, p) => { setRange(r); setPreset(p); }}
          storageKey={OPS_RANGE_KEY}
        />
        <ShiftFilter value={shift} onChange={setShift} />
      </div>

      <Section title="Production" icon={Gauge} accent="border-l-emerald-500" to="/dashboard/production-performance" onOpen={navigate}>
        <Figure bare label="Plan" value={s.production.plan.toLocaleString()} />
        <Figure bare label="Actual" value={s.production.actual.toLocaleString()} />
        <Figure bare
          label="Efficiency"
          value={s.production.efficiencyPct == null ? "—" : `${s.production.efficiencyPct}%`}
          hint={s.production.efficiencyPct == null ? "no plan recorded" : undefined}
        />
        <Figure bare label="Days planned" value={String(s.production.days)} />
      </Section>

      <Section title="Downtime" icon={Clock} accent="border-l-amber-500" to="/dashboard/downtime" onOpen={navigate}>
        <Figure bare label="Total" value={mins(s.downtime.minutes)} />
        <Figure bare label="Stoppages" value={String(s.downtime.stops)} />
        <Figure bare
          label="Worst line"
          value={s.downtime.worstLine ?? "—"}
          hint={s.downtime.worstMinutes ? mins(s.downtime.worstMinutes) : undefined}
        />
        <Figure bare
          label="Per stoppage"
          value={s.downtime.stops ? mins(Math.round(s.downtime.minutes / s.downtime.stops)) : "—"}
        />
      </Section>

      <Section title="Maintenance" icon={Wrench} accent="border-l-sky-500" to="/dashboard/work-orders" onOpen={navigate}>
        <Figure bare label="Raised" value={String(s.maintenance.raised)} />
        <Figure bare
          label="Closed"
          value={String(s.maintenance.closed)}
          hint={s.maintenance.raised ? `${Math.round((s.maintenance.closed / s.maintenance.raised) * 100)}% of raised` : undefined}
        />
        <Figure bare label="Avg response" value={s.maintenance.avgResponseMin == null ? "—" : `${s.maintenance.avgResponseMin}m`} />
        <Figure bare label="Avg repair" value={s.maintenance.avgRepairMin == null ? "—" : `${s.maintenance.avgRepairMin}m`} />
      </Section>

      <Section title="Quality" icon={AlertTriangle} accent="border-l-rose-500" to="/dashboard/quality" onOpen={navigate}>
        <Figure bare label="Actions" value={String(s.quality.total)} />
        <Figure bare label="Still open" value={String(s.quality.open)} />
        <Figure bare label="Critical" value={String(s.quality.critical)} />
        <Figure bare
          label="Closed"
          value={String(s.quality.total - s.quality.open)}
          hint={s.quality.total ? `${Math.round(((s.quality.total - s.quality.open) / s.quality.total) * 100)}%` : undefined}
        />
      </Section>

      {/* Said plainly, because a summary that hides its own gaps is worse than no
          summary: an empty figure here means nobody recorded it, not that it was zero. */}
      <p className="text-2xs text-muted-foreground">
        A dash means nothing was recorded for that figure in this period — not that it was zero.
        Each section links to the screen it came from, on this same period.
      </p>
    </div>
  );
}
