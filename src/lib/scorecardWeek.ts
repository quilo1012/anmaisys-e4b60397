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
};

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
