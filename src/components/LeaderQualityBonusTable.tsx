import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Trophy, Info } from "lucide-react";

// Quality points earned when an action is OPENED, regardless of resolution.
// Tweak these to re-weight severities.
export const QUALITY_POINTS: Record<Severity, number> = {
  critical: 10,
  high: 5,
  medium: 3,
  low: 1,
};

type Severity = "critical" | "high" | "medium" | "low";

export interface LeaderPerfSession {
  line: string;
  leader_name: string | null;
  target: number;
  actual: number;
}

interface Props {
  sessions: LeaderPerfSession[];
  range: { from: string; to: string };
  shift: "all" | "DAY" | "NIGHT";
  lineFilter: string;
}

type Tier = "platinum" | "gold" | "silver" | "standard";
const TIER_ORDER: Tier[] = ["platinum", "gold", "silver", "standard"];
const TIER_BONUS: Record<Tier, number> = { platinum: 15, gold: 10, silver: 5, standard: 0 };
const TIER_LABEL: Record<Tier, string> = {
  platinum: "Platinum",
  gold: "Gold",
  silver: "Silver",
  standard: "Standard",
};
const TIER_STYLE: Record<Tier, string> = {
  platinum: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/40",
  gold: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/40",
  silver: "bg-slate-400/15 text-slate-600 dark:text-slate-300 border-slate-400/40",
  standard: "bg-muted text-muted-foreground border-border",
};

function computeTier(pct: number, pending: number): Tier {
  if (pending > 0) return "standard";
  if (pct >= 100) return "platinum";
  if (pct >= 98) return "gold";
  if (pct >= 95) return "silver";
  return "standard";
}

function normName(n: string | null | undefined): string {
  return (n ?? "").trim().toLowerCase();
}

