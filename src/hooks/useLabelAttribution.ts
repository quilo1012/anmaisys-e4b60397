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
 * An action is the leader's only if at least one of its labels is attributable.
 *
 * An action with NO labels still counts: the alternative is that leaving the labels
 * blank quietly removes a deviation from somebody's score, which is the kind of gap
 * people find by accident and then use.
 */
export function countsAgainstLeader(
  action: { labels?: string[] | null },
  excluded: Set<string>,
): boolean {
  const labels = (action.labels ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean);
  if (labels.length === 0) return true;
  return labels.some((l) => !excluded.has(l));
}
