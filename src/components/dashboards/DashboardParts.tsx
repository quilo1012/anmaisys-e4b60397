import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { can, type Action } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * The pieces every department dashboard is built from, so the Production and the
 * Maintenance dashboards — and the ones after them — read as one system: the same
 * panel, the same bar list, the same alert row, the same shortcut tile. The KPI card
 * is the existing `KpiCard`; nothing here redraws it.
 */

/** A titled card with its own loading, error and "open the screen" link. */
export function Panel({ title, description, to, toLabel, loading, error, onRetry, children, className }: {
  title: string;
  description?: string;
  /** The screen this panel summarises. */
  to?: string;
  toLabel?: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {to && (
          <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
            {toLabel ?? "Open"} <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label={`Loading ${title}`}>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : error ? (
          // A failed read is not an empty one: saying "nothing to show" when the
          // network dropped is how a real problem goes unseen.
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-warning-strong">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            <span>Couldn't load this. The numbers are not zero — they are missing.</span>
            {onRetry && <Button size="sm" variant="outline" className="h-8" onClick={onRetry}>Try again</Button>}
          </div>
        ) : children}
      </CardContent>
    </Card>
  );
}

export interface BarItem { label: string; count: number; hint?: string; to?: string }

/** Horizontal bars against the largest value. Text first: the bar only repeats it. */
export function BarList({ items, empty, max: maxShown = 6, unit }: {
  items: BarItem[];
  empty: string;
  max?: number;
  unit?: (n: number) => string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const shown = items.slice(0, maxShown);
  const top = Math.max(1, ...shown.map((i) => i.count));
  return (
    <ul className="space-y-2">
      {shown.map((i) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{i.label}</span>
              <span className="shrink-0 font-medium tabular-nums">{unit ? unit(i.count) : i.count}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${(i.count / top) * 100}%` }} />
            </div>
            {i.hint && <div className="mt-0.5 text-xs text-muted-foreground">{i.hint}</div>}
          </>
        );
        return (
          <li key={i.label}>
            {i.to ? <Link to={i.to} className="block rounded-sm hover:bg-muted/50">{body}</Link> : body}
          </li>
        );
      })}
      {items.length > maxShown && (
        <li className="text-xs text-muted-foreground">and {items.length - maxShown} more</li>
      )}
    </ul>
  );
}

export interface AlertItem {
  tone: "stop" | "hold" | "info";
  text: string;
  detail?: string;
  to?: string;
}

const ALERT_ICON: Record<AlertItem["tone"], LucideIcon> = { stop: AlertTriangle, hold: AlertTriangle, info: Info };
const ALERT_TONE: Record<AlertItem["tone"], string> = {
  stop: "text-destructive-strong",
  hold: "text-warning-strong",
  info: "text-muted-foreground",
};

/** What needs somebody, worst first. An empty list says so in words. */
export function AlertList({ items, clear }: { items: AlertItem[]; clear: string }) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> {clear}
      </p>
    );
  }
  const order = { stop: 0, hold: 1, info: 2 } as const;
  return (
    <ul className="divide-y">
      {[...items].sort((a, b) => order[a.tone] - order[b.tone]).map((a) => {
        const Icon = ALERT_ICON[a.tone];
        const body = (
          <div className="flex items-start gap-2 py-2 text-sm">
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ALERT_TONE[a.tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{a.text}</div>
              {a.detail && <div className="text-xs text-muted-foreground">{a.detail}</div>}
            </div>
            {a.to && <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
          </div>
        );
        return <li key={a.text}>{a.to ? <Link to={a.to} className="block hover:bg-muted/40">{body}</Link> : body}</li>;
      })}
    </ul>
  );
}

export interface Shortcut { label: string; to: string; icon: LucideIcon; action: Action; hint?: string }

/** Shortcuts to the department's screens — only those the role can open. */
export function QuickActions({ items }: { items: Shortcut[] }) {
  const { role } = useAuth();
  const allowed = items.filter((i) => can(role, i.action));
  if (allowed.length === 0) return null;
  return (
    <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {allowed.map(({ label, to, icon: Icon, hint }) => (
        <Link
          key={to + label}
          to={to}
          className="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted/50"
          title={hint}
        >
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Said in place of a section the role may not see, so the page does not look broken. */
export function NotYours({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
      {what} is not shown: your role can't open the screen it comes from.
    </p>
  );
}
