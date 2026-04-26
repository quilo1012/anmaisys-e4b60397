import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns the set of line_ids accessible to the current operator account
 * (via operator_line_accounts). Empty array for non-operators.
 */
export function useOperatorLineIds() {
  const { user, role } = useAuth();
  return useQuery({
    queryKey: ["operator_line_ids", user?.id],
    queryFn: async () => {
      if (!user || role !== "operator") return [] as string[];
      const { data, error } = await (supabase as any)
        .from("operator_line_accounts")
        .select("line_ids")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) return [] as string[];
      return ((data?.line_ids as string[]) || []);
    },
    enabled: !!user && role === "operator",
    staleTime: 60_000,
  });
}

/** True if the current user can act on a WO bound to `lineId`. */
export function useCanActOnLine(lineId: string | null | undefined) {
  const { user, role } = useAuth();
  const { data: lineIds } = useOperatorLineIds();
  if (!user) return false;
  if (role === "admin" || role === "manager" || role === "engineer") return true;
  if (role === "operator") {
    if (!lineId) return false;
    return (lineIds || []).includes(lineId);
  }
  return false;
}
