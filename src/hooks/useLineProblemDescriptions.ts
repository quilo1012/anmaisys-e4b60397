import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LineProblemLink {
  id: string;
  line_id: string;
  problem_description_id: string;
}

/** All line→problem assignments. */
export function useLineProblemDescriptions() {
  return useQuery({
    queryKey: ["line_problem_descriptions"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("line_problem_descriptions")
        .select("*");
      if (error) throw error;
      return (data || []) as LineProblemLink[];
    },
  });
}

/**
 * Active problems available for a specific line.
 * If no assignments exist for the line, returns ALL active problems (back-compat).
 */
export function useActiveProblemsForLine(lineId: string | null | undefined) {
  return useQuery({
    queryKey: ["problems_for_line", lineId || "all"],
    queryFn: async () => {
      // Fetch all active problems
      const { data: allProblems, error: pErr } = await (supabase as any)
        .from("problem_descriptions")
        .select("*")
        .eq("active", true)
        .order("name");
      if (pErr) throw pErr;

      if (!lineId) return allProblems as any[];

      const { data: links, error: lErr } = await (supabase as any)
        .from("line_problem_descriptions")
        .select("problem_description_id")
        .eq("line_id", lineId);
      if (lErr) throw lErr;

      const allowed = new Set((links || []).map((l: any) => l.problem_description_id));
      // Fallback: if line has no explicit assignments, show everything
      if (allowed.size === 0) return allProblems as any[];

      return (allProblems || []).filter((p: any) => allowed.has(p.id));
    },
    enabled: true,
  });
}

export function useSetLineProblemAssignments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ problemId, lineIds }: { problemId: string; lineIds: string[] }) => {
      // Replace assignments for this problem
      const { error: delErr } = await (supabase as any)
        .from("line_problem_descriptions")
        .delete()
        .eq("problem_description_id", problemId);
      if (delErr) throw delErr;

      if (lineIds.length > 0) {
        const rows = lineIds.map((line_id) => ({ line_id, problem_description_id: problemId }));
        const { error: insErr } = await (supabase as any)
          .from("line_problem_descriptions")
          .insert(rows);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["line_problem_descriptions"] });
      qc.invalidateQueries({ queryKey: ["problems_for_line"] });
    },
  });
}
