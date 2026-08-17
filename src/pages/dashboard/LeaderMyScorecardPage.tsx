import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLeaderAttribution } from "@/hooks/useLabelAttribution";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { AlertCircle, Award, Download, Loader2, Lock, LogOut, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { getCurrentFactoryShift, SHIFT_LABEL } from "@/lib/shifts";
import { computeScorecard, type ScorecardPeriod } from "@/lib/leaderScorecard";
import { downloadScorecardCsv } from "@/lib/leaderScorecardCsv";
import { printElementAsDocument } from "@/lib/printDocument";
import { useLeaderScoreWeights } from "@/hooks/useLeaderScoreWeights";
import { DEFAULT_WEIGHTS } from "@/lib/leaderScore";
import { useProfileNames } from "@/hooks/useProfileNames";
import { fetchLeaderSelfScorecard, type LeaderIdentity } from "@/hooks/useLeaderSelfScorecard";
import { LeaderScorecardBody, SCORECARD_PRINT_ID } from "@/components/leader/LeaderScorecardBody";

/**
 * A line leader's own scorecard, opened with their own PIN.
 *
 * The screen is deliberately reachable by any signed-in session: the tablet on the
 * line is signed in as the line, not as a person, so the route cannot be gated on a
 * role. The PIN is the gate, and it is checked in the database — a session that has
 * not produced a leader's PIN sees nothing here but the keypad.
 *
 * It shows the leader their own card and nothing else. There is no picker: a
 * scorecard is a conversation between a leader and their manager, and turning the
 * floor tablet into a league table of colleagues is a different product with
 * different consequences.
 */

/** A shared tablet left on a scorecard is a scorecard left open to the next person. */
const IDLE_LOCK_MS = 5 * 60_000;

type TabKey = "shift" | "month";

function periodsForNow(): Record<TabKey, ScorecardPeriod> {
  const { sessionDate, shiftCode } = getCurrentFactoryShift();
  return {
    // The shift the leader is standing in, which after midnight is still yesterday's
    // night — getCurrentFactoryShift already resolves that.
    shift: { from: sessionDate, to: sessionDate, shift: shiftCode === "day" ? "DAY" : "NIGHT" },
    month: { from: `${sessionDate.slice(0, 8)}01`, to: sessionDate, shift: "all" },
  };
}

export default function LeaderMyScorecardPage() {
  return (
    <DashboardLayout>
      <LeaderMyScorecardContent />
    </DashboardLayout>
  );
}

/**
 * The keypad and the card are two components, not two branches of one.
 *
 * Because they were one, every hook the card needs ran while the keypad was still on
 * screen — and the card needs the list of everyone's name, to say who signed off each
 * documentation verdict. So an unlocked tablet sitting on this screen fetched the
 * staff list before anyone had proved they were a leader. Nothing here reaches the
 * network until a PIN has been accepted.
 */
function LeaderMyScorecardContent() {
  const queryClient = useQueryClient();
  // Held in a ref, never in state or a query key: it must not end up in a React
  // devtools panel or a cache dump on a shared device.
  const pinRef = useRef<string | null>(null);
  const [leader, setLeader] = useState<LeaderIdentity | null>(null);
  const periods = useMemo(periodsForNow, []);

  const lock = useCallback((message?: string) => {
    pinRef.current = null;
    setLeader(null);
    queryClient.removeQueries({ queryKey: ["leader-self"] });
    if (message) toast.success(message);
  }, [queryClient]);

  const onUnlocked = (identity: LeaderIdentity, pin: string, seeded: unknown) => {
    pinRef.current = pin;
    // Seed the cache with the payload the unlock already paid for, so opening the
    // card does not cost a second round trip on a factory-floor connection.
    queryClient.setQueryData(
      ["leader-self", identity.id, periods.shift.from, periods.shift.to, periods.shift.shift],
      seeded,
    );
    setLeader(identity);
  };

  if (!leader) {
    return <LeaderPinGate period={periods.shift} onUnlocked={onUnlocked} />;
  }
  return <UnlockedScorecard leader={leader} pinRef={pinRef} periods={periods} onLock={lock} />;
}

function UnlockedScorecard({ leader, pinRef, periods, onLock }: {
  leader: LeaderIdentity;
  pinRef: React.MutableRefObject<string | null>;
  periods: Record<TabKey, ScorecardPeriod>;
  onLock: (message?: string) => void;
}) {
  const [tab, setTab] = useState<TabKey>("shift");
  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const period = periods[tab];
  const { sessionDate, shiftCode } = useMemo(() => getCurrentFactoryShift(), []);

  // Idle lock. Any tap on the card counts as activity, so a leader reading their own
  // page is never thrown out mid-sentence.
  useEffect(() => {
    const left = IDLE_LOCK_MS - (Date.now() - lastActivity);
    const t = window.setTimeout(() => onLock("Locked — the tablet was left idle."), Math.max(0, left));
    return () => clearTimeout(t);
  }, [lastActivity, onLock]);

  /**
   * Resolved at the end of the period being shown, exactly as the manager's copy does
   * it. These two screens share `computeScorecard` precisely so they cannot print
   * different numbers for the same person — feeding one of them today's weights and
   * the other the period's would have re-opened that gap from the other end.
   */
  const { data: weights = DEFAULT_WEIGHTS } = useLeaderScoreWeights(period.to);

  const cardQuery = useQuery({
    // Keyed on the leader, never on the PIN.
    queryKey: ["leader-self", leader.id, period.from, period.to, period.shift],
    enabled: !!pinRef.current,
    staleTime: 30_000,
    queryFn: async () => {
      const out = await fetchLeaderSelfScorecard(pinRef.current as string, period);
      if (out.status === "refused") throw new Error(out.message);
      return out;
    },
  });

  const { excluded, ready: attributionReady } = useLeaderAttribution();
  const result = useMemo(
    () => (cardQuery.data?.status === "ok"
      ? computeScorecard(cardQuery.data.raw, period, { weights, excludedLabels: excluded })
      : null),
    [cardQuery.data, period, weights, excluded],
  );

  const { data: profileNames = [] } = useProfileNames();
  const nameOf = useMemo(() => {
    const m = new Map(profileNames.map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [profileNames]);

  const lock = onLock;

  return (
    <div
      // 3xl left roughly a third of a 1440px screen empty down each side while the
      // figures inside were sharing four columns of nothing. The card is a document,
      // so it stays measured rather than full-bleed — but it gets the width its own
      // rows need.
      className="mx-auto w-full max-w-5xl space-y-4"
      onPointerDown={() => setLastActivity(Date.now())}
    >
      {/* Header. Wraps rather than scrolls: on a phone the three buttons drop under
          the name instead of pushing Print and Export off the right-hand edge, which
          is exactly how the manager's dialog used to lose them. */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Award className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold">{leader.name}</h1>
              <p className="text-sm text-muted-foreground">
                My Scorecard · {format(new Date(`${sessionDate}T00:00:00`), "EEEE, dd MMM yyyy")}
              </p>
              {leader.lines.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {leader.lines.map((l) => <Badge key={l} variant="secondary" className="text-2xs">{l}</Badge>)}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => cardQuery.refetch()} disabled={cardQuery.isFetching}>
              <RefreshCw className={cn("mr-1 h-4 w-4", cardQuery.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!result}
              onClick={async () => {
                const el = document.getElementById(SCORECARD_PRINT_ID);
                try {
                  if (el) await printElementAsDocument(el, `Leader Scorecard — ${leader.name}`);
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not open the print dialog.");
                }
              }}
            >
              <Printer className="mr-1 h-4 w-4" />Print
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!result}
              onClick={() => result && downloadScorecardCsv(leader.name, period, result, nameOf)}
            >
              <Download className="mr-1 h-4 w-4" />Export
            </Button>
            <Button size="sm" variant="secondary" onClick={() => lock("Locked.")}>
              <LogOut className="mr-1 h-4 w-4" />Lock
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Period. Two buttons, not a date picker: on a tablet at the end of a shift the
          question is "how did tonight go" or "how is the month going", and anything
          finer belongs on the manager's screen. */}
      {/* One strip with two segments, rather than two full-width buttons of which one
          was a solid blue slab. A period switch is a switch: it should read as one
          control with a position, not as two calls to action competing with the score
          below it. The 44px target stays — this is a gloved thumb on a tablet. */}
      <div
        className="inline-flex w-full rounded-lg border bg-muted/50 p-1"
        role="tablist"
        aria-label="Period"
      >
        {([
          ["shift", `This shift · ${SHIFT_LABEL[shiftCode]}`],
          ["month", `This month · ${format(new Date(`${periods.month.from}T00:00:00`), "MMMM")}`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={cn(
              // h-auto + whitespace-normal, not a fixed height: at 390px "This shift ·
              // Day Shift (06:00–18:00)" needs a second line, and min-h-11 keeps the
              // target at 44px however few lines it ends up using.
              "h-auto min-h-11 flex-1 whitespace-normal rounded-md px-3 py-2 text-xs font-medium transition-colors sm:text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === key
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => { setTab(key); setLastActivity(Date.now()); }}
          >
            {label}
          </button>
        ))}
      </div>

      {cardQuery.isPending ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : cardQuery.isError ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-destructive-strong" />
            <p className="text-sm font-medium">{(cardQuery.error as Error)?.message ?? "Could not load your scorecard."}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => cardQuery.refetch()}>Try again</Button>
              <Button size="sm" variant="secondary" onClick={() => lock()}>Enter PIN again</Button>
            </div>
          </CardContent>
        </Card>
      ) : !attributionReady ? (
        /* The leader is reading their own score. Showing them a worse one and then
           correcting it is the single worst place in the app to do that. */
        <p className="py-16 text-center text-sm text-muted-foreground">Working out which actions count…</p>
      ) : result ? (
        <LeaderScorecardBody leaderName={leader.name} period={period} result={result} />
      ) : null}

      <p className="pb-4 text-center text-2xs text-muted-foreground">
        This screen locks itself after five minutes without use.
      </p>
    </div>
  );
}

function LeaderPinGate({ period, onUnlocked }: {
  period: ScorecardPeriod;
  onUnlocked: (leader: LeaderIdentity, pin: string, seeded: unknown) => void;
}) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lockoutLeft, setLockoutLeft] = useState(0);

  useEffect(() => {
    if (lockoutLeft <= 0) return;
    const t = window.setTimeout(() => setLockoutLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [lockoutLeft]);

  const isLocked = lockoutLeft > 0;

  const submit = async (value: string) => {
    if (isLocked || loading || value.length < 4) return;
    setLoading(true);
    setError("");
    try {
      const out = await fetchLeaderSelfScorecard(value, period);
      if (out.status === "ok") {
        onUnlocked(out.leader, value, out);
        toast.success(`✅ ${out.leader.name}`);
        return;
      }
      setPin("");
      setError(out.message);
      if (out.lockedSeconds > 0) setLockoutLeft(out.lockedSeconds);
    } catch (e: any) {
      setPin("");
      setError(e?.message ?? "Could not reach the server. Check the tablet's connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-1 py-6 sm:py-12">
      <Card>
        <CardContent className="space-y-5 p-6 text-center sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold">My Scorecard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your line leader PIN to see your own performance and score. Nobody else's card is on this screen.
            </p>
          </div>

          {/* Centred and large enough to hit with a gloved thumb. The OTP field is the
              same one the rest of the app uses for a PIN, so the keypad behaves the
              way the floor already expects. */}
          <div className="flex justify-center">
            <InputOTP
              maxLength={4}
              value={pin}
              onChange={(v) => { setPin(v); if (v.length === 4) void submit(v); }}
              disabled={isLocked || loading}
              autoFocus
            >
              <InputOTPGroup>
                {[0, 1, 2, 3].map((i) => (
                  <InputOTPSlot key={i} index={i} mask className="h-14 w-14 text-xl" />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-left">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-strong" />
              <p className="text-sm font-medium text-destructive-strong">{error}</p>
            </div>
          )}

          <Button className="h-12 w-full text-base" onClick={() => void submit(pin)} disabled={loading || pin.length < 4 || isLocked}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLocked ? `Wait ${lockoutLeft}s` : "Open my scorecard"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
