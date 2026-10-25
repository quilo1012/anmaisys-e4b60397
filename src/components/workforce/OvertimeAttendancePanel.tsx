import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, Search, UserCheck, UserX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { useOvertimeAttendance, type AskAttendance } from "@/hooks/useOvertimeAttendance";
import { useOvertimeMutations } from "@/hooks/useOvertimeRequests";
import { askHasStarted, windowLabel } from "@/lib/overtimeRequests";
import {
  ATTENDANCE_LABEL, RESPONSE_LABEL, attendanceSummary, isExpected,
  type AttendanceRow, type AttendanceState,
} from "@/lib/overtimeAttendance";

const ATTENDANCE_TONE: Record<AttendanceState, string> = {
  not_checked: "",
  present: "border-success/30 bg-success/15 text-success",
  absent: "border-destructive/30 bg-destructive/10 text-destructive",
  called_sick: "border-destructive/30 bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Overtime on this board: who accepted, and who was actually here.
 *
 * Two columns on purpose — the response is the employee's, attendance is what the
 * supervisor saw — so an accepted yes never reads as Present, and nobody turns Absent
 * because the clock moved: until somebody records it, it is "Expected".
 * Present and Absent can be marked once the overtime has started; a sick call can be
 * recorded at any time. Every mark goes through `record_overtime_outcome`, which
 * checks the role in the database and writes the overtime audit, so a correction
 * keeps the earlier entry.
 *
 * Nobody has to be marked Present: an accepted person stays in the headcount until an
 * absence is recorded. To record one, type the name — every booking of theirs on this
 * board stays, each under its own ask, so somebody with two bookings on the day is
 * marked on the one they missed and not on both. A name that only declined, or is
 * only on reserve, says so instead of offering Absent.
 *
 * Hidden from anybody who does not manage overtime: they cannot read the answers.
 */
export function OvertimeAttendancePanel({ date, shift }: { date: string; shift: "Day" | "Night" }) {
  const { can } = useRole();
  const mayRecord = can("overtime.manage");
  const { data: asks = [], isError } = useOvertimeAttendance(date, shift, mayRecord);
  const [find, setFind] = useState("");
  if (!mayRecord || (asks.length === 0 && !isError)) return null;

  const term = find.trim().toLowerCase();
  const matches = (r: AttendanceRow) => r.name.toLowerCase().includes(term);
  const found = term ? asks.flatMap((a) => a.rows.filter(matches)) : [];
  const bookable = found.filter(isExpected);
  // Everybody with the name, booked or not, so a typo and "did not accept" read differently.
  const notBooked = [...new Set(found.filter((r) => r.response !== "accepted").map((r) => r.name))]
    .filter((n) => !bookable.some((r) => r.name === n));
  const shownAsks = term ? asks.filter((a) => a.rows.some((r) => matches(r) && isExpected(r))) : asks;

  return (
    <Card className="no-print">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <UserCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
          Overtime attendance — {shift} board
        </CardTitle>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={find} onChange={(e) => setFind(e.target.value)}
            placeholder="Mark overtime absent — find a name" aria-label="Mark overtime absent — find a name"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError && <p className="text-sm text-destructive">Overtime attendance could not be read. Refresh to try again.</p>}
        {term && bookable.length === 0 && notBooked.length === 0 && (
          <p className="text-sm text-muted-foreground">Nobody called “{find.trim()}” answered overtime on this board.</p>
        )}
        {notBooked.map((n) => (
          <p key={n} className="flex items-center gap-1.5 text-sm text-warning-strong" role="status">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {n} did not accept overtime on this board, so an overtime no-show cannot be recorded.
          </p>
        ))}
        {bookable.length > 1 && new Set(bookable.map((r) => r.employeeId)).size === 1 && (
          <p className="text-sm text-muted-foreground" role="status">
            {bookable[0].name} has {bookable.length} overtime bookings on this board. Mark the one they missed.
          </p>
        )}
        {shownAsks.map((a) => <AskBlock key={a.request.id} ask={a} only={term ? matches : undefined} />)}
      </CardContent>
    </Card>
  );
}

