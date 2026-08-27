import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setMaxLabelPoints } from "@/lib/qualityConstants";
import { isMissingTable } from "@/lib/postgrestErrors";

/**
 * The ceiling on what an action's priced labels may charge between them.
 *
 * `actionPoints()` has a twin in SQL, `public.action_points_at()`, and the twin applies
 * this ceiling:
 *
 *     SELECT max(value) INTO _cap FROM public.leader_scorecard_threshold
 *      WHERE name = 'CAP_LabelPoints' AND valid_from <= _from
 *        AND (valid_to IS NULL OR valid_to >= _from);
 *     IF _cap IS NOT NULL THEN _charge := LEAST(_charge, _cap::integer); END IF;
 *
 * The TypeScript side has the machinery for it — `maxLabelPoints()` reads a module-level
 * `LABEL_POINTS_CAP` — and until now nothing in the app ever set it. Only the tests did.
 * So `maxLabelPoints()` returned Infinity in production, unconditionally.
 *
 * That costs nothing today, because the row does not exist and an absent ceiling means
 * uncapped on both sides. It is armed, though: `qualityConstants` documents inserting
 * that row as the way to turn the ceiling on, and the day somebody does, the database
 * starts capping and the screen does not. The form would show one figure and the row
 * would be written with another — the exact disagreement that module keeps having to
 * fix.
 *
 * WHAT THIS DOES NOT DO. It does not reproduce the SQL's dating. The twin resolves the
 * ceiling at the scoring version of the action being priced, so raising it in November
 * cannot re-price a July action. This reads the one in force NOW, which is the right
 * answer for the only thing the TypeScript prices live: an action being logged today.
 * Anything older comes back through `points_at_creation`, which `actionPoints()` returns
 * before it computes anything at all.
 */
export function useLabelPointsCap() {
  return useQuery({
    queryKey: ["label_points_cap"],
    staleTime: 5 * 60_000,
    // The subject of the query IS "has this migration landed": the row is optional by
    // design, and on a database without the table the answer is "no ceiling", not an
    // error to shout about. Same courtesy `useScoringFreeze` gets.
    meta: { schemaOptional: true },
    queryFn: async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("leader_scorecard_threshold" as any)
        .select("value, valid_from, valid_to")
        .eq("name", "CAP_LabelPoints")
        .lte("valid_from", hoje);
      if (error) {
        if (isMissingTable(error)) return null;
        throw error;
      }

      const linhas = (data ?? []) as unknown as Array<{
        value: number | string;
        valid_from: string;
        valid_to: string | null;
      }>;

      // `max(value)`, as the SQL twin takes it — not the newest row. Two open versions
      // of the same parameter is a state neither side should have to arbitrate, and
      // taking the highest at least keeps the two implementations saying one thing.
      const vigentes = linhas
        .filter((l) => l.valid_to === null || l.valid_to >= hoje)
        .map((l) => Number(l.value))
        .filter((n) => Number.isFinite(n));

      return vigentes.length ? Math.max(...vigentes) : null;
    },
  });
}

/**
 * Loads the ceiling into the qualityConstants module.
 *
 * Mounted once near the top of the app, beside the severity and label point syncs, for
 * the same reason they are: `maxLabelPoints()` is called from plain functions inside the
 * scoring path, not from components.
 *
 * `undefined` (query in flight) is left alone rather than pushed in as null — writing
 * null on every mount would briefly uncap the scoring while the request is out.
 */
export function useLabelPointsCapSync() {
  const { data } = useLabelPointsCap();
  useEffect(() => {
    if (data === undefined) return;
    setMaxLabelPoints(data);
  }, [data]);
}
