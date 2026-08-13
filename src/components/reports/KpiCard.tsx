import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiInfoTooltip } from "@/components/KpiInfoTooltip";
import { railEdge, type RailState } from "@/components/ui/StatusRail";

/**
 * The one KPI card.
 *
 * There were seven of these — KpiCard here, another KpiCard in ManagerDashboard,
 * KpiTile in Preventive Maintenance and again in Control Center, StatusTile in the
 * status strip, SummaryTile in PM Intelligence, QualityKpi in Quality — each with its
 * own number size, colour set and spacing, so the same figure looked different
 * depending on which screen you read it on. Every prop below exists because one of
 * them needed it.
 */
export type KpiAccent =
  | "blue"
  | "indigo"
  | "amber"
  | "green"
  | "red"
  | "purple"
  | "cyan"
  | "muted"
  /** Semantic aliases, for callers that think in status rather than colour. */
  | "ok"
  | "warning"
  | "danger"
  | "info";

/**
 * O acento de cada KPI, dito em estados e não em cores.
 *
 * Era um mapa de doze cores escritas à mão, e a repetição fazia o que a repetição
 * sempre faz: quatro nomes — blue, indigo, cyan, info — para o mesmo azul, e um
 * `border-l-purple-500` que não é cor nenhuma deste sistema. Agora desce tudo do
 * `railEdge`, que é a mesma barra dos cartões de linha, à mesma largura.
 *
 * Os nomes de cor ficam por compatibilidade — há chamadores a pensar em "amber" —
 * mas passam pelo estado que essa cor sempre quis dizer.
 */
const ACCENT_STATE: Record<KpiAccent, RailState> = {
  blue: "idle",
  indigo: "idle",
  amber: "hold",
  green: "go",
  red: "stop",
  purple: "idle",
  cyan: "idle",
  muted: "idle",
  ok: "go",
  warning: "hold",
  danger: "stop",
  info: "idle",
};

/** Colour applied to the number itself, and only when it is non-zero. */
const VALUE_TONE: Partial<Record<KpiAccent, string>> = {
  warning: "text-warning-strong",
  amber: "text-warning-strong",
  danger: "text-destructive-strong",
  red: "text-destructive-strong",
  green: "text-success-strong",
  ok: "text-success-strong",
};

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** Small line under the number: what it means, or where it came from. */
  sublabel?: ReactNode;
  accent?: KpiAccent;
  loading?: boolean;
  className?: string;
  valueClassName?: string;
  /** Colour the number by the accent when it is greater than zero. */
  toneValue?: boolean;
  /** Makes the card a button — used where a KPI is also the filter for its own figure. */
  onClick?: () => void;
  /** Pressed state, for a KPI acting as an active filter. */
  active?: boolean;
  /** Red border all round, for a figure that needs answering now. */
  highlight?: boolean;
  /** Explains what the figure measures, behind an ⓘ next to the label. */
  tooltip?: string;
}

export function KpiCard({
  label,
  value,
  icon,
  sublabel,
  accent = "blue",
  loading = false,
  className,
  valueClassName,
  toneValue,
  onClick,
  active,
  highlight,
  tooltip,
}: KpiCardProps) {
  const clickable = !!onClick;
  const numeric = typeof value === "number" ? value : Number(value);
  const toned = toneValue && Number.isFinite(numeric) && numeric > 0 ? VALUE_TONE[accent] : undefined;

  return (
    <Card
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? !!active : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick!(); } }
          : undefined
      }
      className={cn(
        railEdge(ACCENT_STATE[accent]),
        highlight && "border-destructive",
        clickable && "cursor-pointer transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        clickable && active && "bg-muted/60 ring-2 ring-primary/40",
        className,
      )}
    >
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-xs font-medium">{label}</span>
          {tooltip && <KpiInfoTooltip text={tooltip} />}
        </div>
        {loading ? (
          <Skeleton className="h-8 w-20 mt-1" />
        ) : (
          <p className={cn("text-3xl font-bold leading-tight tabular-nums", toned, highlight && "text-destructive-strong", valueClassName)}>
            {value}
          </p>
        )}
        {sublabel && !loading && (
          <p className="text-2xs text-muted-foreground mt-1 leading-snug">{sublabel}</p>
        )}
      </CardContent>
    </Card>
  );
}