export function LeaderQualityBonusTable({ sessions, range, shift, lineFilter }: Props) {
  const { data: activeLeaders } = useQuery({
    queryKey: ["leader-bonus-active-leaders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("line_leaders")
        .select("name")
        .eq("active", true);
      if (error) throw error;
      return (data ?? []) as { name: string }[];
    },
  });

  const { data: qualityActions = [] } = useQuery({
    queryKey: ["leader-bonus-quality", range.from, range.to, shift, lineFilter],
    queryFn: async () => {
      let q = supabase
        .from("quality_actions")
        .select("leader_name, severity, status, line, shift, recorded_at")
        .gte("recorded_at", range.from)
        .lte("recorded_at", `${range.to}T23:59:59`);
      if (shift !== "all") q = q.eq("shift", shift);
      if (lineFilter !== "__all__") q = q.eq("line", lineFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as {
        leader_name: string | null;
        severity: string | null;
        status: string | null;
      }[];
    },
    refetchInterval: 30_000,
  });

  const rows = useMemo(() => {
    // Registered active leaders (case-insensitive). Fallback: if the list is
    // empty or failed to load, don't gate the table — show everything.
    const allowedSet = new Set((activeLeaders ?? []).map((l) => normName(l.name)));
    const gateOn = allowedSet.size > 0;

    type Row = {
      leader: string;
      target: number;
      actual: number;
      pending: number;
      opened: number;
      points: number;
      sev: { critical: number; high: number; medium: number; low: number };
    };
    const map = new Map<string, Row>();
    const ensure = (name: string): Row => {
      const key = normName(name);
      let r = map.get(key);
      if (!r) {
        r = {
          leader: name.trim(),
          target: 0,
          actual: 0,
          pending: 0,
          opened: 0,
          points: 0,
          sev: { critical: 0, high: 0, medium: 0, low: 0 },
        };
        map.set(key, r);
      }
      return r;
    };

    for (const s of sessions) {
      if (!s.leader_name) continue;
      if (gateOn && !allowedSet.has(normName(s.leader_name))) continue;
      const r = ensure(s.leader_name);
      r.target += s.target;
      r.actual += s.actual;
    }

    for (const a of qualityActions) {
      if (!a.leader_name) continue;
      if (gateOn && !allowedSet.has(normName(a.leader_name))) continue;
      const r = ensure(a.leader_name);
      r.opened += 1;
      if (a.status === "todo" || a.status === "in_progress") r.pending += 1;
      const sev = (a.severity ?? "").toLowerCase() as Severity;
      if (sev === "critical" || sev === "high" || sev === "medium" || sev === "low") {
        r.sev[sev] += 1;
        r.points += QUALITY_POINTS[sev];
      }
    }

    const out = Array.from(map.values()).map((r) => {
      const pct = r.target > 0 ? (r.actual / r.target) * 100 : 0;
      const tier = computeTier(pct, r.pending);
      return { ...r, pct, tier, bonus: TIER_BONUS[tier] };
    });

    out.sort((a, b) => {
      const t = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
      if (t !== 0) return t;
      if (b.points !== a.points) return b.points - a.points;
      return b.pct - a.pct;
    });
    return out;
  }, [sessions, qualityActions, activeLeaders]);

  const exportCsv = () => {
    const header = [
      "Leader",
      "Produced",
      "Target",
      "Production %",
      "Quality Pending",
      "Quality Opened",
      "Critical",
      "High",
      "Medium",
      "Low",
      "Quality Points",
      "Bonus Tier",
      "Bonus %",
    ];
    const lines = rows.map((r) => [
      r.leader,
      r.actual,
      r.target,
      r.pct.toFixed(1),
      r.pending,
      r.opened,
      r.sev.critical,
      r.sev.high,
      r.sev.medium,
      r.sev.low,
      r.points,
      TIER_LABEL[r.tier],
      r.bonus,
    ]);
    const csv = [header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leader-line-performance_${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sevBreakdown = (r: (typeof rows)[number]) => {
    const parts: string[] = [];
    if (r.sev.critical) parts.push(`${r.sev.critical}C`);
    if (r.sev.high) parts.push(`${r.sev.high}H`);
    if (r.sev.medium) parts.push(`${r.sev.medium}M`);
    if (r.sev.low) parts.push(`${r.sev.low}L`);
    return parts.join(" ") || "—";
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-amber-500" />
              Leader Line Performance
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Real registered leaders only · production + quality · maintenance excluded
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No registered leader has production or quality data for this period.
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Leader</th>
                    <th className="py-2 pr-3">Produced / Target</th>
                    <th className="py-2 pr-3">Prod %</th>
                    <th className="py-2 pr-3">Quality (pending / opened)</th>
                    <th className="py-2 pr-3">Quality points</th>
                    <th className="py-2 pr-3">Bonus</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.leader} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{r.leader}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {r.actual.toLocaleString("en-US")} /{" "}
                        {r.target.toLocaleString("en-US")}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{r.pct.toFixed(1)}%</td>
                      <td className="py-2 pr-3 tabular-nums">
                        <span className={r.pending > 0 ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
                          {r.pending}
                        </span>{" "}
                        / {r.opened}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        <span className="font-medium">{r.points}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{sevBreakdown(r)}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={TIER_STYLE[r.tier]}>
                          {TIER_LABEL[r.tier]} {r.bonus > 0 ? `+${r.bonus}%` : ""}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile stacked cards */}
            <div className="md:hidden space-y-2">
              {rows.map((r) => (
                <div key={r.leader} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{r.leader}</div>
                    <Badge variant="outline" className={TIER_STYLE[r.tier]}>
                      {TIER_LABEL[r.tier]} {r.bonus > 0 ? `+${r.bonus}%` : ""}
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Produced / Target</div>
                      <div className="tabular-nums">
                        {r.actual.toLocaleString("en-US")} / {r.target.toLocaleString("en-US")}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Production</div>
                      <div className="tabular-nums">{r.pct.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Quality (pend/open)</div>
                      <div className="tabular-nums">
                        <span className={r.pending > 0 ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
                          {r.pending}
                        </span>{" "}
                        / {r.opened}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Points</div>
                      <div className="tabular-nums">
                        {r.points}{" "}
                        <span className="text-muted-foreground">{sevBreakdown(r)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mt-4 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
            <Info className="h-3.5 w-3.5" /> Bonus tiers &amp; points
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            <div>
              <span className="font-medium">Platinum +15%</span>: ≥100% production, 0 pending quality
            </div>
            <div>
              <span className="font-medium">Gold +10%</span>: ≥98% production, 0 pending quality
            </div>
            <div>
              <span className="font-medium">Silver +5%</span>: ≥95% production, 0 pending quality
            </div>
            <div>
              <span className="font-medium">Standard</span>: below 95% or any pending quality action
            </div>
          </div>
          <div className="mt-2">
            Quality points per opened action — Critical {QUALITY_POINTS.critical} · High{" "}
            {QUALITY_POINTS.high} · Medium {QUALITY_POINTS.medium} · Low {QUALITY_POINTS.low}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
