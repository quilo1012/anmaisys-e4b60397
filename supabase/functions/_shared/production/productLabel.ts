/**
 * Catalogue names carry customs codes — "DIET WHEY (BAG) 450G VANILLA CREAM
 * [HS CODE:2106108070]" — and the bracket is longer than the part anyone on the
 * floor reads, which is the flavour or the market. On a card three inches wide it
 * pushes the useful half out of view entirely.
 *
 * Shared because two screens now name the same product and there is no version of
 * this where they should disagree about how.
 */
export function productLabel(name: string | null | undefined): string {
  return String(name ?? "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
