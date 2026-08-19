import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isMissingTable } from "@/lib/postgrestErrors";

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
    /**
     * The table itself is not there, so NO exclusion is in force anywhere.
     *
     * Separate from `failed` because it is the one failure with a specific, actionable
     * cause: the migration has not been applied to this database. Every other failure
     * is transient or a permission problem. This is what the lists manager says out
     * loud — otherwise a leader is charged for a machine failure and the screen that
     * is supposed to govern that shows nothing at all.
     */
    missing: isMissingTable(query.error as { code?: string } | null),
  };
}

/**
 * Turning one label's attribution on or off, from the lists manager.
 *
 * An upsert rather than an update: the seed lists only the labels that were excluded
 * on day one, so switching OFF a label that has always counted has no row to update.
 * `label` is the primary key, so the upsert lands on the right row either way.
 *
 * Invalidates the action queries as well as its own, and still has to under the freeze.
 *
 * Before 20260822090000 the reason was blunt: `actionPoints()` read the exclusion set
 * on every render, so every action carrying this label changed value the moment this
 * saved. With the freeze, past actions keep what they were worth — but the save opens a
 * new scoring version, and an action logged TODAY was frozen against the version this
 * just replaced. The board still has to redraw, for a narrower reason than before.
 *
 * Leaving it showing the old total is how the module loses its credibility again.
 */
export function useSetLabelAttribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ label, counts, note }: { label: string; counts: boolean; note?: string | null }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- newer than the generated types
      const { error } = await (supabase as any)
        .from("quality_label_attribution")
        .upsert({ label, counts_against_leader: counts, note: note ?? null }, { onConflict: "label" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quality_label_attribution"] });
      qc.invalidateQueries({ queryKey: ["quality_actions"] });
      qc.invalidateQueries({ queryKey: ["analytics-quality"] });
    },
  });
}
