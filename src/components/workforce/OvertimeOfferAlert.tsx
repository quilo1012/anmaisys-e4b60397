import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Ban, CalendarClock, Check, Clock, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  useMyEmployee, useMyUpcomingOvertime, useOvertimeResponses, useOvertimeMutations,
  useMyOvertimeBlock, useMyOvertimeClashes, useOvertimePlaces,
} from "@/hooks/useOvertimeRequests";
import {
  windowLabel, hoursBetween, audienceLine, headcountLine, placesLine, type OvertimeRequest,
} from "@/lib/overtimeRequests";
import { askShift } from "@/lib/overtimeShifts";
import { ShiftTag } from "@/components/ShiftTag";
import { isSharedTabletSession } from "@/lib/sharedTabletSession";
import {
  offersToAlert, offerOutcome, readDismissed, rememberDismissed, type OfferOutcome,
} from "@/lib/overtimeOfferAlert";

const longDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const fmtShort = (d: string) => d.split("-").slice(1).reverse().join("/");

const OUTCOME_TEXT: Record<OfferOutcome, { title: string; body: string }> = {
  booked: { title: "You're booked", body: "Your supervisor has been told." },
  reserve: { title: "You're on the reserve list", body: "Every place was taken; you're next if somebody drops out." },
  yes_pending: { title: "You said yes", body: "The supervisor picks the team next. You'll see it on My Overtime." },
  declined: { title: "You said no", body: "Thanks for letting the supervisor know." },
};

type Phase =
  | { kind: "ask" }
  | { kind: "done"; outcome: OfferOutcome }
  /** The server, or the next poll, says the ask can no longer be answered here. */
  | { kind: "gone"; answeredElsewhere: boolean };

/**
 * The "OVERTIME AVAILABLE" alert: the Maintenance Order modal's shape, for an ask.
 *
 * Mounted once by `DashboardLayout` for roles that may answer overtime; it renders
 * nothing until the signed-in login is linked to an employee and an ask is waiting on
 * them (`offersToAlert`). One ask at a time, the earliest first, with a count of the
 * rest. The answer goes through `answer_overtime`, the same RPC My Overtime calls —
 * the database still decides who may answer, whether the ask is open, and whether a
 * yes is booked or put on reserve; this screen only says what it decided.
 */
export function OvertimeOfferAlert() {
  // A shared line tablet is a place, not a person: never ask it to accept overtime
  // in whoever's name the tablet account happens to be linked to.
  const sharedTablet = isSharedTabletSession();
  if (sharedTablet) return null;
  return <OfferAlertForMe />;
}

