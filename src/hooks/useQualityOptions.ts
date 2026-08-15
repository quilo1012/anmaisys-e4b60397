import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { QUALITY_LABELS, QUALITY_DEPARTMENTS, setLabelPoints } from "@/lib/qualityConstants";

export interface QualityOption {
  id: string;
  kind: "label" | "department";
  value: string;
  active: boolean;
  sort: number;
  /** What this label charges an action. 0 = unpriced, so severity decides. */
  points: number;
}

/** Postgres for "no such column" — the only error we are willing to paper over. */
const UNDEFINED_COLUMN = "42703";

/**
 * The options, asked for with `points` and again without it if the column is not
 * there yet.
 *
 * The column arrives in a migration, and a migration in this repo is not proof that
 * production has it. Without this fallback the whole Quality module loses its label
 * and department lists — the pickers, the log form, the manager — on an error that
 * has nothing to do with any of them. Unpriced is the correct reading of a database
 * that has never heard of pricing.
 *
 * Delete this once the migration is confirmed applied; it hides a real schema drift.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
type OptionQuery = any;

async function selectOptions(columns: string, order: (q: OptionQuery) => OptionQuery) {
  const table = (): OptionQuery => (supabase as unknown as { from: (t: string) => OptionQuery }).from("quality_options");
  const withPoints = await order(table().select(`${columns}, points`));
  if (!withPoints.error) return { rows: withPoints.data ?? [], priced: true };
  if (withPoints.error.code !== UNDEFINED_COLUMN) throw withPoints.error;
  const plain = await order(table().select(columns));
  if (plain.error) throw plain.error;
  return { rows: plain.data ?? [], priced: false };
}

/** All option rows (both kinds, incl. inactive) — for the admin manager UI. */
export function useAllQualityOptions() {
  return useQuery({
    queryKey: ["quality_options_all"],
    queryFn: async () => {
      const { rows } = await selectOptions("id, kind, value, active, sort", (q) =>
        q.order("kind").order("sort").order("value"),
      );
      return (rows as Record<string, unknown>[]).map((r) => ({
        ...r,
        points: Number(r.points ?? 0),
      })) as unknown as QualityOption[];
    },
  });
}

/** Active label + department values for the pickers, with constant fallback. */
export function useQualityOptions() {
  return useQuery({
    queryKey: ["quality_options"],
    queryFn: async () => {
      const { rows: data } = await selectOptions("kind, value", (q) =>
        q.eq("active", true).order("sort").order("value"),
      );
      const rows = data as unknown as { kind: string; value: string; points?: number }[];
      const labelRows = rows.filter((r) => r.kind === "label");
      const labels = labelRows.map((r) => r.value);
      const departments = rows.filter((r) => r.kind === "department").map((r) => r.value);
      return {
        labels: labels.length ? labels : [...QUALITY_LABELS],
        departments: departments.length ? departments : [...QUALITY_DEPARTMENTS],
        // Keyed by the label's own text; `setLabelPoints` lowercases it.
        labelPoints: Object.fromEntries(labelRows.map((r) => [r.value, Number(r.points ?? 0)])),
      };
    },
  });
}

/**
 * Loads the label prices into the qualityConstants module.
 *
 * Mounted once near the top of the app, beside `useSeverityPointsSync` and for the
 * same reason: `actionPoints()` is called from charts, table cells and PDF builders
 * that are plain functions, not hooks.
 *
 * Note what this means for a screen that renders before the query settles: every
 * label reads as unpriced, so an action shows its severity weight and then snaps to
 * its label price. Acceptable here — the same one-frame settle the severity weights
 * have always had — and the alternative is gating the whole module on a lookup table.
 */
export function useLabelPointsSync() {
  const { data } = useQualityOptions();
  useEffect(() => {
    if (!data) return;
    setLabelPoints(data.labelPoints);
  }, [data]);
}
