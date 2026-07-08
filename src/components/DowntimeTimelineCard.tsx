import { useEffect, useState } from "react";
import { differenceInMinutes, differenceInSeconds, format } from "date-fns";
import { PowerOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/formatDuration";
import { useDowntimeEvents } from "@/hooks/useDowntimeEvents";

interface Props {
  workOrderId: string;
}

/**
 * Renders the full timeline of line stops for a single work order.
 * Both screen (rich) and print (audit table) variants are emitted.
 */
export function DowntimeTimelineCard({ workOrderId }: Props) {
  const { data: events, isLoading } = useDowntimeEvents(workOrderId);

  // Live tick for any open stop
  const [, setTick] = useState(0);
  const hasOpen = (events || []).some((e) => !e.resumed_at);
  useEffect(() => {
    if (!hasOpen) return;
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [hasOpen]);

  if (isLoading) return null;
  if (!events || events.length === 0) return null;

  // Compute durations in seconds from real timestamps — duration_minutes is rounded
  // in the DB and reports 0 for sub-minute stops (e.g. quick resumes).
  const eventSeconds = (e: typeof events[number]) =>
    e.resumed_at
      ? Math.max(0, differenceInSeconds(new Date(e.resumed_at), new Date(e.stopped_at)))
      : Math.max(0, differenceInSeconds(new Date(), new Date(e.stopped_at)));
  const totalSeconds = events.reduce((sum, e) => sum + eventSeconds(e), 0);
  const ongoing = events.find((e) => !e.resumed_at);
  const ongoingSeconds = ongoing ? eventSeconds(ongoing) : 0;

  return (
    <Card className="print:border print:border-black print:shadow-none print:rounded-none">
      <CardHeader className="print:pb-1 print:pt-2">
        <CardTitle className="text-base print:text-sm print:font-bold flex items-center gap-2">
          <PowerOff className="h-4 w-4 print:hidden" />
          Line Stop History ({events.length} {events.length === 1 ? "stop" : "stops"})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* SCREEN — rich list */}
        <div className="space-y-3 print:hidden">
          {events.map((e, idx) => {
            const isOpen = !e.resumed_at;
            const dur = isOpen
              ? differenceInMinutes(new Date(), new Date(e.stopped_at))
              : (e.duration_minutes ?? 0);
            return (
              <div
                key={e.id}
                className={`rounded-md border p-3 ${
                  isOpen ? "border-red-500 bg-red-500/10" : "border-border bg-muted/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-sm">
                    🛑 Stop #{idx + 1}
                    {isOpen && <span className="ml-2 text-red-600 uppercase text-xs">— in progress</span>}
                  </p>
                  <span className="text-xs font-mono">
                    {dur}m{isOpen ? " (live)" : ""}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(e.stopped_at), "dd/MM HH:mm")}
                  {e.resumed_at ? ` → ${format(new Date(e.resumed_at), "dd/MM HH:mm")}` : " → now"}
                </p>
                {e.stopped_by_name && (
                  <p className="text-xs mt-1">
                    Stopped by: <span className="font-medium">{e.stopped_by_name}</span>
                  </p>
                )}
                {e.stopped_reason && (
                  <p className="text-xs mt-0.5 italic">"{e.stopped_reason}"</p>
                )}
                {e.resumed_by_name && (
                  <p className="text-xs mt-1">
                    Resumed by: <span className="font-medium">{e.resumed_by_name}</span>
                  </p>
                )}
              </div>
            );
          })}
          <div className="border-t pt-2 text-sm font-semibold">
            TOTAL: {events.length} stop{events.length === 1 ? "" : "s"} · {totalMinutes}m downtime
            {ongoing && <span className="text-red-600 ml-1">(includes {ongoingMinutes}m ongoing)</span>}
          </div>
        </div>

        {/* PRINT — audit table */}
        <div className="hidden print:block">
          <table className="w-full text-[8pt] border-collapse">
            <thead>
              <tr>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">#</th>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Stopped</th>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Resumed</th>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Duration</th>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Stopped by</th>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, idx) => {
                const dur = e.resumed_at
                  ? (e.duration_minutes ?? 0)
                  : differenceInMinutes(new Date(), new Date(e.stopped_at));
                return (
                  <tr key={e.id}>
                    <td className="border border-black px-2 py-1">{idx + 1}</td>
                    <td className="border border-black px-2 py-1 font-mono">{format(new Date(e.stopped_at), "dd/MM HH:mm")}</td>
                    <td className="border border-black px-2 py-1 font-mono">
                      {e.resumed_at ? format(new Date(e.resumed_at), "dd/MM HH:mm") : "—"}
                    </td>
                    <td className="border border-black px-2 py-1">{dur}m</td>
                    <td className="border border-black px-2 py-1">{e.stopped_by_name || ""}</td>
                    <td className="border border-black px-2 py-1">{e.stopped_reason || ""}</td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={3} className="border border-black px-2 py-1 font-bold text-right">
                  TOTAL DOWNTIME
                </td>
                <td colSpan={3} className="border border-black px-2 py-1 font-bold">
                  {totalMinutes}m ({events.length} stops)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
