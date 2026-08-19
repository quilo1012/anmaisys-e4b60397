import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isMissingColumn } from "@/lib/postgrestErrors";
import { QUALITY_LABELS, QUALITY_DEPARTMENTS, setLabelPoints, setExcludedDepartments } from "@/lib/qualityConstants";

export interface QualityOption {
  id: string;
  /** `safety_label` is the safety form's own list — see SAFETY_LABELS. */
  kind: "label" | "department" | "safety_label";
  value: string;
  active: boolean;
  sort: number;
  /** What this label charges an action. 0 = unpriced, so severity decides. */
  points: number;
  /**
   * An action carrying this label caps the period at CAP_Gate and forces Red.
   *
   * Arrives with 20260824090000. Absent reads as false, which is the correct answer for
   * a database that has never heard of gates — and, unlike `points`, it is a reading
   * that must be shown rather than assumed: see `useGateLabels`.
   */
  is_gate: boolean;
  /**
   * Whether an action booked to this option charges the leader.
   *
   * Read on `department` rows; carried on every row because the column is on the table
   * rather than on a kind. Arrives with 20260827090000; absent reads as true, so a
   * database without the column charges everything, which is the strict direction.
   */
  counts_against_leader: boolean;
}


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
  // A ladder, one rung per migration, newest column dropped first.
  //
  // PostgREST names only ONE unknown column per error, so probing them individually
  // would cost a round trip each and still need this. Dropping the newest and retrying
  // is the only reliable walk down, and the order is the order they arrived in:
  // `counts_against_leader` (20260827090000), `is_gate` (20260824090000), `points`
  // (20260815120000). A database can genuinely have any prefix of those.
  //
  // Each rung is a real, correct reading rather than a degraded one: without
  // `counts_against_leader` every department charges, without `is_gate` nothing gates,
  // and without `points` severity alone decides.
  const full = await order(table().select(`${columns}, points, is_gate, counts_against_leader`));
  if (!full.error) return { rows: full.data ?? [], priced: true, gated: true, attributed: true };
  if (!isMissingColumn(full.error)) throw full.error;

  const rich = await order(table().select(`${columns}, points, is_gate`));
  if (!rich.error) return { rows: rich.data ?? [], priced: true, gated: true, attributed: false };
  if (!isMissingColumn(rich.error)) throw rich.error;

  const withPoints = await order(table().select(`${columns}, points`));
  if (!withPoints.error) return { rows: withPoints.data ?? [], priced: true, gated: false, attributed: false };
  if (!isMissingColumn(withPoints.error)) throw withPoints.error;

  const plain = await order(table().select(columns));
  if (plain.error) throw plain.error;
  return { rows: plain.data ?? [], priced: false, gated: false, attributed: false };
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
        is_gate: r.is_gate === true,
        // Absent reads as "counts", which is the correct answer for a database that has
        // never heard of department attribution: nothing is excluded until somebody
        // says so, and no option quietly stops charging on a schema gap.
        counts_against_leader: r.counts_against_leader !== false,
      })) as unknown as QualityOption[];
    },
  });
}

