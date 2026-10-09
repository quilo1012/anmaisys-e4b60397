import { actionPoints, type ScorableAction } from "@/lib/qualityConstants";
import { leaderNameKey } from "@/lib/leaderNameMatch";

/**
 * How many actions raised in a period are still on the working board, and whose.
 *
 * The Leader Performance card had two numbers from one query that answered two
 * different questions without saying so. The "Open Actions" tile was the sum of the
 * table's column, and the table only has a row for a leader who ran a session in the
 * period — it is built from the session log. The documentation panel beside it counted
 * every validated action in the period, session or no session. So an action raised
 * against somebody who led no logged session that week was in one number and missing
 * from the other, and the tile's own label — "Actions raised in this period and still
 * to do or in progress" — promised the second behaviour while doing the first.
 *
 * The tile now answers its label. The table stays a table of people who worked, which
 * is what it is for; the difference between the two is reported underneath it rather
 * than left for somebody to find by adding the column up.
 */

export type BoardAction = ScorableAction & {
  leader_name?: string | null;
  status?: string | null;
};

/**
 * Still on the working board.
 *
 * This screen's question, deliberately not part of what an action is worth: a
 * rejected action is worth nothing and is still closed, and `actionPoints` is the
 * authority on the first of those, not on the second.
 */
export function isOnTheWorkingBoard(a: { status?: string | null }): boolean {
  return a.status === "todo" || a.status === "in_progress";
}

export type OpenTally = {
  /** Actions still on the board. */
  open: number;
  /** What they are worth, by the one pricing rule — `actionPoints`. */
  points: number;
  /** Of those, how many are high or critical. */
  critical: number;
};

const EMPTY: OpenTally = { open: 0, points: 0, critical: 0 };

function add(t: OpenTally, a: BoardAction, excluded: Set<string>): OpenTally {
  return {
    open: t.open + 1,
    points: t.points + actionPoints(a, excluded),
    critical: t.critical + (a.severity === "high" || a.severity === "critical" ? 1 : 0),
  };
}

/** Every open action in the rows given, whoever it belongs to. */
export function tallyOpenActions(rows: BoardAction[], excluded: Set<string>): OpenTally {
  let t = EMPTY;
  for (const a of rows) {
    if (!isOnTheWorkingBoard(a)) continue;
    t = add(t, a, excluded);
  }
  return t;
}

export type OpenActionSplit = {
  /** What the tile shows: every open action raised in the period. */
  all: OpenTally;
  /** The part of it the table can account for, leader by leader. */
  withSession: OpenTally;
  /**
   * The part it cannot: open actions against a leader who ran no session in this
   * period, and so has no row. Zero means the tile and the column agree and there is
   * nothing to explain.
   */
  withoutSession: OpenTally;
  /** How many such leaders there are, for the sentence under the table. */
  leadersWithoutSession: number;
};

/**
 * Split the period's open actions by whether the leader has a row in the table.
 *
 * `leadersWithSession` holds keys from `leaderNameKey`, not raw names: the log spells
 * five of these people in capitals and the tablet does not, and keying on the raw
 * string would file the same person under two headings — which is the bug this
 * function would otherwise reintroduce while fixing another one.
 */
export function splitOpenActionsBySession(
  rows: BoardAction[],
  leadersWithSession: Set<string>,
  excluded: Set<string>,
): OpenActionSplit {
  let all = EMPTY;
  let withSession = EMPTY;
  let withoutSession = EMPTY;
  const strangers = new Set<string>();

  for (const a of rows) {
    if (!isOnTheWorkingBoard(a)) continue;
    const leader = leaderNameKey(a.leader_name);
    all = add(all, a, excluded);
    // An action with no leader on it belongs to nobody's row, so it is part of the
    // difference the note explains — but it adds no name to the count of leaders.
    if (leader && leadersWithSession.has(leader)) {
      withSession = add(withSession, a, excluded);
    } else {
      withoutSession = add(withoutSession, a, excluded);
      if (leader) strangers.add(leader);
    }
  }

  return { all, withSession, withoutSession, leadersWithoutSession: strangers.size };
}
