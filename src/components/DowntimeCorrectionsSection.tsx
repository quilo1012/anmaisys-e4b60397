import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRight } from "lucide-react";
import { useDowntimeCorrectionsInRange } from "@/hooks/useDowntimeCorrections";
import { correctionInRange, correctionLineLabel, correctionStoppageMs } from "@/lib/downtimeCorrectionsRange";

/**
 * A record of every downtime figure a person changed after the fact, for the days
 * on screen. Filed under the stoppage's own start time — a Monday stop corrected on
 * Friday is a Monday row — so this section explains the numbers above it.
 */
export function DowntimeCorrectionsSection({
  from,
  to,
  lineFilter,
}: {
  from: Date;
  to: Date;
  lineFilter: string;
}) {
  const navigate = useNavigate();
  const { data, isLoading } = useDowntimeCorrectionsInRange(from, to);

  const rows = useMemo(() => {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    return (data || [])
      .filter((r) => correctionInRange(r, fromMs, toMs, lineFilter))
      .sort((a, b) => (correctionStoppageMs(b) ?? 0) - (correctionStoppageMs(a) ?? 0));
  }, [data, from, to, lineFilter]);

  const fig = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : `${n} min`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Corrections</CardTitle>
        <CardDescription>
          Downtime figures a person changed after the fact. The original stoppage record is never
          overwritten, and a correction cannot be edited or deleted by anyone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No downtime figure was corrected in this range.
          </p>
        ) : (
          <>
            <div className="md:hidden space-y-3">
              {rows.map((r) => (
                <div key={r.id} className="rounded-lg border bg-card p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{correctionLineLabel(r)}</p>
                      <p className="text-xs text-muted-foreground">{r.machine || "—"}</p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {r.stopped_at ? format(new Date(r.stopped_at), "dd/MM HH:mm") : "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-figure">{fig(r.prev_duration_minutes)}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-figure font-semibold">{fig(r.new_duration_minutes)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.corrected_by_name} · {format(new Date(r.corrected_at), "dd/MM HH:mm")}
                  </p>
                  <p className="text-sm">{r.reason}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-11 w-full touch-manipulation"
                    onClick={() => navigate(`/dashboard/wo/${r.work_order_id}`)}
                  >
                    Open WO
                  </Button>
                </div>
              ))}
            </div>

            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Stoppage</TableHead>
                  <TableHead>Line</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Corrected by</TableHead>
                  <TableHead>Corrected at</TableHead>
                  <TableHead className="w-[32%] min-w-[240px]">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {r.stopped_at ? format(new Date(r.stopped_at), "dd/MM HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="font-medium">{correctionLineLabel(r)}</TableCell>
                    <TableCell>{r.machine || "—"}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/dashboard/wo/${r.work_order_id}`)}
                      >
                        Open WO
                      </Button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <span className="font-figure">{fig(r.prev_duration_minutes)}</span>
                      <ArrowRight className="inline h-3.5 w-3.5 mx-1.5 text-muted-foreground align-[-2px]" />
                      <span className="font-figure font-semibold">{fig(r.new_duration_minutes)}</span>
                    </TableCell>
                    <TableCell className="text-sm">{r.corrected_by_name}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {format(new Date(r.corrected_at), "dd/MM HH:mm")}
                    </TableCell>
                    {/* Real width: the app wraps mid-word globally, so a narrow
                        cell would break the reason letter by letter. */}
                    <TableCell className="text-sm w-[32%] min-w-[240px] whitespace-normal">
                      {r.reason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
