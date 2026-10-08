import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, Clock, Loader2, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useMyEmployee, useUnlinkedEmployees, useOvertimeRequests, useOvertimeResponses, useOvertimeMutations,
  useMyOvertimeBlock,
} from "@/hooks/useOvertimeRequests";
import {
  requestIsForEmployee, myStatusLabel, myAnswerLabel, supervisorLabel, windowLabel,
  type OvertimeRequest,
} from "@/lib/overtimeRequests";
import { OvertimePushNudge } from "@/components/workforce/OvertimePushNudge";

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "2-digit" });

/**
 * The floor's side of overtime: a list of asks and two buttons.
 *
 * Built for a phone held in one hand between shifts. No table, no filters: the asks
 * that apply to you, newest date first, each with Yes / No and a line saying where
 * you stand once you have answered — so nobody has to ask the supervisor "am I in?".
 *
 * Nearly nobody on the floor has a login tied to their employee row yet. The first
 * visit asks the person to pick themselves from the list, once; after that the link
 * holds and the page opens straight onto the asks.
 */
export default function MyOvertimePage() {
  const { data: me, isLoading } = useMyEmployee();

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Overtime</h1>
          <p className="text-sm text-muted-foreground">Say yes or no. The supervisor picks and you'll see it here.</p>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : me ? (
          <>
            <OvertimePushNudge />
            <AsksForMe me={me} />
          </>
        ) : (
          <LinkMyself />
        )}
      </div>
    </DashboardLayout>
  );
}

function LinkMyself() {
  const { data: options = [], isLoading } = useUnlinkedEmployees();
  const { linkMe } = useOvertimeMutations();
  const [picked, setPicked] = useState("");

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Who are you?</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Pick your name once. After this the page will know you.
        </p>
        <Select value={picked} onValueChange={setPicked} disabled={isLoading}>
          <SelectTrigger><SelectValue placeholder={isLoading ? "Loading names…" : "Your name"} /></SelectTrigger>
          <SelectContent>
            {options.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.full_name}{e.department ? ` — ${e.department}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          className="w-full" disabled={!picked || linkMe.isPending}
          onClick={() => linkMe.mutate(picked, { onError: (e) => toast.error((e as Error).message) })}
        >
          {linkMe.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          That's me
        </Button>
        <p className="text-xs text-muted-foreground">
          Not on the list? Your name may already be linked to another login, or you may not be on the
          system yet. Ask your supervisor.
        </p>
      </CardContent>
    </Card>
  );
}

function AsksForMe({ me }: { me: { id: string; full_name: string; department: string | null; shift_group: string | null } }) {
  const { data: requests = [], isLoading } = useOvertimeRequests();
  const { data: responses = [] } = useOvertimeResponses();
  const { data: block } = useMyOvertimeBlock(true);
  const { answer } = useOvertimeMutations();
  const fmtShort = (d: string) => d.split("-").slice(1).reverse().join("/");

  const mine = useMemo(() => new Map(responses.filter((r) => r.employee_id === me.id).map((r) => [r.request_id, r])), [responses, me.id]);
  const today = new Date().toISOString().slice(0, 10);
  const visible = useMemo(
    () => requests
      .filter((r) => requestIsForEmployee(r, me))
      .filter((r) => r.on_date >= today || mine.has(r.id)),
    [requests, me, today, mine],
  );

  /**
   * The answer, and a receipt that says which day it was for.
   *
   * "Marked you as interested" was true and not enough: somebody who answers three
   * asks in a week between shifts has no way to tell which one just took, and the
   * screen they are holding scrolls. The toast names the date and the hours, and says
   * in the same breath that a yes is not yet a place — that part is the supervisor's,
   * and the card below carries it on its own line.
   */
  const reply = (request: OvertimeRequest, a: "yes" | "no") =>
    answer.mutate({ requestId: request.id, answer: a }, {
      onSuccess: () => toast.success(
        a === "yes" ? `Overtime confirmed for ${fmtDate(request.on_date)}` : `Noted — you said no to ${fmtDate(request.on_date)}`,
        {
          description: a === "yes"
            ? `${windowLabel(request.starts_at, request.ends_at)}${request.shift_group ? ` · ${request.shift_group}` : ""} — waiting for the supervisor to pick the team.`
            : `${windowLabel(request.starts_at, request.ends_at)}${request.shift_group ? ` · ${request.shift_group}` : ""}`,
        },
      ),
      onError: (e) => toast.error((e as Error).message || "Could not save your answer"),
    });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (visible.length === 0) {
    return (
      <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
        No overtime on offer right now, {me.full_name.split(" ")[0]}. Check back later.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Signed in as {me.full_name}{me.shift_group ? ` · ${me.shift_group}` : ""}</div>
      {block && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <Ban className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <div className="font-medium">You can't sign up until {fmtShort(block.blocked_until)}</div>
              <div className="mt-0.5 text-muted-foreground">
                {block.reason === "no_show" ? "You didn't turn up for" : "You cancelled late for"} overtime on {fmtShort(block.on_date)}.
                You can still see what's on offer, and you can still say no.
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {visible.map((r) => {
        const my = mine.get(r.id);
        const status = myStatusLabel(r, my);
        const canAnswer = r.status === "open" && !my?.decision;
        const tone =
          my?.decision === "accepted" ? "bg-success/15 text-success border-success/30"
          : my?.decision === "reserve" ? "bg-warning/15 text-warning border-warning/30"
          : my?.decision === "declined" || r.status !== "open" ? "bg-muted text-muted-foreground"
          : "";
        return (
          <Card key={r.id} className={cn(r.status !== "open" && "opacity-80")}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-medium">{fmtDate(r.on_date)} · {windowLabel(r.starts_at, r.ends_at)}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.headcount} needed{r.shift_group ? ` · ${r.shift_group}` : ""}{r.department ? ` · ${r.department}` : ""}{r.note ? ` · ${r.note}` : ""}
                  </div>
                </div>
                <Badge variant="outline" className={cn("shrink-0 font-normal", tone)}>
                  {my?.decision === "accepted" && <Check className="mr-1 h-3 w-3" />}
                  {my?.decision === "reserve" && <Clock className="mr-1 h-3 w-3" />}
                  {status}
                </Badge>
              </div>
              {my && (
                /* Two lines on purpose. The first is what this person said, which is
                   theirs and does not change; the second is what the supervisor has
                   done about it, which is not theirs and often has not happened yet.
                   One line could only ever say one of them, and that is how "I
                   confirmed" started reading as "I am in". */
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Your answer</span>
                    <span className="font-medium">{myAnswerLabel(my)}</span>
                  </div>
                  {supervisorLabel(r, my) && (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Supervisor</span>
                      <span className="font-medium">{supervisorLabel(r, my)}</span>
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Shift</span>
                    <span className="font-medium">
                      {windowLabel(r.starts_at, r.ends_at)}{r.shift_group ? ` · ${r.shift_group}` : ""}
                    </span>
                  </div>
                </div>
              )}
              {canAnswer && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="lg" variant={my?.answer === "yes" ? "default" : "outline"}
                    className={cn("h-12", my?.answer === "yes" && "bg-success text-success-foreground hover:bg-success/90")}
                    disabled={answer.isPending || !!block} onClick={() => reply(r, "yes")}
                  >
                    <Check className="mr-2 h-5 w-5" /> Yes, I can
                  </Button>
                  <Button
                    size="lg" variant={my?.answer === "no" ? "secondary" : "outline"} className="h-12"
                    disabled={answer.isPending} onClick={() => reply(r, "no")}
                  >
                    <X className="mr-2 h-5 w-5" /> No
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
