/**
 * Re-export. The parser lives with the sync — `supabase/functions/_shared/
 * safetyculture/productNote.ts` — because the sync is what writes `sku` and
 * `batch` from it, and the Excel report reads the same sentence as a fallback for
 * the rows written before the sync learned to. One implementation, so the two can
 * never disagree about what an operator's note says.
 */
export { parseProductNote, resolveSkuFromNote, type ProductNote } from "../../supabase/functions/_shared/safetyculture/productNote";
