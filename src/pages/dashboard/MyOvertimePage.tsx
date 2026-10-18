import { useMemo, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, X, Clock, Loader2, Ban, CalendarClock } from "lucide-react";
import { LoadFailed } from "@/components/portal/LoadFailed";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useMyEmployee, useMyUpcomingOvertime, useOvertimeResponses, useOvertimeMutations,
  useMyOvertimeBlock, useMyOvertimeClashes,
} from "@/hooks/useOvertimeRequests";
import {
  upcomingForMe, askHasStarted, myStatusLabel, myAnswerLabel, supervisorLabel, windowLabel,
  headcountLine, audienceLine, type OvertimeRequest,
} from "@/lib/overtimeRequests";
import { askShift } from "@/lib/overtimeShifts";
import { ShiftTag } from "@/components/ShiftTag";
import { shiftEdge } from "@/lib/shiftLook";
import { OvertimeAuditLog } from "@/components/workforce/OvertimeAuditLog";
import { OvertimePushNudge } from "@/components/workforce/OvertimePushNudge";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { TabletOvertimeNotice } from "@/components/workforce/TabletOvertimeNotice";
import { isSharedTabletSession } from "@/lib/sharedTabletSession";
import { useSignupInviteCode } from "@/hooks/useSignupInvite";

const NO_CLASHES: ReadonlyMap<string, string> = new Map();

/**
 * What the page looks like while it waits: the shape of the cards that are coming.
 *
 * A grey "Loading…" line and then three tall cards made the page jump on a phone,
 * and the button under the thumb moved while the person was reaching for it.
 */
function AsksSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading your overtime">
      {[0, 1].map((i) => (
        <Card key={i} className="border-l-4 border-l-muted">
          <CardContent className="space-y-3 pt-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

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
  // `isPending`, not `isLoading`: React Query 5 reports a query that has not started
  // (it waits for the auth user) as pending but not loading, and the badge prompt below
  // is for "the database says nobody" — never for "nobody has asked yet".
  const { data: me, isPending, isError, refetch } = useMyEmployee();
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
          <TabletOvertimeNotice />
        ) : isError ? (
          /* A failed lookup is not an unlinked account. Asking a linked person for their
             badge again because the phone's network dropped is how a linked account
             ends up "registering" twice. */
          <LoadFailed
            message="We couldn't check who you are just now. Your badge link is not lost."
            onRetry={() => void refetch()}
          />
        ) : isPending ? (
          <AsksSkeleton />
        ) : me ? (
          <>
            <OvertimePushNudge />
            <AsksForMe me={me} />
            <OvertimeAuditLog mode="mine" />
          </>
        ) : (
          <LinkMyself />
        )}
      </div>
    </DashboardLayout>
  );
}


/**
 * Who you are, in the one way that is yours alone.
 *
 * This screen used to be a dropdown of every unclaimed person on the roster — name and
 * department — under the heading "Who are you?" and a button saying "That's me". It
 * was not a question, it was an offer: the account that clicked became whoever it
 * picked, and `link_me_to_employee`'s only identity check is an email match on a
 * column almost no employee row fills in. The badge door never had that problem, so
 * this is the badge door's rule brought over to the other side.
 *
 * No list is loaded any more, which also means nobody has to be told that the person
 * they wanted is already taken: `link_me_by_employee_ref` answers every miss the same
 * way, so the box cannot be used to find out who has registered.
 */
