/**
 * A part code typed on the line, matched to the catalogue by the code itself.
 *
 * The logging form links a SKU only when the operator taps a row in the list.
 * Typed and saved without that tap, the code was stored as free text — and the
 * Production Control screen showed it with a ⚠ and no product, even when it was
 * a code the catalogue holds. On 28/10 that was "Bagcw6c" on Line 5 night (the
 * catalogue has BAGCW6C) and "CORGS" on Line 3 night, typed exactly as the
 * catalogue spells it. Sixteen rows were on file like this, every one of them a
 * real code.
 *
 * So the save matches what was typed against `sku_products.code`, ignoring case
 * and spacing. Only the code, and only an exact one: "Critical whey vanilla
 * 825g" is not matched to a product by its name, and a typo stays a typo (see
 * `identifyItemSku` in lineSku.ts — guessing would invent production no record
 * supports).
 */

export interface CatalogueSkuCandidate {
  id: string;
  code: string | null;
  name: string | null;
  active?: boolean | null;
}

/** Case, surrounding spaces and runs of spaces do not make a different code. */
export function skuCodeKey(code: string | null | undefined): string {
  return String(code ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * An ILIKE pattern that matches `code` literally, case-insensitively. `%`, `_`
 * and `\` are wildcards/escapes to ILIKE, and a code is not a pattern.
 */
export function literalIlikePattern(code: string): string {
  return code.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The one catalogue row the typed code names, or null.
 *
 * Active rows win over retired ones. If two active rows still share the code
 * (kSABEEFXPBM and KSABEEFXPBM both exist), the one spelled exactly as typed
 * wins; failing that the code is ambiguous and is left as typed, for an admin
 * to reconcile — the same as before.
 */
export function pickSkuForTypedCode<T extends CatalogueSkuCandidate>(rows: readonly T[], typed: string): T | null {
  const k = skuCodeKey(typed);
  if (!k) return null;
  const same = rows.filter((r) => skuCodeKey(r.code) === k);
  if (same.length === 0) return null;
  const active = same.filter((r) => r.active !== false);
  const pool = active.length > 0 ? active : same;
  if (pool.length === 1) return pool[0];
  const verbatim = pool.filter((r) => String(r.code ?? "").trim() === typed.trim());
  return verbatim.length === 1 ? verbatim[0] : null;
}
