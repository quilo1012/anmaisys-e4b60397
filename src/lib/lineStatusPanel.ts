/**
 * The Control Centre's "Line status" panel, built from the same witness the
 * production board uses.
 *
 * WHY THIS FILE EXISTS. The panel used to answer a different question from the one
 * its title asks. Its only input was `work_orders`: a line was "down" when an open
 * order carried `line_stopped` and no `line_resumed_at`, and every other line was
 * printed "Running" in green. iTouching was never read.
 *
 * On 13/08 at 09:27 UTC that produced a screen with ten green lines while the
 * vendor's own panel, on the next desk, showed six machines standing still —
 * Capsules MC 1 and the GEL Line on `No Planned Shift`, Capsules MC 2 on `Line
 * Preparation`, Filler Lines 1 and 6 on `Filling Blender/ Blending`. The GEL Line
 * had been stopped since 17:06 the previous day. Nobody had raised a work order for
 * any of them, because none of them is a breakdown — and the panel has no way to
 * know that a line nobody called an engineer about is not therefore running.
 *
 * So the state comes from iTouching now, through `classifyLive`, which is the same
 * function and the same view (`v_line_live_status`) the production board reads. Two
 * screens in this app disagreeing about which lines are running is how a floor
 * learns to believe neither.
 *
 * WHAT THE WORK ORDER STILL SAYS, AND WHY IT IS KEPT. It answers its own question:
 * an engineer was called out and nobody has resumed the line. That is not the same
 * fact as "the machine is not moving", it is not always true at the same minutes,
 * and neither one may quietly stand in for the other. It rides beside the state as
 * its own count.
 */

import { classifyLive, formatStopDuration, type LiveReading, type LiveStatus } from "./lineLiveStatus";
import { ITOUCH_RUNNING, stopColour } from "./intouchStopColours";

export interface LineStatusRow {
  id: string;
  name: string;
  /** iTouching's reading, classified exactly as the production board classifies it. */
  live: LiveStatus;
  /**
   * iTouching's own colour for this exact state — its green for a running line, the
   * panel's hue for the named stop — or null where this board cannot say what the
   * state is and must not borrow a colour that means something.
   */
  hue: string | null;
  /** How long the stop has run, in iTouching's H:MM:SS. Null when there is nothing to time. */
  stopFor: string | null;
  /** Open work orders saying this line is stopped and nobody resumed it. */
  woStopped: number;
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/**
 * Worst first, which is the rule the rest of this screen already follows: an
 * unplanned stop, then a planned one, then the states this board cannot read, and
 * the running lines last. A supervisor opening the Control Centre is looking for
 * what needs a person, and alphabetical order buries it behind Capsules.
 */
const RANK: Record<LiveStatus["state"], number> = {
  UNPLANNED_STOP: 0,
  STOPPED_NO_CODE: 1,
  PLANNED_STOP: 2,
  UNKNOWN_STATUS: 3,
  NO_SIGNAL: 4,
  NOT_MAPPED: 5,
  RUNNING: 6,
};

export function buildLineStatusRows(
  lines: Array<{ id: string; name: string }>,
  liveByLine: Map<string, LiveReading>,
  woStoppedByLine: Map<string, number>,
  now: Date,
): LineStatusRow[] {
  return lines
    .map((l) => {
      const live = classifyLive(liveByLine.get(norm(l.name)), now);
      const hue = live.state === "RUNNING"
        ? ITOUCH_RUNNING
        : live.state === "PLANNED_STOP" || live.state === "UNPLANNED_STOP"
          ? stopColour(live.label)
          : null;
      return {
        id: l.id,
        name: l.name,
        live,
        hue,
        stopFor: formatStopDuration(live.stoppedForSeconds),
        woStopped: woStoppedByLine.get(l.name) ?? 0,
      };
    })
    .sort((a, b) => RANK[a.live.state] - RANK[b.live.state] || a.name.localeCompare(b.name));
}
