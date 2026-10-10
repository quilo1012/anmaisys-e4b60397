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
  headcountLine, audienceLine, askIsOver, type OvertimeRequest,
} from "@/lib/overtimeRequests";
import { OvertimePushNudge } from "@/components/workforce/OvertimePushNudge";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { SignupQrCard } from "@/components/SignupQrCard";
import { isSharedTabletSession } from "@/lib/sharedTabletSession";
import { useTabletInviteCode } from "@/hooks/useTabletInvite";

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
  /**
   * A tablet is a place, and this page is addressed to a person.
   *
   * Read before anything else and used instead of `me`, not alongside it: whatever
   * employee the shared account happens to be linked to is not the person holding the
   * screen, so showing their name, their answer or their buttons is wrong even when
   * the data loads perfectly. See `isSharedTabletSession` for how Line 1's tablet
   * came to be Eduardo Luz.
   */
  const sharedTablet = isSharedTabletSession();

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-xl space-y-4">
        {/* The band, like every other screen in the system. This page opened with a
            bare <h1> on white — the sixth screen to do it, and the exact thing
            ModuleHeader was written to end: five screens about the same people, two
            different headers, so moving between them read as leaving the section.
            `brand` because this one is answered from a phone, where the sidebar is a
            closed drawer and nothing else on the page carries the mark. */}
        <ModuleHeader
          module="Overtime"
          title="Overtime"
          description="Say yes or no. The supervisor picks, and you'll see it here."
          brand
        />
        {sharedTablet ? (
          <TabletNoticeBoard />
        ) : isLoading ? (
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

/**
 * What the line's tablet shows instead: a notice, not an account.
 *
 * The asks stay visible because the tablet is where people walk past, and "fifteen
 * needed on Friday morning" is worth reading whoever you are. What is gone is
 * everything that needs a name — no identity line, no Yes/No, and above all no "Pick
 * your name once", which is the screen that bound a shared login to one person and
 * made everybody else on that tablet into him.
 *
 * Answering moves to the phone in the person's pocket, which is the only device in
 * this building that is reliably one person. `SignupQrCard` is the same card the
 * login screen already shows for the same reason, so a worker meets one instruction
 * in two places rather than two instructions.
 */
function TabletNoticeBoard() {
  const { data: requests = [], isLoading } = useOvertimeRequests();
  // Only a tablet session gets one; everywhere else the RPC answers null and the QR
  // carries nothing, which is what it does today.
  const inviteCode = useTabletInviteCode(true);
  const open = useMemo(
    () => requests.filter((r) => r.status === "open" && !askIsOver(r)),
    [requests],
  );

  return (
    <div className="space-y-3">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-4 text-sm">
          <p className="font-medium">This is the line's tablet, not your phone.</p>
          <p className="mt-1 text-muted-foreground">
            Everyone here signs in as the same account, so overtime can't be answered from it.
            Scan the code below to answer on your own phone — it takes a minute, once.
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : open.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No overtime on offer right now.
        </CardContent></Card>
      ) : (
        open.map((r) => (
          <Card key={r.id}>
            <CardContent className="py-4">
              <div className="font-medium">
                {fmtDate(r.on_date)} · {windowLabel(r.starts_at, r.ends_at)}
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {headcountLine(r)} — {audienceLine(r)}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <SignupQrCard tone="page" inviteCode={inviteCode} />
    </div>
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
  /**
   * What is still worth showing this person.
   *
   * The date test was `on_date >= today` and nothing else, so an ask stayed on offer
   * for the whole calendar day — including at 23:00, nine hours after a 06:00–14:00
   * window had closed, with both buttons live. `askIsOver` reads the hours the ask
   * actually carries.
   *
   * An ask already answered stays on the list even once it is over: that is the
   * person's own record of what they said and what came of it. What goes is the
   * offer of a shift nobody can work any more.
   */
  const visible = useMemo(
    () => requests
      .filter((r) => requestIsForEmployee(r, me))
      .filter((r) => mine.has(r.id) || !askIsOver(r)),
    [requests, me, mine],
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
        // The button says "Yes, I can", so the answer says you said yes. It used to
        // say "Overtime confirmed", which is the supervisor's word and not yours —
        // the very collapse the two-line receipt below exists to undo.
        a === "yes"
          ? `You said yes to ${fmtDate(request.on_date)}`
          : `You said no to ${fmtDate(request.on_date)}`,
        {
          description: a === "yes"
            ? `${windowLabel(request.starts_at, request.ends_at)}, ${audienceLine(request)}. The supervisor picks the team next.`
            : `${windowLabel(request.starts_at, request.ends_at)}, ${audienceLine(request)}.`,
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
      <div className="text-xs text-muted-foreground">
        Signed in as {me.full_name}{me.shift_group ? `, ${me.shift_group} crew` : ""}
      </div>
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
        // Open, undecided, and not already finished. The third was missing, which is
        // how a morning that had ended was still taking answers at eleven at night.
        const canAnswer = r.status === "open" && !my?.decision && !askIsOver(r);
        const tone =
          my?.decision === "accepted" ? "bg-success/15 text-success border-success/30"
          : my?.decision === "reserve" ? "bg-warning/15 text-warning border-warning/30"
          : my?.decision === "declined" || r.status !== "open" ? "bg-muted text-muted-foreground"
          : "";
        return (
          /* Shape, not opacity. A closed ask used to be the same card at
             `opacity-80`, which reads as "still loading" rather than "this is over".
             It loses its buttons and gains a rule instead — the card changes form,
             which can be seen without reading it. */
          <Card key={r.id} className={cn(r.status !== "open" && "border-dashed bg-muted/30")}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-medium">{fmtDate(r.on_date)} · {windowLabel(r.starts_at, r.ends_at)}</div>
                  {/* A sentence, not four facts on middle dots. The note gets its
                      own line because it is the only thing here a person wrote. */}
                  <div className="text-sm text-muted-foreground">
                    {headcountLine(r)} — {audienceLine(r)}
                  </div>
                </div>
                <Badge variant="outline" className={cn("shrink-0 font-normal", tone)}>
                  {my?.decision === "accepted" && <Check className="mr-1 h-3 w-3" />}
                  {my?.decision === "reserve" && <Clock className="mr-1 h-3 w-3" />}
                  {status}
                </Badge>
              </div>
              {r.note && <p className="text-sm italic text-foreground/80">“{r.note}”</p>}
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
