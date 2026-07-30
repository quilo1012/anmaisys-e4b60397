import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setSeverityPoints, QUALITY_SEVERITIES } from "@/lib/qualityConstants";

export interface SeverityPointRow {
  severity: string;
  points: number;
}

/** The configured weight of each severity, defaulting to the constants. */
export function useSeverityPointRows() {
  return useQuery({
    queryKey: ["quality_severity_points"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_severity_points" as any)
        .select("severity, points");
      if (error) throw error;
      const rows = (data ?? []) as SeverityPointRow[];
      // Ordered by the severity scale, not by name, so the editor reads low → critical.
      return QUALITY_SEVERITIES.map((s) => ({
        severity: s.value,
        points: rows.find((r) => r.severity === s.value)?.points ?? s.points,
      }));
    },
  });
}

/**
 * Loads the configured weights into the qualityConstants module.
 *
 * Mounted once, near the top of the app: the ~20 call sites of `severityPoints()`
 * are plain functions inside charts, PDF builders and table cells, and turning each
 * into a hook to pass a map around would be a lot of churn for one number.
 */
export function useSeverityPointsSync() {
  const { data } = useSeverityPointRows();
  useEffect(() => {
    if (!data) return;
    setSeverityPoints(Object.fromEntries(data.map((r) => [r.severity, r.points])));
  }, [data]);
}

export function useUpdateSeverityPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: SeverityPointRow[]) => {
      for (const r of rows) {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
          .from("quality_severity_points" as any)
          .update({ points: r.points, updated_at: new Date().toISOString() })
          .eq("severity", r.severity);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      // Every screen that shows a score reads from these — the board, the log, the
      // leader scorecard and Analytics all have to be told.
      qc.invalidateQueries({ queryKey: ["quality_severity_points"] });
      qc.invalidateQueries({ queryKey: ["quality_actions"] });
      qc.invalidateQueries({ queryKey: ["analytics-quality"] });
    },
  });
}
