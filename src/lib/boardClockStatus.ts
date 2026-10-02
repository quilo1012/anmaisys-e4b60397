/**
 * What a board's clock status actually means, decided once and in the open.
 *
 * `fn_board_clock_status` answers in four numbers and a word, and the word alone is
 * not enough to put on a screen. The case that matters is `clocked` with nobody
 * comparable: on the night board of 05/09/2026 the function returns `clocked`, because
 * the day had 99 clock rows and nothing disagreed — but `covered_people` is 0, because
 * exactly two of the 64 active night crew have ever appeared in TimeMoto at all.
 * Nothing was compared. A tick there says the board was checked and found right, which
 * is the one thing that definitely did not happen.
 *
 * So the verdict is its own value, separate from the status the database returns, and
 * it is a pure function because this is the part that will be got wrong again.
 */

export type BoardClockStatus = "planned" | "clocked" | "differs";

export interface BoardClockRow {
  status: BoardClockStatus | string;
  clock_rows: number;
  covered_people: number;
  differs: number;
}

export type BoardClockVerdict =
  /** No clock rows for this day at all — nothing has been imported for it. */
  | { kind: "no_clock" }
  /** The day has clock rows, but nobody on this board has ever been in the clock. */
  | { kind: "no_basis" }
  /** Everybody comparable on this board agrees with the clock. */
  | { kind: "agrees"; compared: number }
  /** Some comparable people disagree. */
  | { kind: "differs"; differs: number; compared: number };

export function boardClockVerdict(row: BoardClockRow | null | undefined): BoardClockVerdict | null {
  if (!row) return null;

  const clockRows = Number(row.clock_rows ?? 0);
  const compared = Number(row.covered_people ?? 0);
  const differs = Number(row.differs ?? 0);

  // Asked first, and off the row count rather than off `status`: a day with no clock
  // is the common case (30 of the board's 82 days) and it is not a finding about
  // anybody. The function already returns differs = 0 here; this keeps the screen from
  // depending on that promise.
  if (clockRows === 0) return { kind: "no_clock" };

  // Before any verdict about agreement: with nobody comparable there is no comparison,
  // whatever `status` says.
  if (compared === 0) return { kind: "no_basis" };

  if (differs > 0) return { kind: "differs", differs, compared };
  return { kind: "agrees", compared };
}

/** Short enough for a badge; the long form is the title. */
export function boardClockLabel(v: BoardClockVerdict): string {
  switch (v.kind) {
    case "no_clock": return "Planned only";
    case "no_basis": return "No clock cover";
    case "agrees": return "Matches clock";
    case "differs": return `${v.differs} differ`;
  }
}

/** The sentence a reader needs before they act on the badge. */
export function boardClockTitle(v: BoardClockVerdict): string {
  switch (v.kind) {
    case "no_clock":
      return "No clock rows have been imported for this day, so the board is a plan nobody has checked against the door yet.";
    case "no_basis":
      return "The day has clock rows, but nobody on this board has ever appeared in TimeMoto — there is nothing here to compare, so this is not an agreement.";
    case "agrees":
      return `All ${v.compared} ${v.compared === 1 ? "person" : "people"} on this board who appear in the clock agree with it.`;
    case "differs":
      return `${v.differs} of ${v.compared} comparable ${v.compared === 1 ? "person" : "people"} disagree between the board and the clock — either planned and did not clock, or clocked and are not on the board.`;
  }
}

/**
 * The three ways a board and the clock can fail to line up, and what each one means.
 *
 * Two of them are disagreements and the third is not, which is the whole reason the
 * third exists. `not_comparable` is somebody on the board the clock has never seen —
 * 113 of 211 active people, and 62 of the 64 on the night crew. Counting them as
 * disagreements would accuse somebody of missing work on the strength of a row that
 * was never written; leaving them out entirely would let "zero disagreements" on the
 * night board read as "the board was right", when it means there was nobody to check.
 *
 * So they are shown, and kept out of the count. The two that ARE counted sum exactly
 * to `v_board_clock_status.differs` — verified across all 123 (date, board) pairs,
 * 712 against 712 — because a detail screen that disagrees with the badge above it is
 * the failure this module has already made twice.
 */
export type ReconciliationKind = "planned_not_clocked" | "clocked_not_planned" | "not_comparable";

export interface ReconciliationKindMeta {
  kind: ReconciliationKind;
  label: string;
  /** One sentence, for the reader who is about to ask somebody about it. */
  meaning: string;
  /** False for the kind that is context rather than a finding. */
  counts: boolean;
}

export const RECONCILIATION_KINDS: ReconciliationKindMeta[] = [
  {
    kind: "planned_not_clocked",
    label: "Planned, not clocked",
    meaning: "On the board for the day, known to the clock, and no hours recorded against them.",
    counts: true,
  },
  {
    kind: "clocked_not_planned",
    label: "Clocked, not planned",
    meaning: "Hours recorded on a day this board does not have them on it.",
    counts: true,
  },
  {
    kind: "not_comparable",
    label: "No clock record at all",
    meaning:
      "On the board, and the clock has never seen this person on any day. Not a disagreement — there is nothing to compare, and it is why a board can show no disagreements without having been checked.",
    counts: false,
  },
];

export function reconciliationMeta(kind: string): ReconciliationKindMeta | null {
  return RECONCILIATION_KINDS.find((k) => k.kind === kind) ?? null;
}

/** Counts per kind, and the total that is actually a disagreement. */
export function summariseReconciliation(rows: ReadonlyArray<{ kind: string }>) {
  const byKind = new Map<string, number>();
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  const count = (k: ReconciliationKind) => byKind.get(k) ?? 0;
  return {
    plannedNotClocked: count("planned_not_clocked"),
    clockedNotPlanned: count("clocked_not_planned"),
    notComparable: count("not_comparable"),
    /** What the badge would show for the same period. `not_comparable` is NOT in it. */
    disagreements: count("planned_not_clocked") + count("clocked_not_planned"),
  };
}
