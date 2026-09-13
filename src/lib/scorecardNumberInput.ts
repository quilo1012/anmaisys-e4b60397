/**
 * Parses a number `<input>`'s raw text into what the draft actually wants: `null`
 * for an untouched/cleared field, never `0`. Shared by every pillar so "empty
 * stays empty" has one definition instead of four copies that could drift.
 */
export function parseNullableNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/**
 * The four percentage columns — `ppe_compliance_pct`,
 * `hs_training_compliance_pct`, `leader_attendance_pct`, `team_attendance_pct` —
 * are `numeric(5,4)` constrained `BETWEEN 0 AND 1`, and the thresholds they are
 * judged against (`THR_HSTrainRed`, `THR_HSTrainGreen`, `THR_Attend`) are
 * fractions too. So the fraction is the truth and it stays on the wire; what was
 * wrong was the label. A box labelled "PPE compliance %" next to a bare
 * `type="number"` invites `95`, and the database refuses the row.
 *
 * One definition, used by Health & Safety and by Monitored alike — the two bands
 * that hold these columns — so no component scales or bounds them on its own.
 */
export const FRACTION_INPUT = { min: 0, max: 1, step: 0.01 } as const;

/** "PPE compliance" -> "PPE compliance (0–1)". The unit is part of the question. */
export function fractionLabel(label: string): string {
  return `${label} (0–1)`;
}

/** Counters: whole, never negative — `CHECK (… >= 0)` on every one of them. */
export const COUNT_INPUT = { min: 0, step: 1 } as const;

/**
 * O que fazer com o texto que acabou de ser teclado num campo numerico.
 *
 * Existe por causa dos quatro campos de fraccao: `numeric(5,4)` entre 0 e 1, ou seja
 * numeros que SO se escrevem com ponto decimal. Um `<input type="number">` controlado
 * por `value={n ?? ""}` e impossivel de teclar, e por duas razoes de uma vez:
 *
 *   - `Number("0.")` da 0, portanto o estado volta a "0" e o ponto desaparece no
 *     instante em que e teclado;
 *   - num browser real o proprio input devolve `value === ""` enquanto o texto nao
 *     for um numero completo (marca `validity.badInput`), portanto o campo esvazia-se.
 *
 * Em qualquer dos caminhos o utilizador nunca chega a `0.95`. A saida e distinguir
 * "isto ja e um numero" de "isto ainda esta a ser escrito" e nao propagar o segundo.
 */
export type NumberEdit =
  /** Ha um numero (ou um campo genuinamente vazio): pode ir para o rascunho. */
  | { kind: "value"; value: number | null }
  /** Texto a meio — "0.", "-", "." — ou lixo: guarda-se o texto e nao se escreve nada. */
  | { kind: "pending" };

export function readNumberEdit(raw: string): NumberEdit {
  const t = raw.trim();
  if (t === "") return { kind: "value", value: null };
  // Prefixos que ainda nao sao numero nenhum: "-", "+", ".", "0.", "-12."
  if (/^[+-]?(\d*\.)?$/.test(t)) return { kind: "pending" };
  const n = Number(t);
  // Lixo ("abc") tambem fica pendente, e nao apaga o que la estava: apagar exige
  // esvaziar o campo, que e o unico caso em que este modulo devolve `null`.
  return Number.isFinite(n) ? { kind: "value", value: n } : { kind: "pending" };
}
