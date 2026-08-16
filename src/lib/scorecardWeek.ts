/** One row from the scorecard week board, as returned by `scorecard_week_board`. */
export type ScorecardBoardRow = {
  leader_id: string;
  leader_name: string;
  line_id: string;
  line_name: string;
  /** Null when the week has not yet been created. */
  entry_id: string | null;
  state: "por preencher" | "rascunho" | "submetida" | "aprovada";
  volume_rag: string | null;
  quality_rag: string | null;
  hs_rag: string | null;
  overall_rag: string | null;
  rag_driver: string | null;
  capa_required: boolean | null;
  /** Null for a week not yet created, or one whose three check sheets are all blank. */
  score_final: number | null;
  /** The weighted sum before any ceiling. Null under the same conditions as `score_final`. */
  score_bruto: number | null;
  /** Why a ceiling applied, when one did. Null under the same conditions as `score_final`. */
  cap_reason: string | null;
  /** Null when there is no week at all. */
  cap_applied: boolean | null;
};

/**
 * The score for the screen: floored to an integer, never rounded to nearest — a 99.7
 * that prints as "100" is a deduction that rounded itself away (see `displayScore` in
 * `leaderScore.ts`, which this mirrors). A missing score prints a dash, never a zero:
 * "no data" and "zero" are different facts and this board must not blur them.
 */
export function formatScore(score: number | null): string {
  return score === null ? "—" : String(Math.floor(score));
}

export type ScoreCell = {
  /** What the Score column prints — a dash or a floored integer, never a rounded one. */
  text: string;
  /** The full cap sentence, only when a ceiling actually applied to this row. */
  capReason: string | null;
};

/**
 * What the Score column needs, pre-decided: the JSX should not be the place that asks
 * whether a cap applied or floors a number.
 */
export function scoreCell(
  row: Pick<ScorecardBoardRow, "score_final" | "cap_applied" | "cap_reason">
): ScoreCell {
  return {
    text: formatScore(row.score_final),
    capReason: row.cap_applied ? row.cap_reason : null,
  };
}

/** The Sunday that closes the week for any given date. */
export function weekEndingFor(d: Date): string {
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  out.setUTCDate(out.getUTCDate() + ((7 - out.getUTCDay()) % 7));
  return out.toISOString().slice(0, 10);
}

/** Counts the scorecard actions still outstanding on a board. */
export function boardCounts(rows: ScorecardBoardRow[]) {
  return {
    toFill: rows.filter((r) => r.state === "por preencher").length,
    toApprove: rows.filter((r) => r.state === "submetida").length,
    capasOpen: rows.filter(
      (r) => r.capa_required === true && r.state !== "aprovada"
    ).length,
  };
}

/** Maps Portuguese state values to English labels. */
export function stateLabel(
  state: ScorecardBoardRow["state"]
): string {
  const labels: Record<ScorecardBoardRow["state"], string> = {
    "por preencher": "To fill",
    rascunho: "Draft",
    submetida: "Submitted",
    aprovada: "Approved",
  };
  return labels[state];
}
