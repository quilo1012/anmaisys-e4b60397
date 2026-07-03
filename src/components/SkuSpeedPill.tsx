import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Sparkles, TrendingDown } from "lucide-react";
import { useSkuSpeedSuggestion, isBelowHistoricalAverage } from "@/hooks/useSkuSpeedSuggestion";

interface Props {
  lineId?: string | null;
  skuId?: string | null;
  /** Optional current units/hour. When provided, the pill turns orange if it's >15% below the 30-day avg. */
  currentUph?: number | null;
  className?: string;
  lineName?: string | null;
}

/**
 * Small inline pill that shows the 30-day moving-average units/hr for a SKU on a Line,
 * and highlights orange when the current run rate is more than 15% below that average.
 * Silent (renders nothing) when there's no history or the RPC returns no samples.
 */
export function SkuSpeedPill({ lineId, skuId, currentUph, className, lineName }: Props) {
  const q = useSkuSpeedSuggestion(lineId, skuId);
  const s = q.data;
  if (!s || !s.avg_uph || s.sample_size === 0) return null;

  const below = currentUph != null && currentUph > 0 && isBelowHistoricalAverage(currentUph, s.avg_uph);

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-normal",
        below
          ? "border-orange-500/60 bg-orange-500/10 text-orange-600 dark:text-orange-400"
          : "border-primary/30 text-muted-foreground",
        className,
      )}
      title={`Based on the last ${s.window_days} days (${s.sample_size} shift${s.sample_size === 1 ? "" : "s"})`}
    >
      {below ? <TrendingDown className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
      Based on last {s.window_days} days: ~{s.avg_uph.toLocaleString()} units/hr
      {lineName ? ` on ${lineName}` : ""}
      {below && currentUph ? ` · current ~${Math.round(currentUph).toLocaleString()}` : ""}
    </Badge>
  );
}
