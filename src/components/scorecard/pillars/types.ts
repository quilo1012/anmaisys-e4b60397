import type { ScorecardEntryDraft } from "@/lib/scorecardEntry";

/**
 * The one write path every pillar is given — `useScorecardEntry.ts`'s `setField`,
 * unchanged. A pillar that wrote to Supabase directly would bypass the serialized
 * save queue that hook exists to guarantee; none of them may.
 */
export type SetField = <K extends keyof ScorecardEntryDraft>(
  key: K,
  value: ScorecardEntryDraft[K],
) => void;
