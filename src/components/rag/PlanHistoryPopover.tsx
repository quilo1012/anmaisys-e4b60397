import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { RagPlanHistoryRow } from "@/hooks/useRagPlanHistory";

/**
 * The story behind one Plan figure: who moved this target, when, and from what.
 *
 * The rows come from the week's single history request (see useRagPlanHistory) —
 * opening this never hits the network. The marker is a 4px dot so a dense grid
 * keeps its density; a cell with no recorded change carries no marker at all.
 */
export function PlanHistoryPopover({
  value,
  history,
  line,
  shift,
  dateLabel,
  align = "end",
}: {
  /** The cell itself, rendered as the popover trigger. */
  value: React.ReactNode;
  history: RagPlanHistoryRow[];
  line: string;
  shift: string;
  dateLabel: string;
  align?: "start" | "center" | "end";
}) {
  const hasHistory = history.length > 0;

  const fmtQty = (n: number | null) =>
    n === null || n === undefined || Number.isNaN(Number(n))
      ? "—"
      : Number(n).toLocaleString("en-GB");

  // The user's own timezone, formatted the way the rest of the board reads dates.
  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });

  // A change with no name attached is still information.
  const who = (name: string | null) => {
    const s = (name ?? "").trim();
    if (!s || s.toLowerCase() === "system") return "system";
    return s;
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex w-full items-center justify-end gap-1 rounded px-0.5 text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={
            hasHistory
              ? `Target history — ${history.length} change${history.length === 1 ? "" : "s"}`
              : "Target history"
          }
          title={hasHistory ? `${history.length} recorded change${history.length === 1 ? "" : "s"} — click to see who and when` : "Target history"}
        >
          {value}
          {hasHistory && (
            <span
              aria-hidden
              className="h-1 w-1 shrink-0 rounded-full bg-primary/70"
            />
          )}
        </button>
      </PopoverTrigger>

      {/* Wide touch targets and generous rows: this board is read on a shop-floor tablet. */}
      <PopoverContent align={align} className="w-[360px] max-w-[92vw] p-0">
        <div className="border-b bg-muted/40 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {line} · {shift} · {dateLabel}
          </div>
          <div className="text-sm font-semibold">Target history</div>
        </div>

        {!hasHistory ? (
          <div className="space-y-1 px-3 py-3 text-xs text-muted-foreground">
            <p className="text-foreground">No changes recorded</p>
            <p>This target has not been edited since the row was created.</p>
            <p className="text-2xs">
              History is only kept from the day change-tracking was switched on, so an
              older target with nothing here is not proof it was never touched.
            </p>
          </div>
        ) : (
          <div className="max-h-[300px] overflow-y-auto divide-y">
            {history.map((h, i) => {
              const before = h.before_qty === null ? null : Number(h.before_qty);
              const after = h.after_qty === null ? null : Number(h.after_qty);
              const diff = before !== null && after !== null ? after - before : null;
              return (
                <div key={`${h.changed_at}-${i}`} className="px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{who(h.user_name)}</span>
                    <span className="tabular-nums text-muted-foreground">{fmtWhen(h.changed_at)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 tabular-nums">
                    <span className="text-muted-foreground line-through">{fmtQty(before)}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-semibold">{fmtQty(after)}</span>
                    {diff !== null && diff !== 0 && (
                      <span
                        className={cn(
                          "font-semibold",
                          diff > 0 ? "text-success-strong" : "text-destructive-strong",
                        )}
                      >
                        {diff > 0 ? "+" : "−"}
                        {Math.abs(diff).toLocaleString("en-GB")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
