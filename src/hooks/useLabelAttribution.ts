import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Which quality labels are the shift leader's to answer for.
 *
 * An action raised on a line is not automatically the leader's doing. A machine
 * failure is maintenance's. A GMP finding is raised against the line, not against the
 * person running it that night. Charging those to the leader's score makes the score
 * measure who was unlucky rather than who did the job.
 *
 * A table rather than a list in code, because which labels belong to whom is the
 * factory's judgement and it will change. Anything not listed counts — a new label
 * has to be excluded on purpose, so nothing silently stops counting.
 */
export interface LabelAttribution {
  label: string;
  counts_against_leader: boolean;
  note: string | null;
}

export function useLabelAttribution() {
  return useQuery({
    queryKey: ["quality_label_attribution"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<LabelAttribution[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- newer than the generated types
      const { data, error } = await (supabase as any).from("quality_label_attribution").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** The labels that do NOT count against a leader, lowercased for comparison. */
export function excludedLabelSet(rows: LabelAttribution[] | undefined): Set<string> {
  return new Set((rows ?? []).filter((r) => !r.counts_against_leader).map((r) => r.label.trim().toLowerCase()));
}

/**
 * The attribution set, plus whether it is safe to draw points with it yet.
 *
 * The trap this exists to close: `excludedLabelSet(undefined)` is an empty set, and an
 * empty set is a perfectly valid answer meaning "nothing is excluded". So a screen
 * that renders while the query is in flight shows every leader their UNFILTERED total,
 * then snaps to the real one a moment later. It reads as a bug, and it undermines
 * exactly the confidence this module is trying to rebuild.
 *
 * `ready` is success, not settled: if the table cannot be read we would rather show a
 * dash than a number we know is too high.
 */
export function useLeaderAttribution() {
  const query = useLabelAttribution();
  const excluded = useMemo(() => excludedLabelSet(query.data), [query.data]);
  return {
    excluded,
    /** Points may be drawn. */
    ready: query.isSuccess,
    /** Attribution could not be read — show a dash and say why, do not show a total. */
    failed: query.isError,
  };
}
