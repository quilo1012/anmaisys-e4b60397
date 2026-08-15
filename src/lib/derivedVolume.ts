export type DerivedVolume = {
  planned_volume: number | null;
  actual_volume: number | null;
  unplanned_downtime_minutes: number | null;
  source_label: string | null;
};

/**
 * Marca a origem do numero gravado. Existe para que uma correccao a mao seja visivel na
 * auditoria: sem isto, um valor corrigido e um valor derivado sao indistinguiveis.
 */
export function sourceFor(typed: number | null, derived: number | null): "derivado" | "manual" | null {
  if (typed === null) return null;
  return typed === derived ? "derivado" : "manual";
}