/** Active label + department values for the pickers, with constant fallback. */
export function useQualityOptions() {
  return useQuery({
    queryKey: ["quality_options"],
    queryFn: async () => {
      const { rows: data, gated, attributed } = await selectOptions("kind, value", (q) =>
        q.eq("active", true).order("sort").order("value"),
      );
      const rows = data as unknown as {
        kind: string; value: string; points?: number; is_gate?: boolean; counts_against_leader?: boolean;
      }[];
      const labelRows = rows.filter((r) => r.kind === "label");
      const labels = labelRows.map((r) => r.value);
      const departmentRows = rows.filter((r) => r.kind === "department");
      const departments = departmentRows.map((r) => r.value);
      // Empty until the seed lands — `labelsForDomain` falls back to SAFETY_LABELS,
      // so the safety form reads correctly on a database that has never heard of it.
      const safetyLabels = rows.filter((r) => r.kind === "safety_label").map((r) => r.value);
      return {
        labels: labels.length ? labels : [...QUALITY_LABELS],
        departments: departments.length ? departments : [...QUALITY_DEPARTMENTS],
        safetyLabels,
        // Keyed by the label's own text; `setLabelPoints` lowercases it.
        labelPoints: Object.fromEntries(labelRows.map((r) => [r.value, Number(r.points ?? 0)])),
        // Lowercased, because that is how `computeLeaderScore` compares them.
        gateLabels: new Set(labelRows.filter((r) => r.is_gate).map((r) => r.value.trim().toLowerCase())),
        /** False when the column is not there — the caller must not read an empty set as "no gates". */
        gatesKnown: gated,
        // Keyed by the department's own text; `setExcludedDepartments` lowercases it.
        // Only the ACTIVE rows are here, which is right: a hidden department cannot be
        // picked on the form, so whether it would have charged is not a live question.
        departmentAttribution: Object.fromEntries(
          departmentRows.map((r) => [r.value, r.counts_against_leader !== false]),
        ),
        /** False when the column is not there — nothing is excluded and nothing can be. */
        departmentAttributionKnown: attributed,
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

/**
 * Loads the department attribution into the qualityConstants module.
 *
 * Mounted beside `useLabelPointsSync` in App, for exactly its reason: `livePoints()`
 * is called from charts, table cells and PDF builders that are plain functions, not
 * hooks, and threading a set through all of them would be churn for one lookup.
 *
 * The one-frame settle is the same as the label prices' and errs in the same
 * direction — before the query lands nothing is excluded, so a total reads HIGH and
 * then drops. Too high is visible and arguable; the opposite would be a leader
 * scoring green on somebody else's machine failure.
 */
export function useDepartmentAttributionSync() {
  const { data } = useQualityOptions();
  useEffect(() => {
    if (!data) return;
    setExcludedDepartments(data.departmentAttribution);
  }, [data]);
}

/**
 * The departments that do not charge the leader, and whether that answer is knowable.
 *
 * Shaped like `useGateLabels`, and `missing` matters for the same reason it does
 * there: without the column NOTHING is excluded, every department charges, and the
 * lists manager has to say so rather than show a row of controls that save nothing.
 */
export function useDepartmentAttribution() {
  const query = useQualityOptions();
  return {
    attribution: query.data?.departmentAttribution ?? {},
    ready: query.isSuccess,
    /** The column is not there: 20260827090000 has not been applied. */
    missing: query.isSuccess && !(query.data?.departmentAttributionKnown ?? false),
    failed: query.isError,
  };
}

/**
 * The labels that gate a period, and whether that answer can be trusted yet.
 *
 * Shaped like `useLeaderAttribution`, and for a sharper version of its reason. An empty
 * exclusion set means "nothing is excluded", which is a real answer. An empty GATE set
 * also looks like a real answer — "no gate fired" — and it is the answer that lets a
 * leader with a failed CCP in the period read a green score. The set alone cannot tell
 * "no gates are configured" from "the query has not landed" from "this database has no
 * is_gate column", and all three produce the same empty set.
 *
 * So `ready` is not a nicety. A screen that draws a score before this settles is drawing
 * a score that may be missing its ceiling, on the one subject where being wrong in the
 * lenient direction is an audit finding.
 */
export function useGateLabels() {
  const query = useQualityOptions();
  return {
    gateLabels: query.data?.gateLabels ?? new Set<string>(),
    /**
     * The query has settled. NOT "the column exists".
     *
     * These were the same thing for one draft, and it would have bricked every leader's
     * card on the database this runs on today: `is_gate` arrives with 20260824090000,
     * and until it does `gatesKnown` is false — so a card gated on the column would have
     * sat on "Working out which actions count…" for ever. A missing column is a settled,
     * definitive answer — this database has no gates — and a screen must render it.
     *
     * What must NOT be silent is the difference, which is why `missing` exists and why
     * the lists manager says it out loud, exactly as it does for attribution.
     */
    ready: query.isSuccess,
    /** The column is not there: 20260824090000 has not been applied, so nothing gates. */
    missing: query.isSuccess && !(query.data?.gatesKnown ?? false),
    failed: query.isError,
  };
}
