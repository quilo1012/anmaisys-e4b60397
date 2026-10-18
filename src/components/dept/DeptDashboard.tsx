import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useRole } from "@/hooks/useRole";
import type { Action } from "@/lib/permissions";

/** Clickable KPI tile. Navigates only when a target is given. */
export function Kpi({ label, value, hint, to, tone }: { label: string; value: ReactNode; hint?: string; to?: string; tone?: "warn" | "bad" }) {
  const navigate = useNavigate();
  const toneCls = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-500" : "text-foreground";
  return (
    <Card
      role={to ? "link" : undefined}
      tabIndex={to ? 0 : undefined}
      onClick={to ? () => navigate(to) : undefined}
      onKeyDown={to ? (e) => { if (e.key === "Enter") navigate(to); } : undefined}
      className={to ? "cursor-pointer transition-colors hover:border-primary/40" : undefined}
    >
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${toneCls}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Horizontal bars, values only — no chart library needed. */
export function Bars({ rows, empty }: { rows: { label: string; value: number }[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex justify-between"><span className="truncate">{r.label}</span><span className="tabular-nums font-medium">{r.value}</span></div>
          <div className="mt-1 h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export type QuickAction = { label: string; to: string; action: Action };

/** Shortcuts filtered by the same permission matrix the routes use. */
export function QuickActions({ items }: { items: QuickAction[] }) {
  const { can } = useRole();
  const navigate = useNavigate();
  const shown = items.filter((i) => can(i.action));
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((i) => <Button key={i.to + i.label} variant="secondary" onClick={() => navigate(i.to)}>{i.label}</Button>)}
    </div>
  );
}

export function DeptHeader({ title, subtitle, onRefresh, refreshing, children }: { title: string; subtitle: string; onRefresh: () => void; refreshing: boolean; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>
    </div>
  );
}

export function ErrorBox({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <Card><CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
      <span>{what} could not be read, so no numbers are shown.</span>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </CardContent></Card>
  );
}
