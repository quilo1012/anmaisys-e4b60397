import { isBlank, type ScorecardEntryDraft } from "./scorecardEntry";

/**
 * O espelho de trg_scorecard_require_capa, e apenas isso: serve para dizer a quem
 * preenche o que falta, ANTES de a base recusar. Quem manda continua a ser o trigger; se
 * os dois discordarem, o trigger e que esta certo.
 */
export function approvalBlockers(
  draft: ScorecardEntryDraft,
  verdict: { quality_fail_type: string | null } | null,
): string[] {
  if (verdict?.quality_fail_type !== "Fail") return [];
  const missing: string[] = [];
  if (isBlank(draft.root_cause)) missing.push("Root cause");
  if (isBlank(draft.corrective_action)) missing.push("Corrective action");
  if (isBlank(draft.capa_owner)) missing.push("CAPA owner");
  if (isBlank(draft.capa_due_date)) missing.push("CAPA due date");
  return missing;
}

/**
 * `capa_status` arrives from the database enum in Portuguese — that is DATA,
 * unchanged by this function — and is translated for display only, the same
 * shape as `stateLabel()` in `src/lib/scorecardWeek.ts` for the board's four
 * states. `null`/unrecognised reads as "—", never as a guessed status.
 */
export function capaStatusLabel(status: string | null): string {
  const labels: Record<string, string> = {
    Aberta: "Open",
    "Em Andamento": "In Progress",
    Concluida: "Completed",
    Verificada: "Verified",
  };
  return status ? labels[status] ?? status : "—";
}

/**
 * `scorecard_downtime_reason` is the same split as `capa_status`: the six enum
 * values are DATA, in the database's Portuguese, and only the visible text is
 * English. The dropdown that writes this column used to offer a vocabulary
 * borrowed from `RecordMissedDowntime.tsx` ("Mechanical stop", "Leak", …) — a
 * different table's words, which this enum rejects outright, making the field
 * unusable. Sits beside `capaStatusLabel` so the two translations that face the
 * same screen stay in one place and one shape.
 */
export function downtimeReasonLabel(reason: string | null): string {
  const labels: Record<string, string> = {
    Quebra: "Breakdown",
    "Falta de Materia Prima": "No raw material",
    "Troca de Mix": "Mix changeover",
    "Falta de Pessoal": "Short staffed",
    Outro: "Other",
    NA: "Not applicable",
  };
  return reason ? labels[reason] ?? reason : "—";
}
