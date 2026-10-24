import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, UserCheck, UserX } from "lucide-react";
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
  not_checked: "border-warning/40 bg-warning/10 text-warning-strong",
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
 * because the clock moved: until somebody records it, it is "Not yet checked".
 * Present and Absent can be marked once the overtime has started; a sick call can be
 * recorded at any time. Every mark goes through `record_overtime_outcome`, which
 * checks the role in the database and writes the overtime audit, so a correction
 * keeps the earlier entry.
 *
 * Hidden from anybody who does not manage overtime: they cannot read the answers.
 */
export function OvertimeAttendancePanel({ date, shift }: { date: string; shift: "Day" | "Night" }) {
  const { can } = useRole();
  const mayRecord = can("overtime.manage");
  const { data: asks = [], isError } = useOvertimeAttendance(date, shift, mayRecord);
  if (!mayRecord || (asks.length === 0 && !isError)) return null;

  return (
    <Card className="no-print">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <UserCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
          Overtime attendance — {shift} board
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError && <p className="text-sm text-destructive">Overtime attendance could not be read. Refresh to try again.</p>}
        {asks.map((a) => <AskBlock key={a.request.id} ask={a} />)}
      </CardContent>
    </Card>
  );
}

function AskBlock({ ask }: { ask: AskAttendance }) {
  const { request, rows } = ask;
  const s = attendanceSummary(rows);
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
          <Badge variant="outline" className={cn("font-normal", s.unconfirmed > 0 ? ATTENDANCE_TONE.not_checked : "")}>
            Not yet checked {s.unconfirmed}
          </Badge>
        </div>
      </div>
      {started && s.unconfirmed > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-warning-strong">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {s.unconfirmed} accepted overtime with no attendance recorded yet.
        </p>
      )}
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
            disabled={busy || !started} onClick={() => mark("no_show", "absent")}
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
