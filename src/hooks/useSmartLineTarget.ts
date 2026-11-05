import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseLineNo, type ShiftType } from "@/lib/smartTargetEngine";
export { productsOffPlan } from "@/lib/smartTargetAhead";

/**
 * The Smart Target for one line and shift, as the line tablet sees it (Q34a, Q39a).
 *
 * Read through smart_target_line_targets() (BLOCO 149), which needs
 * smarttarget.line_target and never returns the numbers of a line still held back.
 * The number is frozen: it is the one made before the shift, and it is the one measured
 * (Q40a). When the operator logs a product the plan did not have, the tablet says the
 * plan changed and keeps the number.
 */

export interface SmartLineTarget {
  line: number;
  held_back: boolean;
  expected_total: number | null;
  expected_per_hour: number | null;
  status: string;
  jobs: { sku: string | null; order: number | null; expected: number | null }[];
  notes: string[];
  source: "page" | "ahead";
  frozen_at: string;
}

export type SmartLineTargetState =
  | { kind: "not_installed" }
  | { kind: "none" }
  | { kind: "target"; target: SmartLineTarget };

export function useSmartLineTarget(line: string | null | undefined, date: string, shift: ShiftType) {
  const lineNo = parseLineNo(line);
  return useQuery({
    enabled: lineNo !== null,
    queryKey: ["smart_target_line_targets", date, shift],
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<Map<number, SmartLineTarget> | null> => {
      // Not in the generated types until BLOCO 149 is applied and types.ts regenerated.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("smart_target_line_targets", { p_date: date, p_shift: shift });
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") return null;
        throw error;
      }
      return new Map(((data ?? []) as SmartLineTarget[]).map((t) => [t.line, t]));
    },
    select: (all): SmartLineTargetState => {
      if (all === null) return { kind: "not_installed" };
      const t = lineNo === null ? undefined : all.get(lineNo);
      return t ? { kind: "target", target: t } : { kind: "none" };
    },
  });
}
