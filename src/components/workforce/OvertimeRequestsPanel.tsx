import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/DateField";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Users, Check, Clock, X, UserPlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useOvertimeRequests, useOvertimeResponses, useOvertimeReliability, useOvertimeOutcomes,
  useOvertimeMutations, useOvertimeRoster, type RosterName,
} from "@/hooks/useOvertimeRequests";
import {
  countResponses, sortCandidates, reliabilityTone, reliabilityLabel, attendedLabel, blockedLabel,
  windowLabel, type OvertimeRequest, type OvertimeOutcome, type Candidate,
} from "@/lib/overtimeRequests";
import { OvertimeRulesDialog } from "@/components/workforce/OvertimeRulesDialog";

const fmtDate = (d: string) => d.split("-").reverse().join("/");
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const TONE_CLASS = {
  good: "bg-success/15 text-success border-success/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  bad: "bg-destructive/15 text-destructive border-destructive/30",
} as const;

const OUTCOMES: { value: OvertimeOutcome; label: string }[] = [
  { value: "attended", label: "Turned up" },
  { value: "called_sick", label: "Called sick" },
  { value: "no_show", label: "No show" },
  // One "Cancelled": the clock and the rule decide whether it was in time or late.
  { value: "cancelled", label: "Cancelled" },
];
// What the database stored, when it was one of the two it decides between.
const STORED_LABEL: Record<string, string> = {
  cancelled_in_time: "Cancelled in time", cancelled_late: "Cancelled late",
};

/**
 * The supervisor's side of overtime: ask, choose, then say what happened.
 *
 * One ask per card. The header carries the count the whole thing is read for —
 * "Needs 4 · 7 interested · 2 accepted" — and the rows carry the number beside the
 * name that this module exists to show: how many times this month the person did not
 * turn up. The supervisor still chooses; the list only puts the likely choice first.
 */
