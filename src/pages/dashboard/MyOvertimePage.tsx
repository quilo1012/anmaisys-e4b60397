import { useMemo, useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { BADGE_EMAIL_DOMAIN } from "@/lib/employeeAccounts";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, X, XCircle, Clock, Loader2, Ban, CalendarClock } from "lucide-react";
import { LoadFailed } from "@/components/portal/LoadFailed";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useMyEmployee, useMyUpcomingOvertime, useOvertimeResponses, useOvertimeMutations,
  useMyOvertimeBlock, useMyOvertimeClashes, useOvertimePlaces, useOvertimeOutcomesFor,
} from "@/hooks/useOvertimeRequests";
import { useConfirm } from "@/hooks/useConfirm";
import {
  upcomingForMe, askHasStarted, myStatusLabel, myAnswerLabel, supervisorLabel, windowLabel,
  headcountLine, audienceLine, placesLine, asksOverlap, type OvertimeRequest,
} from "@/lib/overtimeRequests";
import { askShift } from "@/lib/overtimeShifts";
import { ShiftTag } from "@/components/ShiftTag";
import { shiftCard } from "@/lib/shiftLook";
import { OvertimeAuditLog } from "@/components/workforce/OvertimeAuditLog";
import { OvertimePushNudge } from "@/components/workforce/OvertimePushNudge";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { TabletOvertimeNotice } from "@/components/workforce/TabletOvertimeNotice";
import { isSharedTabletSession } from "@/lib/sharedTabletSession";
import { useSignupInviteCode } from "@/hooks/useSignupInvite";
import { MessageSupervisorDialog } from "@/components/workforce/MessageSupervisorDialog";
import { useMySupervisor } from "@/hooks/useDirectMessages";

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
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" });

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
            <MySupervisorChat />
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
 * The conversation with the supervisor on file, without needing an ask to hang it on.
 *
 * Silent until BLOCO 107 is pasted (the per-ask button still writes to whoever posted
 * the ask then). `?chat=supervisor` — the link on the bell row and the message toast —
 * opens it straight away.
 */
