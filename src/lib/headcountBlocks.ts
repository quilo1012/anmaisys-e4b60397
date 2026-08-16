/**
 * Which block an area is drawn in.
 *
 * `section` decides, and it is not the same question as `kind`. Hygiene, Quality and
 * Runner are support in the totals and sit in the production block on the board,
 * because that is where the factory's own sheet puts them — the people planning the
 * day read them alongside the lines they serve.
 *
 * The fallback matters more than it looks. The board used to filter on `section`
 * alone against a fixed list of four, so an area whose section was renamed, misspelt
 * or left blank vanished from the board entirely while its allocations carried on
 * being saved. Anything unrecognised now lands in the block its `kind` implies,
 * which is wrong at worst and invisible never.
 *
 * It lives here rather than in the page because the test kept its own copy of it,
 * under a comment saying "mirrors blockOf in ProductionHeadcountPage" — and the copy
 * had drifted: it knew two blocks where the board draws three. It passed either way,
 * because the only function it ever called was its own.
 */
export const HEADCOUNT_BLOCKS = ["production", "sectors", "support"] as const;

export type HeadcountBlock = (typeof HEADCOUNT_BLOCKS)[number];

export function blockOf(area: { section: string | null; kind: string }): HeadcountBlock {
  const s = (area.section ?? "").toLowerCase();
  if (s === "production" || s === "sectors" || s === "support") return s;
  return area.kind === "production" ? "production" : "support";
}