function AskBlock({ ask, only }: { ask: AskAttendance; only?: (r: AttendanceRow) => boolean }) {
  const { request } = ask;
  const rows = only ? ask.rows.filter(only) : ask.rows;
  // The counts are the whole ask's, filtered or not; only the list narrows to the name.
  const s = attendanceSummary(ask.rows);
  const started = askHasStarted(request, new Date());
  // Everybody booked, cancelled bookings included (greyed, not counted), and anybody
  // else something was recorded about. Declined and waiting reserves are one line each.
  const shown = rows.filter((r) => r.response === "accepted" || r.attendance !== "not_checked");
  const declined = rows.filter((r) => r.response === "declined").map((r) => r.name);
  const reserve = rows.filter((r) => r.response === "reserve" && r.attendance === "not_checked").map((r) => r.name);

  return (
    <section aria-label={`Overtime ${fmtDay(request.on_date)} ${windowLabel(request.starts_at, request.ends_at)}`} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">
          {fmtDay(request.on_date)} · {windowLabel(request.starts_at, request.ends_at)}
          {request.status === "closed" && <span className="ml-2 text-xs font-normal text-muted-foreground">closed</span>}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant="outline" className="font-normal">Accepted {s.accepted}{request.headcount ? ` of ${request.headcount}` : ""}</Badge>
          <Badge variant="outline" className={cn("font-normal", ATTENDANCE_TONE.present)}>Present {s.present}</Badge>
          <Badge variant="outline" className={cn("font-normal", ATTENDANCE_TONE.absent)}>Absent {s.absent}</Badge>
          <Badge variant="outline" className="font-normal">Expected {s.unconfirmed}</Badge>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nobody is booked on this overtime.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {shown.map((r) => <PersonRow key={r.responseId} row={r} started={started} startsAt={request.starts_at} />)}
        </ul>
      )}
      {reserve.length > 0 && <p className="text-xs text-muted-foreground">On reserve: {reserve.join(", ")}</p>}
      {declined.length > 0 && (
        <p className="text-xs text-muted-foreground">Declined (not counted): {declined.join(", ")}</p>
      )}
    </section>
  );
}

function PersonRow({ row, started, startsAt }: { row: AttendanceRow; started: boolean; startsAt: string }) {
  const { recordOutcome } = useOvertimeMutations();
  const [note, setNote] = useState(row.note ?? "");
  const busy = recordOutcome.isPending;
  const canMark = isExpected(row);

  const mark = (outcome: "attended" | "no_show" | "called_sick", label: string) => {
    if (busy) return;
    recordOutcome.mutate(
      { responseId: row.responseId, outcome, note: note.trim() || undefined },
      {
        onSuccess: ({ promotedEmployeeId }) => {
          toast.success(`${row.name} marked ${label}.`, {
            description: promotedEmployeeId ? "The next person on the reserve list was moved up." : undefined,
          });
        },
        onError: (e) => toast.error((e as Error).message || "Attendance was not saved.", {
          description: "Nothing was changed.",
        }),
      },
    );
  };

  return (
    <li className="flex flex-col gap-2 p-2.5 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.name}</span>
          <Badge variant="outline" className="font-normal">{RESPONSE_LABEL[row.response]}</Badge>
          <Badge variant="outline" className={cn("font-normal", ATTENDANCE_TONE[row.attendance])}>
            {ATTENDANCE_LABEL[row.attendance]}
          </Badge>
          {row.corrected && <span className="text-xs text-muted-foreground">corrected</span>}
        </div>
        {row.recordedAt && (
          <div className="text-xs text-muted-foreground">
            Recorded {fmtWhen(row.recordedAt)}{row.recordedBy ? ` by ${row.recordedBy}` : ""}
            {row.note ? ` — “${row.note}”` : ""}
          </div>
        )}
      </div>
      {canMark && (
        <div className="flex flex-wrap items-center gap-1.5 md:shrink-0">
          <Input
            value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
            placeholder="Note (optional)" aria-label={`Note — ${row.name}`} className="h-8 w-44 text-xs"
          />
          <Button
            size="sm" variant={row.attendance === "present" ? "default" : "outline"} className="h-8"
            disabled={busy || !started} onClick={() => mark("attended", "present")}
            title={started ? undefined : `Attendance can be checked from ${startsAt.slice(0, 5)}`}
            aria-label={`Present — ${row.name}`}
          >
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
            Present
          </Button>
          <Button
            size="sm" variant={row.attendance === "absent" ? "destructive" : "outline"} className="h-8"
            disabled={busy || !started} onClick={() => mark("no_show", "Absent — Overtime No-Show")}
            title={started ? undefined : `Attendance can be checked from ${startsAt.slice(0, 5)}`}
            aria-label={`Absent — ${row.name}`}
          >
            <UserX className="mr-1 h-3.5 w-3.5" /> Absent
          </Button>
          <Button
            size="sm" variant={row.attendance === "called_sick" ? "destructive" : "ghost"} className="h-8"
            disabled={busy} onClick={() => mark("called_sick", "absent (called sick)")}
            aria-label={`Called sick — ${row.name}`}
          >
            Called sick
          </Button>
          {!started && <span className="text-xs text-muted-foreground">Check from {startsAt.slice(0, 5)}</span>}
        </div>
      )}
    </li>
  );
}