function MySupervisorChat() {
  const { data } = useMySupervisor();
  const [params] = useSearchParams();
  if (!data || data.notSetUp) return null;
  if (!data.supervisor) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="no-supervisor">
        No supervisor is on file for you yet — the office can set your manager on your record.
      </p>
    );
  }
  return (
    <MessageSupervisorDialog
      label={`Message ${data.supervisor.full_name}`}
      defaultOpen={params.get("chat") === "supervisor"}
    />
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
  // Which login this is. Somebody with a badge login and an email login holds two
  // accounts; only the badge one is linked, so signed in by email they are asked for
  // a badge the database then calls "not available" (one such person on 18/10).
  // Saying which account is open turns that into something they can act on.
  const { user } = useAuth();
  const signedInAs = user?.email ?? null;
  const byEmail = !!signedInAs && !signedInAs.toLowerCase().endsWith(BADGE_EMAIL_DOMAIN);

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
          {byEmail && (
            <p className="text-xs text-muted-foreground" data-testid="signed-in-as">
              Signed in as <span className="font-medium text-foreground">{signedInAs}</span>. If you
              already signed in before with your badge number and it says "not available", sign out
              and sign in with your badge number instead.
            </p>
          )}
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
  const { answer, cancelMyBooking, swapMyBooking, leaveReserve } = useOvertimeMutations();
  const [filter, setFilter] = useState<"all" | "needs" | "accepted" | "declined">("all");
  /** Which booking is being moved to another day, and to which ask. */
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [swapTo, setSwapTo] = useState<string>("");
  const { confirm, confirmDialog } = useConfirm();
  const fmtShort = (d: string) => d.split("-").slice(1).reverse().join("/");

  const mine = useMemo(() => new Map(responses.filter((r) => r.employee_id === me.id).map((r) => [r.request_id, r])), [responses, me.id]);
  // What came of my own answers — a booking I cancelled reads "Cancelled by you",
  // not "Booked", however the decision row still stands.
  const myResponseIds = useMemo(() => [...mine.values()].map((r) => r.id), [mine]);
  const { data: myOutcomes = [] } = useOvertimeOutcomesFor(myResponseIds);
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
  // Room left on each open ask. Counts only: the floor cannot read anyone else's answer.
  const { data: places } = useOvertimePlaces(
    visible.filter((r) => r.status === "open").map((r) => r.id),
  );

  /**
   * Arriving from the bell: `?ask=<id>` scrolls to that ask and rings it. If it is not
   * in the list any more — cancelled, closed, started, or on hours already theirs —
   * the page says so instead of leaving them to look for it.
   */
  const [params] = useSearchParams();
  const linkedAsk = params.get("ask");
  const linkedShown = !!linkedAsk && visible.some((r) => r.id === linkedAsk);
  useEffect(() => {
    if (!linkedShown) return;
    document.getElementById(`ask-${linkedAsk}`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [linkedShown, linkedAsk]);

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
      // Said from the row the database wrote, not from the button pressed: since
      // BLOCO 102 a yes comes back booked, or on reserve when a numbered ask was full;
      // before it, undecided — and the screen must not promise a booking it did not get.
      onSuccess: (row) => {
        const when = `${windowLabel(request.starts_at, request.ends_at)}, ${audienceLine(request)}`;
        if (a === "no") {
          toast.success(`You said no to ${fmtDate(request.on_date)}`, { description: `${when}.` });
        } else if (row?.decision === "accepted") {
          toast.success(`You're booked for ${fmtDate(request.on_date)}`, {
            description: `${when}. Your supervisor has been told.`,
          });
        } else if (row?.decision === "reserve") {
          toast.success(`You're on the reserve list for ${fmtDate(request.on_date)}`, {
            description: `${when}. Every place was taken; you're next if somebody drops out.`,
          });
        } else {
          toast.success(`You said yes to ${fmtDate(request.on_date)}`, {
            description: `${when}. The supervisor picks the team next.`,
          });
        }
      },
      onError: (e) => toast.error((e as Error).message || "Could not save your answer", {
        description: "Nothing was changed. Check your signal and tap again.",
      }),
    });
  };
  /** Which button is waiting on the server, so the spinner sits on the one that was tapped. */
  const inFlight = answer.isPending ? answer.variables : undefined;

  /**
   * Taking back a booking. Confirmed in words first, because the place goes to the
   * reserve list at once — and if the shift is close, the database counts it as a
   * late cancellation, which the person should hear before they tap, not after.
   */
  /** Asks I am confirmed on and have not cancelled — their hours are already mine. */
  const bookedAsks = useMemo(() => requests.filter((q) => {
    const resp = mine.get(q.id);
    if (resp?.decision !== "accepted") return false;
    return !myOutcomes.some((o) => o.response_id === resp.id
      && (o.outcome === "cancelled_in_time" || o.outcome === "cancelled_late"));
  }), [requests, mine, myOutcomes]);
  const cancelling = useRef(false);
  /** Asks this person could move a booking to: open, undecided, not started. */
  const swapTargets = (from: OvertimeRequest) => requests.filter((q) =>
    q.id !== from.id && q.status === "open" && !askHasStarted(q, now) && !mine.get(q.id)?.decision);
  const leaveReserveFor = async (request: OvertimeRequest) => {
    const ok = await confirm({
      title: "Leave the reserve list?",
      description: `You will no longer be on the reserve list for ${fmtDate(request.on_date)}. This is not a cancellation.`,
      confirmText: "Yes, leave it",
      cancelText: "Stay on it",
    });
    if (!ok) return;
    leaveReserve.mutate({ requestId: request.id }, {
      onSuccess: () => toast.success(`You left the reserve list for ${fmtDate(request.on_date)}`),
      onError: (e) => toast.error((e as Error).message || "Could not leave the reserve list"),
    });
  };
  const moveBooking = async (from: OvertimeRequest) => {
    const target = requests.find((q) => q.id === swapTo);
    if (!target) return;
    const ok = await confirm({
      title: "Move to another day?",
      description: `Your booking on ${fmtDate(from.on_date)} will be cancelled and you will be booked on ${fmtDate(target.on_date)}, ${windowLabel(target.starts_at, target.ends_at)}. If the new day is not confirmed, nothing changes.`,
      confirmText: "Yes, move it",
      cancelText: "Keep my booking",
    });
    if (!ok) return;
    swapMyBooking.mutate({ fromRequestId: from.id, toRequestId: target.id }, {
      onSuccess: () => {
        setSwapFrom(null);
        setSwapTo("");
        toast.success(`Moved to ${fmtDate(target.on_date)}`);
      },
      onError: (e) => toast.error((e as Error).message || "Could not move your booking"),
    });
  };
  const cancelBooking = async (request: OvertimeRequest) => {
    if (cancelling.current) return;
    const ok = await confirm({
      title: "Cancel this booking?",
      description: `You are booked for overtime on ${fmtDate(request.on_date)}, ${windowLabel(request.starts_at, request.ends_at)}. Your place goes to the next person on the reserve list straight away. If the shift is close, this counts as a late cancellation.`,
      confirmText: "Yes, cancel it",
      cancelText: "Keep my booking",
      destructive: true,
    });
    if (!ok) return;
    cancelling.current = true;
    cancelMyBooking.mutate({ requestId: request.id }, {
      onSettled: () => { cancelling.current = false; },
      onSuccess: (res) => toast.success(`Booking cancelled for ${fmtDate(request.on_date)}`, {
        description: res.outcome === "cancelled_late"
          ? "The shift was close, so this counts as a late cancellation."
          : "Your place has been freed.",
      }),
      onError: (e) => toast.error((e as Error).message || "Could not cancel your booking"),
    });
  };

  const goneNotice = linkedAsk && !linkedShown ? (
    <Card className="border-dashed bg-muted/30" role="status">
      <CardContent className="py-4 text-sm">
        <div className="font-medium">That overtime is no longer available</div>
        <div className="mt-0.5 text-muted-foreground">
          It was cancelled or closed, it has already started, or it falls on hours you are already working.
        </div>
      </CardContent>
    </Card>
  ) : null;

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
      <div className="space-y-3">
      {goneNotice}
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <CalendarClock className="h-8 w-8 text-muted-foreground/60" aria-hidden />
          <p className="text-sm font-medium">No upcoming overtime, {me.full_name.split(" ")[0]}.</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            When the supervisor asks for people, it shows up here. This page checks for new asks every minute.
          </p>
        </CardContent>
      </Card>
      </div>
    );
  }

  const waiting = visible.filter((r) => r.status === "open" && !mine.get(r.id)?.decision && !mine.get(r.id)?.answer && !askHasStarted(r, now) && !clashes.get(r.id)).length;

  /**
   * One bucket per ask, read from the same records the cards read: needs a response,
   * accepted (booked and not cancelled), or declined. Cancelled, closed or started asks
   * fall in none of them, so they are never counted as available.
   */
  const bucketOf = (r: OvertimeRequest): "needs" | "accepted" | "declined" | null => {
    const my = mine.get(r.id);
    const cancelled = !!my && myOutcomes.some((o) => o.response_id === my.id
      && (o.outcome === "cancelled_in_time" || o.outcome === "cancelled_late"));
    if (cancelled || r.status !== "open") return null;
    if (my?.decision === "accepted") return "accepted";
    if (my?.decision === "declined" || my?.answer === "no") return "declined";
    if (!my?.decision && !my?.answer && !askHasStarted(r, now) && !clashes.get(r.id)) return "needs";
    return null;
  };
  const buckets = visible.map((r) => ({ r, b: bucketOf(r) }));
  const countOf = (k: "needs" | "accepted" | "declined") => buckets.filter((x) => x.b === k).length;
  const shownAsks = filter === "all" ? visible : buckets.filter((x) => x.b === filter).map((x) => x.r);
  // Grouped by the day the ask is for, in the order the list already has.
  const byDate: [string, OvertimeRequest[]][] = [];
  for (const r of shownAsks) {
    const last = byDate[byDate.length - 1];
    if (last && last[0] === r.on_date) last[1].push(r);
    else byDate.push([r.on_date, [r]]);
  }

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
      {goneNotice}
      <div className="grid grid-cols-3 gap-2 text-center">
        {([
          ["needs", "Needs your response"],
          ["accepted", "Accepted"],
          ["declined", "Declined"],
        ] as const).map(([k, label]) => (
          <button
            key={k} type="button" onClick={() => setFilter(filter === k ? "all" : k)}
            aria-pressed={filter === k}
            className={cn(
              "rounded-md border px-2 py-2 text-xs transition-colors",
              filter === k ? "border-primary bg-primary/10" : "bg-card hover:bg-muted/50",
            )}
          >
            <div className="text-lg font-semibold tabular-nums">{countOf(k)}</div>
            <div className="text-muted-foreground">{label}</div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter offers">
        {([["all", "All"], ["needs", "Needs response"], ["accepted", "Accepted"], ["declined", "Declined"]] as const).map(([k, label]) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} className="h-8" onClick={() => setFilter(k)}>
            {label}
          </Button>
        ))}
      </div>
      {byDate.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing in this view.</p>
      )}
      {byDate.map(([date, asks]) => (
        <section key={date} className="space-y-2">
          <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
          </h3>
          {asks.map((r) => {
        const my = mine.get(r.id);
        const status = myStatusLabel(r, my);
        // A booking I took back. The decision row still says accepted — the outcome
        // is what happened after, and it is what the card must show.
        const myCancel = my ? myOutcomes.find((o) => o.response_id === my.id
          && (o.outcome === "cancelled_in_time" || o.outcome === "cancelled_late")) : undefined;
        const canCancel = my?.decision === "accepted" && !myCancel && r.status === "open" && !askHasStarted(r, now);
        // Room is only news to somebody still deciding; once picked, it is not their question.
        const room = r.status === "open" && !my?.decision ? places?.get(r.id) : undefined;
        // Open, undecided, and not yet begun. The third was missing once, which is
        // how a morning that had ended was still taking answers at eleven at night.
        const canAnswer = r.status === "open" && !my?.decision && !askHasStarted(r, now);
        // Answered before the board or the rota put them on these hours. Their answer
        // stays; a yes no longer can — the database would refuse it.
        // Another ask I am already booked on that covers the same hours (a 06:00–18:00
        // booking is not a place for a 06:00–14:00 ask on the same date). The schedule
        // check above does not see the bookings themselves, so this one is made here.
        const overlapping = bookedAsks.find((b) => b.id !== r.id && asksOverlap(b, r));
        const ownHours = clashes.get(r.id) ?? (overlapping
          ? `you are already booked for overtime ${fmtShort(overlapping.on_date)}, ${windowLabel(overlapping.starts_at, overlapping.ends_at)}`
          : undefined);
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
          <Card key={r.id} id={`ask-${r.id}`} className={cn(shiftCard(askShift(r)), r.status !== "open" && "border-dashed bg-muted/30", r.id === linkedAsk && "ring-2 ring-primary")}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  {/* Day, then hours, then who — one fact per line, biggest first, so a
                      thumb scrolling the list reads the dates down the left edge. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-base font-semibold">{fmtDate(r.on_date)}</span>
                    <ShiftTag shift={askShift(r)} className="px-3 py-1 text-sm" />
                  </div>
                  <div className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    {windowLabel(r.starts_at, r.ends_at)}
                  </div>
                  {/* A sentence, not four facts on middle dots. The note gets its
                      own line because it is the only thing here a person wrote. */}
                  <div className="text-sm text-muted-foreground">
                    {[headcountLine(r), audienceLine(r)].filter(Boolean).join(" — ")}
                  </div>
                  {room && (
                    <div className={cn("text-sm", room.taken >= room.headcount ? "font-medium text-warning-strong" : "text-muted-foreground")}>
                      {placesLine(room)}
                    </div>
                  )}
                </div>
                <Badge variant="outline" className={cn("shrink-0 font-normal", myCancel ? "bg-muted text-muted-foreground" : tone)}>
                  {myCancel && <XCircle className="mr-1 h-3 w-3" />}
                  {!myCancel && my?.decision === "accepted" && <Check className="mr-1 h-3 w-3" />}
                  {!myCancel && my?.decision === "reserve" && <Clock className="mr-1 h-3 w-3" />}
                  {myCancel ? "Cancelled by you" : status}
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
                  {/* Once the supervisor has acted, the badge above already says what was
                      decided, so "Your answer" is only repeated when there is nothing else. */}
                  {!supervisorLabel(r, my) && !myCancel && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Your answer</span>
                      <span className="font-medium">{myAnswerLabel(my)}</span>
                    </div>
                  )}
                  {supervisorLabel(r, my) && (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Supervisor</span>
                      <span className="font-medium">{supervisorLabel(r, my)}</span>
                    </div>
                  )}
                  {myCancel && (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Booking</span>
                      <span className="font-medium">
                        Cancelled by you{myCancel.outcome === "cancelled_late" ? " — counted as late" : ""}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {/* A yes books the shift. Running late is said to the supervisor in the
                  app's chat; not coming at all is the Cancel booking button, which
                  frees the place for the reserve list. Once cancelled, both go away. */}
              {my?.answer === "yes" && !myCancel && r.status !== "cancelled" && !askHasStarted(r, now) && (
                <div className="space-y-1.5">
                  {my.decision === "accepted" && (
                    <p className="text-xs text-muted-foreground">Can't make it after all, or running late? Tell your supervisor — or cancel the booking and free your place.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <MessageSupervisorDialog request={r} fmtDate={fmtDate} />
                    {my.decision === "reserve" && (
                      <Button variant="outline" size="sm" disabled={leaveReserve.isPending}
                        onClick={() => void leaveReserveFor(r)}>
                        Leave the reserve list
                      </Button>
                    )}
                    {canCancel && swapTargets(r).length > 0 && swapFrom !== r.id && (
                      <Button variant="outline" size="sm" onClick={() => { setSwapFrom(r.id); setSwapTo(""); }}>
                        Move to another day
                      </Button>
                    )}
                    {canCancel && (
                      <Button
                        variant="outline" size="sm"
                        className="border-destructive/40 text-destructive hover:bg-destructive/10"
                        disabled={cancelMyBooking.isPending}
                        onClick={() => void cancelBooking(r)}
                      >
                        {cancelMyBooking.isPending
                          ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                        Cancel booking
                      </Button>
                    )}
                  </div>
                  {canCancel && swapFrom === r.id && (
                    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                      <label htmlFor={`swap-${r.id}`} className="text-xs font-medium">Move to</label>
                      <select id={`swap-${r.id}`} value={swapTo} onChange={(e) => setSwapTo(e.target.value)}
                        className="block w-full rounded-md border bg-background px-2 py-2 text-sm">
                        <option value="">Choose a day</option>
                        {swapTargets(r).map((q) => (
                          <option key={q.id} value={q.id}>
                            {fmtDate(q.on_date)}, {windowLabel(q.starts_at, q.ends_at)}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">Your current booking is cancelled only once the new day is confirmed.</p>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={!swapTo || swapMyBooking.isPending} onClick={() => void moveBooking(r)}>
                          {swapMyBooking.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                          Move booking
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSwapFrom(null)}>Keep it here</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {canAnswer && ownHours && (
                <p className="text-sm text-muted-foreground">
                  {ownHours.includes("not enough rest")
                    ? <>Not enough rest between your shifts — {ownHours.charAt(0).toLowerCase() + ownHours.slice(1)}.</>
                    : <>These hours are already yours — {ownHours.charAt(0).toLowerCase() + ownHours.slice(1)}.</>}
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
                    Accept overtime
                  </Button>
                  <Button
                    size="lg" variant={my?.answer === "no" ? "secondary" : "outline"} className="h-12"
                    disabled={answer.isPending} onClick={() => reply(r, "no")}
                    aria-busy={inFlight?.requestId === r.id && inFlight.answer === "no"}
                  >
                    {inFlight?.requestId === r.id && inFlight.answer === "no"
                      ? <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      : <X className="mr-2 h-5 w-5" />}
                    Decline
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
          })}
        </section>
      ))}
      {confirmDialog}
    </div>
  );
}
