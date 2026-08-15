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