function OfferAlertForMe() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { data: me } = useMyEmployee();
  const linked = !!me;
  const upcoming = useMyUpcomingOvertime();
  const responses = useOvertimeResponses();
  const clashes = useMyOvertimeClashes(linked);
  const { data: block } = useMyOvertimeBlock(linked);
  const { answer } = useOvertimeMutations();

  const [dismissed, setDismissed] = useState<Set<string>>(() => (userId ? readDismissed(userId) : new Set()));
  useEffect(() => { if (userId) setDismissed(readDismissed(userId)); }, [userId]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  /**
   * Asks answered from this alert, until the refreshed list says so itself. Without
   * it, a refresh that has not caught up yet would ring the same ask again the moment
   * "Done" is pressed.
   */
  const [answeredHere, setAnsweredHere] = useState<ReadonlySet<string>>(() => new Set());
  const mine = useMemo(
    () => new Map((responses.data ?? []).filter((r) => r.employee_id === me?.id).map((r) => [r.request_id, r])),
    [responses.data, me?.id],
  );
  const skip = useMemo(() => new Set([...dismissed, ...answeredHere]), [dismissed, answeredHere]);

  // Ring only on a full picture. An unread answers list would make every ask look
  // unanswered, and a missing clash list would offer hours that are already theirs.
  const ready = linked && upcoming.isSuccess && responses.isSuccess && !clashes.isPending;
  const waiting = useMemo(
    () => (ready && me
      ? offersToAlert(upcoming.data ?? [], me, mine, { now, clashes: clashes.data, dismissed: skip, userId })
      : []),
    [ready, me, upcoming.data, mine, now, clashes.data, skip, userId],
  );

  /**
   * The ask on screen. Held in state, not read off `waiting`: once answered it leaves
   * that list, and the alert must stay open to say what the server did with it.
   */
  const [current, setCurrent] = useState<OvertimeRequest | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "ask" });
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const [pressed, setPressed] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    if (!current && waiting.length > 0) {
      setCurrent(waiting[0]);
      setPhase({ kind: "ask" });
      setError(null);
    }
  }, [current, waiting]);

  // The latest copy of the ask on screen (a supervisor may edit its hours), and
  // whether it is still waiting — closed, cancelled or answered on another phone
  // takes it out of `upcoming`/`waiting` on the next poll.
  const latest = useMemo(
    () => (current ? (upcoming.data ?? []).find((r) => r.id === current.id) ?? null : null),
    [current, upcoming.data],
  );
  const shown = latest ?? current;
  useEffect(() => {
    if (!current || phase.kind !== "ask" || sending.current || !upcoming.isSuccess) return;
    const stillOpen = latest?.status === "open" && !mine.has(current.id);
    if (!stillOpen) setPhase({ kind: "gone", answeredElsewhere: mine.has(current.id) });
  }, [current, latest, mine, phase.kind, upcoming.isSuccess]);

  const { data: places } = useOvertimePlaces(current && phase.kind === "ask" ? [current.id] : []);
  const room = current ? places?.get(current.id) : undefined;

  const reply = (a: "yes" | "no") => {
    if (!current || sending.current) return;
    sending.current = true;
    setPressed(a);
    setError(null);
    answer.mutate({ requestId: current.id, answer: a }, {
      onSettled: () => { sending.current = false; setPressed(null); },
      onSuccess: (row) => {
        setAnsweredHere((prev) => new Set(prev).add(current.id));
        setPhase({ kind: "done", outcome: offerOutcome(a, row) });
      },
      onError: (e) => {
        setError((e as Error).message || "Could not save your answer");
        // The database's refusal may be about the ask, not the network: cancelled,
        // closed or started meanwhile. Re-read it so the alert says which.
        void upcoming.refetch();
        void responses.refetch();
      },
    });
  };

  const close = () => {
    if (!current || sending.current) return;
    // "Not now" on an ask still waiting is remembered, so it does not ring again.
    // It is not an answer: the ask stays on My Overtime with both buttons.
    if (phase.kind === "ask" && userId) setDismissed(rememberDismissed(userId, current.id));
    setCurrent(null);
    setPhase({ kind: "ask" });
    setError(null);
  };

  if (!current || !shown) return null;

  const busy = answer.isPending || pressed !== null;
  const more = waiting.filter((r) => r.id !== current.id).length;
  const duration = hoursBetween(shown.starts_at, shown.ends_at);
  const audience = audienceLine(shown);
  const roomLine = placesLine(room);
  const full = !!room && room.headcount != null && room.taken >= room.headcount;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent
        data-testid="overtime-offer-alert"
        className={cn(
          "max-w-lg gap-0 overflow-y-auto border-2 border-success/60 p-0",
          "motion-reduce:animate-none motion-reduce:transition-none",
          "[&>button]:hidden", // the close X; "Not now" says what closing means
        )}
        // An outside tap is not a decision either way; only the buttons decide.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        // Focus the alert, not its first button: Radix would land on ACCEPT, and an
        // Enter meant for the page underneath would book a shift.
        onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.focus(); }}
      >
        <div className="flex flex-col items-center gap-3 bg-success px-6 pb-5 pt-6 text-center text-success-foreground">
          <div className="rounded-full bg-success-foreground/15 p-3" aria-hidden>
            <CalendarClock className="h-10 w-10" />
          </div>
          <DialogTitle className="text-2xl font-extrabold tracking-wide sm:text-3xl">
            OVERTIME AVAILABLE
          </DialogTitle>
          {more > 0 && phase.kind === "ask" && (
            <p className="text-xs font-semibold opacity-90">+ {more} more waiting for your answer</p>
          )}
        </div>

        <div className="space-y-4 px-5 py-5 sm:px-6">
          <DialogDescription asChild>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Date</dt>
              <dd className="font-semibold text-foreground">{longDate(shown.on_date)}</dd>
              <dt className="text-muted-foreground">Hours</dt>
              <dd className="flex flex-wrap items-center gap-2 font-semibold tabular-nums text-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  {windowLabel(shown.starts_at, shown.ends_at)}
                </span>
                {duration && <span className="font-normal text-muted-foreground">({duration})</span>}
                <ShiftTag shift={askShift(shown)} />
              </dd>
              <dt className="text-muted-foreground">Area</dt>
              <dd className="text-foreground">{audience}</dd>
              {headcountLine(shown) && (
                <>
                  <dt className="text-muted-foreground">Needed</dt>
                  <dd className="text-foreground">{headcountLine(shown)}</dd>
                </>
              )}
              {roomLine && phase.kind === "ask" && (
                <>
                  <dt className="text-muted-foreground">Places</dt>
                  <dd className={cn(full ? "font-medium text-warning-strong" : "text-foreground")}>{roomLine}</dd>
                </>
              )}
            </dl>
          </DialogDescription>
          {shown.note && <p className="text-sm italic text-foreground/80">“{shown.note}”</p>}

          {phase.kind === "ask" && block && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <span>
                You can't sign up until {fmtShort(block.blocked_until)}. You can still say no.
              </span>
            </div>
          )}

          {error && phase.kind === "ask" && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <div>
                <div className="font-medium text-destructive">Your answer was not saved</div>
                <div className="text-foreground/80">{error}. Nothing was changed — try again.</div>
              </div>
            </div>
          )}

          {phase.kind === "done" && (
            <div role="status" className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
              {phase.outcome === "declined"
                ? <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                : <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-strong" aria-hidden />}
              <div>
                <div className="font-semibold">{OUTCOME_TEXT[phase.outcome].title}</div>
                <div className="text-foreground/80">{OUTCOME_TEXT[phase.outcome].body}</div>
              </div>
            </div>
          )}

          {phase.kind === "gone" && (
            <div role="status" className="rounded-md border border-dashed bg-muted/40 p-3 text-sm">
              <div className="font-semibold">
                {phase.answeredElsewhere ? "You've already answered this one" : "This overtime is no longer available"}
              </div>
              <div className="text-muted-foreground">
                {phase.answeredElsewhere
                  ? "Your answer is on My Overtime."
                  : "It was cancelled or closed, or it has already started. Nothing was saved from here."}
              </div>
            </div>
          )}

          {phase.kind === "ask" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  size="lg"
                  className="h-14 bg-success font-bold text-success-foreground hover:bg-success/90"
                  disabled={busy || !!block}
                  aria-busy={pressed === "yes"}
                  onClick={() => reply("yes")}
                >
                  {pressed === "yes" ? <Loader2 className="mr-2 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="mr-2 h-5 w-5" aria-hidden />}
                  {pressed === "yes" ? "SAVING…" : "ACCEPT OVERTIME"}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-14 font-bold"
                  disabled={busy}
                  aria-busy={pressed === "no"}
                  onClick={() => reply("no")}
                >
                  {pressed === "no" ? <Loader2 className="mr-2 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <X className="mr-2 h-5 w-5" aria-hidden />}
                  {pressed === "no" ? "SAVING…" : "DECLINE"}
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={close}>
                  Not now — decide later
                </Button>
                <Link
                  to={`/dashboard/my-overtime?ask=${current.id}`}
                  onClick={close}
                  className="rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Open My Overtime
                </Link>
              </div>
            </div>
          ) : (
            <Button size="lg" className="h-12 w-full" onClick={close} autoFocus>
              {phase.kind === "done" && more > 0 ? "Next" : "Done"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
