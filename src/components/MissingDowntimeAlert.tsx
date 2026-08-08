import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronRight } from "lucide-react";

/**
 * Orders that were worked and closed without a minute of downtime against them.
 *
 * The line-stopped flag is a checkbox on the form that raises the order, and the live
 * stop control disappears the moment the order is finished. Miss the checkbox and the
 * downtime cannot be recorded afterwards — WO-2026-000808 ran eighty-five minutes on
 * Line 6A and contributed nothing to the heatmap.
 *
 * The failure is that this was invisible. The heatmap cannot show a stop nobody
 * recorded, so the number simply came out low and looked like a good week. This panel
 * is the thing that says so: not a correction, a count of what is missing.
 *
 * Rejected and force-closed orders are left out. A rejected order was never work, and
 * a force-closed one was abandoned rather than done — neither is evidence that a line
 * stood still, and listing them would bury the two that are.
 */
export function MissingDowntimeAlert({ from, to }: { from: Date; to: Date }) {
  const { data: orders = [] } = useQuery({
    queryKey: ["missing-downtime", from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const db = supabase as any;
      const { data, error } = await db
        .from("work_orders")
        .select("id, wo_number, description, machine, line_at_time, created_at, finished_at, closed_at, status")
        .eq("wo_type", "production")
        .in("status", ["finished", "closed", "completed"])
        .is("line_stopped_at", null)
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as any[];
      if (rows.length === 0) return [];

      // An order can carry downtime through an event row even with no flag on the
      // order itself, so the flag alone is not enough to call one missing.
      const { data: evts, error: e2 } = await db
        .from("downtime_events")
        .select("work_order_id")
        .in("work_order_id", rows.map((r) => r.id));
      if (e2) throw e2;
      const withDowntime = new Set((evts ?? []).map((e: any) => e.work_order_id));

      return rows
        .filter((r) => !withDowntime.has(r.id))
        .map((r) => {
          const end = r.finished_at ?? r.closed_at;
          const mins = end
            ? Math.round((Date.parse(end) - Date.parse(r.created_at)) / 60000)
            : null;
          return { ...r, mins };
        })
        // Under five minutes is a mis-tap, not a stoppage worth chasing.
        .filter((r) => r.mins == null || r.mins >= 5);
    },
  });

  if (orders.length === 0) return null;

  const total = orders.reduce((n, o) => n + (o.mins ?? 0), 0);

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {orders.length} order{orders.length === 1 ? "" : "s"} worked with no downtime recorded
            </div>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              Production orders that were finished without the line ever being marked as stopped,
              so none of this time is on the heatmap. Roughly <b>{Math.round(total / 60)}h {total % 60}m</b>{" "}
              unaccounted for. Open one to record what actually happened.
            </p>

            <div className="mt-2 space-y-1">
              {orders.slice(0, 8).map((o) => (
                <Link
                  key={o.id}
                  to={`/dashboard/wo/${o.id}`}
                  className="flex items-center gap-2 rounded-md border bg-background/60 px-2 py-1.5 text-2xs hover:bg-background"
                >
                  <Badge variant="outline" className="shrink-0 font-mono text-2xs">
                    WO-{o.wo_number}
                  </Badge>
                  <span className="shrink-0 font-medium">{o.line_at_time ?? o.machine ?? "—"}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{o.description}</span>
                  {o.mins != null && (
                    <span className="shrink-0 font-mono tabular-nums text-warning-strong">
                      {Math.floor(o.mins / 60)}h {String(o.mins % 60).padStart(2, "0")}m
                    </span>
                  )}
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                </Link>
              ))}
              {orders.length > 8 && (
                <div className="px-2 text-2xs text-muted-foreground">
                  and {orders.length - 8} more
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