function LinkMyself() {
  const { linkMe, linkMeByEmail } = useOvertimeMutations();
  const [ref, setRef] = useState("");

  /**
   * Tentar pelo email antes de pedir o número.
   *
   * Uma vez por montagem, e em silêncio. O email da sessão já foi verificado pelo
   * GoTrue, por isso se ele estiver numa ficha activa e por reclamar não há nada a
   * adivinhar e a pessoa nunca vê este formulário. Falhar é o caso normal — a maior
   * parte das fichas não tem email — e por isso não há mensagem nenhuma para esse
   * caso: o formulário abaixo já é a resposta.
   */
  const tentado = useRef(false);
  useEffect(() => {
    if (tentado.current) return;
    tentado.current = true;
    linkMeByEmail.mutate();
    // `linkMeByEmail` muda de identidade a cada render do hook; a guarda acima é o que
    // garante uma tentativa só, e pô-lo nas dependências só traria de volta o ciclo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const typed = ref.trim().toUpperCase();
    // Enter on the phone keyboard submits too, and the button's `disabled` does not
    // stop that one. Five wrong tries lock the box, so a doubled try is not free.
    if (!typed || linkMe.isPending) return;
    linkMe.mutate(typed, {
      // The database's words, not ours. It distinguishes "not available", "already
      // linked" and "too many tries", and each one tells the person a different thing
      // to do next — flattening them into "could not link" would waste that.
      onError: (err) => toast.error((err as Error).message || "Could not link your account"),
    });
  };

  // Enquanto a tentativa silenciosa corre, não mostrar o formulário: para quem vai
  // ser ligado pelo email, ele aparecia e desaparecia, e o que fica é ter-se visto um
  // pedido que ninguém fez.
  if (linkMeByEmail.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking your account…
      </div>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Which badge is yours?</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <p className="text-sm text-muted-foreground">
            Type the number on your badge, once. After this the page will know you.
          </p>
          <Input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="E045"
            autoCapitalize="characters"
            spellCheck={false}
            className="h-12 font-mono uppercase"
            aria-label="Employee ID"
          />
          <Button className="h-12 w-full" type="submit" disabled={!ref.trim() || linkMe.isPending}>
            {linkMe.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            That's me
          </Button>
          <p className="text-xs text-muted-foreground">
            No number on your badge, or it isn't working? Your supervisor can link your account —
            they have the list. Five wrong tries and you'll have to ask them anyway.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function AsksForMe({ me }: { me: { id: string; full_name: string; department: string | null; shift_group: string | null } }) {
  const { data: requests = [], isLoading, isError, refetch } = useMyUpcomingOvertime();
  const { data: responses = [] } = useOvertimeResponses();
  const { data: block } = useMyOvertimeBlock(true);
  const { data: clashes = NO_CLASHES } = useMyOvertimeClashes(true);
  const { answer } = useOvertimeMutations();
  const fmtShort = (d: string) => d.split("-").slice(1).reverse().join("/");

  const mine = useMemo(() => new Map(responses.filter((r) => r.employee_id === me.id).map((r) => [r.request_id, r])), [responses, me.id]);
  /**
   * The clock the list is judged by, moved on every half minute.
   *
   * Without it the list is only re-cut when data arrives, so a morning that began at
   * 06:00 would sit on an idle phone, buttons live, until the next poll or tap.
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  /**
   * Shifts still ahead, and not on hours already theirs (`clashes` is the database
   * reading their board and rota). The rule, and why answered past asks left, is
   * `upcomingForMe`.
   */
  const visible = useMemo(
    () => upcomingForMe(requests, me, mine, now, clashes),
    [requests, me, mine, now, clashes],
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
  /**
   * One answer in flight at a time. `answer.isPending` disables the buttons, but only
   * from the next render; a double tap on a phone lands before it and sent the answer
   * twice — two toasts, and on a slow line two rows of audit for one tap.
   */
  const sending = useRef(false);
  const reply = (request: OvertimeRequest, a: "yes" | "no") => {
    if (sending.current) return;
    sending.current = true;
    answer.mutate({ requestId: request.id, answer: a }, {
      onSettled: () => { sending.current = false; },
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
      onError: (e) => toast.error((e as Error).message || "Could not save your answer", {
        description: "Nothing was changed. Check your signal and tap again.",
      }),
    });
  };
  /** Which button is waiting on the server, so the spinner sits on the one that was tapped. */
  const inFlight = answer.isPending ? answer.variables : undefined;

  if (isLoading) return <AsksSkeleton />;
  // A failed fetch is not an empty list. Saying "no overtime" when the phone simply
  // lost signal is how somebody misses the one they were waiting for.
  if (isError) {
    return (
      <LoadFailed
        message="We couldn't load the overtime list. Your answers are saved — this is only the screen."
        onRetry={() => void refetch()}
      />
    );
  }
  if (visible.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <CalendarClock className="h-8 w-8 text-muted-foreground/60" aria-hidden />
          <p className="text-sm font-medium">No upcoming overtime, {me.full_name.split(" ")[0]}.</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            When the supervisor asks for people, it shows up here. This page checks for new asks every minute.
          </p>
        </CardContent>
      </Card>
    );
  }

  const waiting = visible.filter((r) => r.status === "open" && !mine.get(r.id)?.decision && !mine.get(r.id)?.answer && !askHasStarted(r, now) && !clashes.get(r.id)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Signed in as {me.full_name}</span>
        {me.shift_group && <ShiftTag shift={me.shift_group} noun="crew" />}
        {/* The one number someone opening this between shifts wants: how many are
            still waiting on them. Said once, above the list, so the cards below do not
            each have to be read to find it out. */}
        <span className={cn(
          "ml-auto rounded-full px-2 py-0.5 font-semibold",
          waiting > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}>
          {waiting > 0 ? `${waiting} waiting for your answer` : "All answered"}
        </span>
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
        // Open, undecided, and not yet begun. The third was missing once, which is
        // how a morning that had ended was still taking answers at eleven at night.
        const canAnswer = r.status === "open" && !my?.decision && !askHasStarted(r, now);
        // Answered before the board or the rota put them on these hours. Their answer
        // stays; a yes no longer can — the database would refuse it.
        const ownHours = clashes.get(r.id);
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
          /* The left edge and the tag are the shift the overtime is FOR (`askShift`,
             the board it lands on), not the person's crew: a day packer offered a
             night ask is looking at night work, and the card should look like it. */
          <Card key={r.id} className={cn(shiftEdge(askShift(r)), r.status !== "open" && "border-dashed bg-muted/30")}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  {/* Day, then hours, then who — one fact per line, biggest first, so a
                      thumb scrolling the list reads the dates down the left edge. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-base font-semibold">{fmtDate(r.on_date)}</span>
                    <ShiftTag shift={askShift(r)} />
                  </div>
                  <div className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    {windowLabel(r.starts_at, r.ends_at)}
                  </div>
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
              {canAnswer && ownHours && (
                <p className="text-sm text-muted-foreground">
                  These hours are already yours — {ownHours.charAt(0).toLowerCase() + ownHours.slice(1)}.
                </p>
              )}
              {canAnswer && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="lg" variant={my?.answer === "yes" ? "default" : "outline"}
                    className={cn("h-12", my?.answer === "yes" && "bg-success text-success-foreground hover:bg-success/90")}
                    disabled={answer.isPending || !!block || !!ownHours} onClick={() => reply(r, "yes")}
                    aria-busy={inFlight?.requestId === r.id && inFlight.answer === "yes"}
                  >
                    {inFlight?.requestId === r.id && inFlight.answer === "yes"
                      ? <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      : <Check className="mr-2 h-5 w-5" />}
                    Yes, I can
                  </Button>
                  <Button
                    size="lg" variant={my?.answer === "no" ? "secondary" : "outline"} className="h-12"
                    disabled={answer.isPending} onClick={() => reply(r, "no")}
                    aria-busy={inFlight?.requestId === r.id && inFlight.answer === "no"}
                  >
                    {inFlight?.requestId === r.id && inFlight.answer === "no"
                      ? <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      : <X className="mr-2 h-5 w-5" />}
                    No
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
