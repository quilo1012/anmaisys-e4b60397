import { useEffect, useMemo, useState } from "react";
import { differenceInMinutes, format } from "date-fns";
import { Filter, PowerOff, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDowntimeEvents } from "@/hooks/useDowntimeEvents";
import { formatMinutes } from "@/lib/formatDuration";

interface Props {
  workOrderId: string;
}

const ALL_USERS = "__all__";

/**
 * Full downtime history for a work order with filters by date range and by user
 * (stop/resume operator). Includes a print-friendly audit table.
 */
export function DowntimeHistorySection({ workOrderId }: Props) {
  const { data: events, isLoading } = useDowntimeEvents(workOrderId);

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>(ALL_USERS);

  // Live tick when there's an open stop
  const [, setTick] = useState(0);
  const hasOpen = (events || []).some((e) => !e.resumed_at);
  useEffect(() => {
    if (!hasOpen) return;
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [hasOpen]);

  const userOptions = useMemo(() => {
    const set = new Set<string>();
    (events || []).forEach((e) => {
      if (e.stopped_by_name) set.add(e.stopped_by_name);
      if (e.resumed_by_name) set.add(e.resumed_by_name);
    });
    return Array.from(set).sort();
  }, [events]);

  const filtered = useMemo(() => {
    let list = [...(events || [])];
    if (from) {
      const f = new Date(from + "T00:00:00").getTime();
      list = list.filter((e) => new Date(e.stopped_at).getTime() >= f);
    }
    if (to) {
      const t = new Date(to + "T23:59:59").getTime();
      list = list.filter((e) => new Date(e.stopped_at).getTime() <= t);
    }
    if (userFilter !== ALL_USERS) {
      list = list.filter(
        (e) => e.stopped_by_name === userFilter || e.resumed_by_name === userFilter,
      );
    }
    return list.sort(
      (a, b) => new Date(b.stopped_at).getTime() - new Date(a.stopped_at).getTime(),
    );
  }, [events, from, to, userFilter]);

  const totals = useMemo(() => {
    let mins = 0;
    let recurrences = 0;
    filtered.forEach((e) => {
      const dur = e.resumed_at
        ? e.duration_minutes ?? differenceInMinutes(new Date(e.resumed_at), new Date(e.stopped_at))
        : differenceInMinutes(new Date(), new Date(e.stopped_at));
      mins += dur;
      if (e.is_recurrence) recurrences += 1;
    });
    return { count: filtered.length, mins, recurrences };
  }, [filtered]);

  const hasFilters = !!from || !!to || userFilter !== ALL_USERS;
  const clearFilters = () => {
    setFrom("");
    setTo("");
    setUserFilter(ALL_USERS);
  };

  if (isLoading) return null;
  if (!events || events.length === 0) return null;

  return (
    <Card className="print:border print:border-black print:shadow-none print:rounded-none">
      <CardHeader className="print:pb-1 print:pt-2">
        <CardTitle className="text-base print:text-sm print:font-bold flex items-center gap-2">
          <PowerOff className="h-4 w-4 print:hidden" />
          Line Stop & Resume History ({events.length} {events.length === 1 ? "stop" : "stops"})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters — hidden on print */}
        <div className="print:hidden grid grid-cols-1 sm:grid-cols-4 gap-3 p-3 rounded-md bg-muted/40 border">
          <div className="space-y-1">
            <Label htmlFor="dt-from" className="text-xs flex items-center gap-1">
              <Filter className="h-3 w-3" /> From
            </Label>
            <Input
              id="dt-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dt-to" className="text-xs">To</Label>
            <Input
              id="dt-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1 sm:col-span-1">
            <Label className="text-xs">Operator / User</Label>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_USERS}>All users</SelectItem>
                {userOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-9"
              onClick={clearFilters}
              disabled={!hasFilters}
            >
              <X className="h-3.5 w-3.5 mr-1" /> Clear filters
            </Button>
          </div>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">
            {totals.count} {totals.count === 1 ? "stop" : "stops"}
          </Badge>
          <Badge variant="secondary">Total: {formatMinutes(totals.mins)}</Badge>
          {totals.recurrences > 0 && (
            <Badge variant="destructive">
              {totals.recurrences} recurrence{totals.recurrences === 1 ? "" : "s"}
            </Badge>
          )}
          {hasFilters && (
            <Badge variant="outline">Filtered (of {events.length} total)</Badge>
          )}
        </div>

        {/* Table — screen */}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6 print:hidden">
            No events match the current filters.
          </p>
        ) : (
          <div className="print:hidden rounded-md border overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 whitespace-nowrap">#</TableHead>
                  <TableHead className="whitespace-nowrap">Stopped</TableHead>
                  <TableHead className="whitespace-nowrap">Stopped by</TableHead>
                  <TableHead className="whitespace-nowrap">Reason</TableHead>
                  <TableHead className="whitespace-nowrap">Resumed</TableHead>
                  <TableHead className="whitespace-nowrap">Resumed by</TableHead>
                  <TableHead className="whitespace-nowrap">Note</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Duration</TableHead>
                  <TableHead className="whitespace-nowrap">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e, idx) => {
                  const isOpen = !e.resumed_at;
                  const dur = isOpen
                    ? differenceInMinutes(new Date(), new Date(e.stopped_at))
                    : e.duration_minutes ??
                      differenceInMinutes(new Date(e.resumed_at!), new Date(e.stopped_at));
                  return (
                    <TableRow
                      key={e.id}
                      className={isOpen ? "bg-red-500/10 hover:bg-red-500/15" : ""}
                    >
                      <TableCell className="font-mono text-xs">{filtered.length - idx}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {format(new Date(e.stopped_at), "dd/MM HH:mm")}
                      </TableCell>
                      <TableCell className="text-xs">{e.stopped_by_name || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate" title={e.stopped_reason || ""}>
                        {e.stopped_reason || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {e.resumed_at ? (
                          format(new Date(e.resumed_at), "dd/MM HH:mm")
                        ) : (
                          <span className="text-red-600 font-semibold uppercase">ongoing</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{e.resumed_by_name || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate" title={e.resumed_note || ""}>
                        {e.resumed_note || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatMinutes(dur)}
                        {isOpen && <span className="text-red-600 ml-1">(live)</span>}
                      </TableCell>
                      <TableCell>
                        {e.is_recurrence ? (
                          <Badge variant="destructive" className="text-[10px]">Recurrence</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">First</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Print — audit table (always renders all events, not filtered) */}
        <div className="hidden print:block">
          <table className="w-full text-[8pt] border-collapse">
            <thead>
              <tr>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">#</th>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Stopped</th>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Resumed</th>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Duration</th>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Stopped by</th>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Resumed by</th>
                <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, idx) => {
                const dur = e.resumed_at
                  ? e.duration_minutes ?? differenceInMinutes(new Date(e.resumed_at), new Date(e.stopped_at))
                  : differenceInMinutes(new Date(), new Date(e.stopped_at));
                return (
                  <tr key={e.id}>
                    <td className="border border-black px-2 py-1">{idx + 1}</td>
                    <td className="border border-black px-2 py-1 font-mono">
                      {format(new Date(e.stopped_at), "dd/MM HH:mm")}
                    </td>
                    <td className="border border-black px-2 py-1 font-mono">
                      {e.resumed_at ? format(new Date(e.resumed_at), "dd/MM HH:mm") : "—"}
                    </td>
                    <td className="border border-black px-2 py-1">{formatMinutes(dur)}</td>
                    <td className="border border-black px-2 py-1">{e.stopped_by_name || ""}</td>
                    <td className="border border-black px-2 py-1">{e.resumed_by_name || ""}</td>
                    <td className="border border-black px-2 py-1">{e.stopped_reason || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
