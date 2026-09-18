import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { RagPlanHistoryRow } from "@/hooks/useRagPlanHistory";

/**
 * The story behind one Plan figure: who moved this target, when, and from what.
 *
 * Two kinds of change land in the same timeline — the line/shift plan itself, and
 * SKU-level target edits, which feed the line plan through
 * sync_items_target_from_rag. Showing only the first made targets appear to move
 * on their own.
 *
 * The rows come from the week's single history request (see useRagPlanHistory) —
 * opening this never hits the network. The marker is a 4px dot so a dense grid
 * keeps its density; a cell with no recorded change carries no marker at all.
 */

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

function Diff({ before, after }: { before: number | null; after: number | null }) {
  const diff = before !== null && after !== null ? after - before : null;
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span className="text-muted-foreground line-through">{fmtQty(before)}</span>
      <span className="text-muted-foreground">→</span>
      <span className="font-semibold">{fmtQty(after)}</span>
      {diff !== null && diff !== 0 && (
        <span className={cn("font-semibold", diff > 0 ? "text-success-strong" : "text-destructive-strong")}>
          {diff > 0 ? "+" : "−"}{Math.abs(diff).toLocaleString("en-GB")}
        </span>
      )}
    </span>
  );
}

type TimelineItem =
  | { type: "line"; at: string; user: string | null; row: RagPlanHistoryRow }
  | { type: "sku"; at: string; user: string | null; rows: RagPlanHistoryRow[] };

/**
 * One edit on the production screen can touch a dozen SKUs at once and logs a row
 * for each. Those share a timestamp and a user, so they are folded into a single
 * entry — thirty rows in a popover is not readable.
 */
export function buildTimeline(history: RagPlanHistoryRow[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const skuGroups = new Map<string, RagPlanHistoryRow[]>();

  for (const h of history) {
    if (h.kind === "sku") {
      // Group to the minute: one save, one entry.
      const key = `${h.changed_at.slice(0, 16)}|${h.user_name ?? ""}`;
      const list = skuGroups.get(key);
      if (list) list.push(h);
      else skuGroups.set(key, [h]);
    } else {
      items.push({ type: "line", at: h.changed_at, user: h.user_name, row: h });
    }
  }

  for (const rows of skuGroups.values()) {
    items.push({ type: "sku", at: rows[0].changed_at, user: rows[0].user_name, rows });
  }

  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export function PlanHistoryPopover({
  value,
  history,
  line,
  shift,
  dateLabel,
  align = "end",
  markerOnly = false,
}: {
  /** The cell itself, rendered as the popover trigger. */
  value?: React.ReactNode;
  history: RagPlanHistoryRow[];
  line: string;
  shift: string;
  dateLabel: string;
  align?: "start" | "center" | "end";
  /** Editable cells keep their input; only the dot opens the history. */
  markerOnly?: boolean;
}) {
  const hasHistory = history.length > 0;
  const timeline = buildTimeline(history);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            markerOnly
              // Zero-footprint marker: floats over the input's top-right corner,
              // so the input keeps its full width.
              ? "absolute -top-0.5 right-0 z-10 inline-flex h-3 w-3 items-center justify-center"
              // The dot is absolutely positioned against the cell — it occupies
              // no horizontal space, so the number renders exactly as wide as before.
              : "relative inline-flex w-full items-center justify-end px-0.5 text-right",
          )}
          aria-label={
            hasHistory
              ? `Target history — ${timeline.length} change${timeline.length === 1 ? "" : "s"}`
              : "Target history"
          }
          title={hasHistory ? `${timeline.length} recorded change${timeline.length === 1 ? "" : "s"} — click to see who and when` : "Target history"}
        >
          {!markerOnly && value}
          {hasHistory && (
            <span
              aria-hidden
              className={cn(
                "h-1 w-1 rounded-full bg-primary/70",
                !markerOnly && "absolute right-0 top-0",
              )}
            />
          )}
        </button>
      </PopoverTrigger>

      {/* Wide touch targets and generous rows: this board is read on a shop-floor tablet. */}
      <PopoverContent align={align} className="w-[380px] max-w-[92vw] p-0">
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
          <div className="max-h-[320px] overflow-y-auto divide-y">
            {timeline.map((item, i) => (
              <div key={`${item.at}-${item.type}-${i}`} className="px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{who(item.user)}</span>
                  <span className="tabular-nums text-muted-foreground">{fmtWhen(item.at)}</span>
                </div>

                {item.type === "line" ? (
                  <div className="mt-1">
                    <Diff
                      before={item.row.before_qty === null ? null : Number(item.row.before_qty)}
                      after={item.row.after_qty === null ? null : Number(item.row.after_qty)}
                    />
                  </div>
                ) : (
                  <div className="mt-1 space-y-1">
                    <div className="text-2xs uppercase tracking-wide text-muted-foreground">
                      {item.rows.length === 1
                        ? "SKU target"
                        : `${item.rows.length} SKU targets`}
                    </div>
                    {item.rows.slice(0, 4).map((r, k) => (
                      <div key={`${r.sku_code}-${k}`} className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{r.sku_code ?? "SKU"}</span>
                        <span className="text-muted-foreground">·</span>
                        <Diff
                          before={r.before_qty === null ? null : Number(r.before_qty)}
                          after={r.after_qty === null ? null : Number(r.after_qty)}
                        />
                      </div>
                    ))}
                    {item.rows.length > 4 && (
                      <div className="text-muted-foreground">
                        and {item.rows.length - 4} more SKU{item.rows.length - 4 === 1 ? "" : "s"} in the same edit
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
