import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getCurrentShiftEnd,
  loggingShiftOptions,
  shiftLoggingDeadline,
  SHIFT_LABEL,
  type LoggableShift,
  type ShiftCode,
} from "@/lib/shifts";

/**
 * Which shift the operator is writing up — as opposed to which one is running.
 *
 * For half an hour after every handover the two are different questions with two true
 * answers: the crew that just finished is still typing its last run while the crew that
 * just arrived is already logging in. The screen used to answer only "what is running",
 * so a quantity entered at 18:05 went to the night. This holds the operator's answer for
 * the whole screen, so the session lookup, the leader PIN gate, the times typed by hand
 * and the deadline warning cannot disagree with each other.
 */

export type Shift = "DAY" | "NIGHT";

const shiftName = (c: ShiftCode): Shift => (c === "night" ? "NIGHT" : "DAY");

/** One handover, one question. Keyed by the instant the window shuts, so the answer
 *  cannot survive into the next handover twelve hours later. */
const storageKey = (graceEndsAt: Date) => `an_logging_shift_${graceEndsAt.toISOString()}`;

/** Private browsing and locked-down tablets throw on storage. A device that cannot
 *  remember the answer must still be able to give it, so it just asks again. */
function readChoice(graceEndsAt: Date): Shift | null {
  try {
    const v = sessionStorage.getItem(storageKey(graceEndsAt));
    return v === "DAY" || v === "NIGHT" ? v : null;
  } catch {
    return null;
  }
}

function writeChoice(graceEndsAt: Date, shift: Shift) {
  try {
    sessionStorage.setItem(storageKey(graceEndsAt), shift);
  } catch {
    /* nothing to do — the choice lives in React state for this visit */
  }
}

export interface LoggingShiftValue {
  /** The shift being written to. Everything on the screen files under this. */
  sessionDate: string;
  shift: Shift;
  shiftCode: ShiftCode;
  shiftLabel: string;
  /** Last moment the database will accept this shift from an operator. */
  deadline: Date;
  /** True while both shifts are open — the half hour after a handover. */
  handoverOpen: boolean;
  /** True while the window is open and nobody has answered yet. */
  needsChoice: boolean;
  /** True when the operator chose the shift that has already ended. */
  isCarriedOver: boolean;
  graceEndsAt: Date | null;
  incoming: LoggableShift;
  outgoing: LoggableShift | null;
  choose: (which: "incoming" | "outgoing") => void;
}

const Ctx = createContext<LoggingShiftValue | null>(null);

export function LoggingShiftProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => new Date());

  const options = useMemo(() => loggingShiftOptions(now), [now]);

  const graceEndsAtMs = options.graceEndsAt?.getTime() ?? null;

  /**
   * Wake exactly on the next instant that changes the answer — the moment the window
   * shuts if one is open, otherwise the next handover — instead of polling.
   *
   * A tablet on this screen sits untouched for hours; a timer that fired every few
   * seconds would re-render the whole form all shift long to catch two moments a day.
   */
  const nextWakeMs = useMemo(
    () => graceEndsAtMs ?? getCurrentShiftEnd(now).getTime(),
    [graceEndsAtMs, now],
  );

  useEffect(() => {
    // Never zero: a timeout that fires in the millisecond it was set spins the tab.
    const t = setTimeout(() => setNow(new Date()), Math.max(1_000, nextWakeMs - Date.now() + 1_000));
    return () => clearTimeout(t);
  }, [nextWakeMs]);

  const [choice, setChoice] = useState<Shift | null>(null);

  // A stored answer survives a reload, which a tablet does often enough to matter.
  useEffect(() => {
    setChoice(graceEndsAtMs === null ? null : readChoice(new Date(graceEndsAtMs)));
  }, [graceEndsAtMs]);

  const choose = useCallback(
    (which: "incoming" | "outgoing") => {
      const picked = which === "outgoing" ? options.outgoing : options.incoming;
      if (!picked) return;
      const s = shiftName(picked.shiftCode);
      setChoice(s);
      if (options.graceEndsAt) writeChoice(options.graceEndsAt, s);
    },
    [options.incoming, options.outgoing, options.graceEndsAt],
  );

  const value = useMemo<LoggingShiftValue>(() => {
    const { incoming, outgoing, graceEndsAt } = options;
    // Outside the window there is one shift and no question. Inside it, an unanswered
    // question falls back to the shift that is running — the same answer as before this
    // existed, so a dialog dismissed by a stray tap cannot make things worse than they were.
    const active = outgoing && choice === shiftName(outgoing.shiftCode) ? outgoing : incoming;
    return {
      sessionDate: active.sessionDate,
      shift: shiftName(active.shiftCode),
      shiftCode: active.shiftCode,
      shiftLabel: SHIFT_LABEL[active.shiftCode],
      deadline: shiftLoggingDeadline(active.sessionDate, shiftName(active.shiftCode)),
      handoverOpen: !!outgoing,
      needsChoice: !!outgoing && choice === null,
      isCarriedOver: !!outgoing && active === outgoing,
      graceEndsAt,
      incoming,
      outgoing,
      choose,
    };
  }, [options, choice, choose]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The shift the operator is logging into.
 *
 * Deliberately throws outside the provider rather than falling back to the running
 * shift: a silent fallback here is exactly the bug this replaced, and it took a
 * fortnight of production landing on the wrong shift before anyone noticed.
 */
export function useLoggingShift(): LoggingShiftValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLoggingShift must be used inside <LoggingShiftProvider>");
  return ctx;
}