export function OvertimeRequestsPanel() {
  const { data: requests = [], isLoading } = useOvertimeRequests();
  const [creating, setCreating] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const today = iso(new Date());
  const visible = useMemo(
    () => requests.filter((r) => showPast || r.on_date >= today || r.status === "open"),
    [requests, showPast, today],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          Overtime asks — who was asked, who said yes, who was picked.
        </div>
        <div className="flex items-center gap-2">
          <OvertimeRulesDialog />
          <Button variant="ghost" size="sm" onClick={() => setShowPast((v) => !v)}>
            {showPast ? "Hide past" : "Show past 14 days"}
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> New ask
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!isLoading && visible.length === 0 && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          No overtime asked for. Press "New ask" when you need people.
        </CardContent></Card>
      )}
      {visible.map((r) => <RequestCard key={r.id} request={r} />)}

      <NewRequestDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: employees = [] } = useOvertimeRoster();
  const { createRequest } = useOvertimeMutations();
  const [onDate, setOnDate] = useState(iso(new Date(Date.now() + 86_400_000)));
  const [startsAt, setStartsAt] = useState("06:00");
  const [endsAt, setEndsAt] = useState("14:00");
  const [headcount, setHeadcount] = useState("4");
  const [department, setDepartment] = useState<string>("all");
  const [shiftGroup, setShiftGroup] = useState<string>("all");
  const [note, setNote] = useState("");

  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean) as string[])).sort(),
    [employees],
  );
  const shiftGroups = useMemo(
    () => Array.from(new Set(employees.map((e) => e.shift_group).filter(Boolean) as string[])).sort(),
    [employees],
  );

  const submit = () => {
    const n = Number(headcount);
    if (!onDate) { toast.error("Pick a date."); return; }
    if (!Number.isInteger(n) || n <= 0) { toast.error("How many people? A whole number above zero."); return; }
    if (startsAt === endsAt) { toast.error("Start and end cannot be the same time."); return; }
    createRequest.mutate(
      {
        on_date: onDate, starts_at: startsAt, ends_at: endsAt, headcount: n,
        department: department === "all" ? null : department,
        shift_group: shiftGroup === "all" ? null : shiftGroup,
        note: note.trim() || null,
      },
      {
        onSuccess: ({ push }) => {
          const head = `Asked for ${n} on ${fmtDate(onDate)}`;
          if (push.error) toast.warning(`${head} — but the notification didn't go: ${push.error}`);
          else if (push.notified === 0) toast.success(`${head}. Nobody has a login yet, so nobody was notified.`);
          else if (push.note) toast.warning(`${head} · ${push.notified} told in-app, no phones buzzed: ${push.note}`);
          else if (push.pushed === 0) toast.success(`${head} · ${push.notified} told in-app · nobody has turned on phone notifications yet`);
          else toast.success(`${head} · ${push.notified} told · ${push.pushed ?? 0} phone${push.pushed === 1 ? "" : "s"} buzzed`);
          onOpenChange(false); setNote("");
        },
        onError: (e) => toast.error((e as Error).message || "Could not create the ask"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ask for overtime</DialogTitle>
          <DialogDescription>Say when and how many. Everyone it applies to will see it and answer yes or no.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Date</Label>
            <DateField value={onDate} onChange={setOnDate} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ot-start">From</Label>
              <Input id="ot-start" type="time" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ot-end">To</Label>
              <Input id="ot-end" type="time" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ot-n">People needed</Label>
            <Input id="ot-n" type="number" min={1} inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Shift</Label>
              <Select value={shiftGroup} onValueChange={setShiftGroup}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any shift</SelectItem>
                  {shiftGroups.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ot-note">Note (optional)</Label>
            <Textarea id="ot-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Line 3, packing. Bring safety boots." />
          </div>
          <Button onClick={submit} disabled={createRequest.isPending}>
            {createRequest.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Post the ask
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RequestCard({ request }: { request: OvertimeRequest }) {
  const { data: employees = [] } = useOvertimeRoster();
  const { data: responses = [] } = useOvertimeResponses(request.id);
  const { data: reliability } = useOvertimeReliability();
  const { setRequestStatus, decide, recordOutcome, answerFor } = useOvertimeMutations();
  const [addingFor, setAddingFor] = useState<string>("");

  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const counts = countResponses(request, responses);
  const isPast = request.on_date < iso(new Date());

  const candidates: Candidate<RosterName>[] = useMemo(() => sortCandidates(
    responses
      .filter((r) => r.answer === "yes" && byId.has(r.employee_id))
      .map((r) => ({ employee: byId.get(r.employee_id)!, response: r, reliability: reliability?.get(r.employee_id) })),
  ), [responses, byId, reliability]);

  const saidNo = responses.filter((r) => r.answer === "no").map((r) => byId.get(r.employee_id)?.full_name).filter(Boolean);

  const chosen = responses.filter((r) => r.decision === "accepted" || r.decision === "reserve");
  const { data: outcomes = [] } = useOvertimeOutcomes(request.id, chosen.map((r) => r.id));
  const outcomeById = new Map(outcomes.map((o) => [o.response_id, o.outcome]));

  const answered = new Set(responses.map((r) => r.employee_id));
  const notAnswered = employees.filter((e) => !answered.has(e.id)
    && (!request.department || e.department === request.department)
    && (!request.shift_group || e.shift_group === request.shift_group));

  const onDecide = (responseId: string, decision: "accepted" | "reserve" | "declined" | null) =>
    decide.mutate({ responseId, decision }, { onError: (e) => toast.error((e as Error).message) });

  return (
    <Card className={cn(request.status !== "open" && "opacity-80")}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {fmtDate(request.on_date)} · {windowLabel(request.starts_at, request.ends_at)}
              {request.status !== "open" && <Badge variant="outline" className="capitalize">{request.status}</Badge>}
            </CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              {request.department ?? "Everyone"}{request.shift_group ? ` · ${request.shift_group}` : ""}
              {request.note ? ` · ${request.note}` : ""}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-medium">Needs {counts.headcount}</div>
            <div className="text-xs text-muted-foreground">
              {counts.interested} interested · {counts.accepted} accepted{counts.reserve ? ` · ${counts.reserve} reserve` : ""}
            </div>
            {counts.short > 0 && request.status === "open" && (
              <div className="text-xs font-medium text-warning">{counts.short} still to pick</div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {candidates.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nobody has said yes yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>This month</TableHead>
                  <TableHead>Last 60 days</TableHead>
                  <TableHead>Answered</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map(({ employee, response, reliability: rel }) => {
                  const tone = reliabilityTone(rel);
                  return (
                    <TableRow key={response.id}>
                      <TableCell className="font-medium">{employee.full_name}</TableCell>
                      <TableCell className="text-muted-foreground">{employee.shift_group ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className={cn("font-normal", TONE_CLASS[tone])}>{reliabilityLabel(rel)}</Badge>
                          {blockedLabel(rel) && (
                            <Badge variant="outline" className="border-destructive/40 bg-destructive/10 font-normal text-destructive">{blockedLabel(rel)}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{attendedLabel(rel)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(response.answered_at).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Once somebody is in (or on reserve), what matters is whether they turn up —
                            and that is known before the day as often as after: "I can't make it
                            Saturday" arrives on Thursday. So the outcome is recordable the moment
                            the decision is made, not only once the date has passed. A drop-out on
                            an open ask promotes the reserve by itself. */}
                        {response.decision === "accepted" || response.decision === "reserve" ? (
                          <div className="flex items-center justify-end gap-1">
                            <Select
                              value={outcomeById.get(response.id) ?? ""}
                              onValueChange={(v) => recordOutcome.mutate(
                                { responseId: response.id, outcome: v as OvertimeOutcome },
                                {
                                  onSuccess: ({ promotedEmployeeId, push }) => {
                                    if (!promotedEmployeeId) return;
                                    const who = byId.get(promotedEmployeeId)?.full_name ?? "the reserve";
                                    toast.success(`${who} moved up from reserve${push?.notified ? " and was told" : ""}.`);
                                  },
                                  onError: (e) => toast.error((e as Error).message),
                                },
                              )}
                            >
                              <SelectTrigger className="h-8 w-[150px]">
                                <SelectValue placeholder={isPast ? "What happened?" : response.decision === "accepted" ? "In · still coming" : "Reserve"} />
                              </SelectTrigger>
                              <SelectContent>
                                {OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                {(() => { const v = outcomeById.get(response.id); return v && STORED_LABEL[v]
                                  ? <SelectItem value={v} disabled>{STORED_LABEL[v]}</SelectItem> : null; })()}
                              </SelectContent>
                            </Select>
                            {request.status === "open" && !outcomeById.has(response.id) && (
                              <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground" title="Undo decision"
                                disabled={decide.isPending} onClick={() => onDecide(response.id, null)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <DecisionButtons
                            decision={response.decision}
                            disabled={request.status !== "open" || decide.isPending}
                            onDecide={(d) => onDecide(response.id, d)}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {saidNo.length > 0 && (
          <div className="text-xs text-muted-foreground">Said no: {saidNo.join(", ")}</div>
        )}

        {request.status === "open" && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-muted-foreground" />
              <Select value={addingFor} onValueChange={setAddingFor}>
                <SelectTrigger className="h-8 w-[220px]"><SelectValue placeholder="Add a yes given at the desk…" /></SelectTrigger>
                <SelectContent>
                  {notAnswered.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                size="sm" variant="outline" disabled={!addingFor || answerFor.isPending}
                onClick={() => answerFor.mutate({ requestId: request.id, employeeId: addingFor },
                  { onSuccess: () => setAddingFor(""), onError: (e) => toast.error((e as Error).message) })}
              >
                Add
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRequestStatus.mutate({ id: request.id, status: "cancelled" })}>
                Cancel ask
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRequestStatus.mutate({ id: request.id, status: "closed" })}>
                Close ask
              </Button>
            </div>
          </div>
        )}
        {request.status !== "open" && !isPast && (
          <div className="border-t pt-3">
            <Button size="sm" variant="ghost" onClick={() => setRequestStatus.mutate({ id: request.id, status: "open" })}>
              Reopen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DecisionButtons({ decision, disabled, onDecide }: {
  decision: "accepted" | "reserve" | "declined" | null;
  disabled: boolean;
  onDecide: (d: "accepted" | "reserve" | "declined" | null) => void;
}) {
  const btn = (d: "accepted" | "reserve" | "declined", Icon: typeof Check, label: string, active: string) => (
    <Button
      key={d} size="sm" variant={decision === d ? "default" : "outline"}
      className={cn("h-8 px-2", decision === d && active)}
      disabled={disabled}
      aria-label={label} title={label}
      onClick={() => onDecide(decision === d ? null : d)}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="ml-1 hidden sm:inline">{label}</span>
    </Button>
  );
  return (
    <div className="flex justify-end gap-1">
      {btn("accepted", Check, "Accept", "bg-success text-success-foreground hover:bg-success/90")}
      {btn("reserve", Clock, "Reserve", "bg-warning text-warning-foreground hover:bg-warning/90")}
      {btn("declined", X, "Decline", "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
    </div>
  );
}
