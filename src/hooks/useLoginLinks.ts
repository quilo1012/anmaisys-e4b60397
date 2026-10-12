import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// The three functions are newer than the generated types until they are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface UnlinkedLogin {
  user_id: string;
  email: string | null;
  name: string | null;
  roles: string[];
  created_at: string;
  /** Exactly one unclaimed record carries this login's email, or else its name. A hint only. */
  suggested_employee_id: string | null;
}
export interface UnclaimedEmployee {
  id: string; full_name: string; employee_ref: string | null;
  department: string | null; shift_group: string | null;
}
export interface LinkedEmployee {
  employee_id: string; full_name: string; employee_ref: string | null;
  department: string | null; user_id: string; email: string | null;
}
export type LoginLinks =
  | { state: "ready"; logins: UnlinkedLogin[]; employees: UnclaimedEmployee[]; linked: LinkedEmployee[] }
  /** BLOCO 91 has not been pasted: the functions do not exist yet. */
  | { state: "notSetUp" };

const KEY = ["login_link_candidates"] as const;

/** Who is nobody yet, who is unclaimed, and who is linked. The database refuses anyone without `employees.link_login`. */
export function useLoginLinks() {
  return useQuery({
    queryKey: KEY,
    meta: { schemaOptional: true },
    queryFn: async (): Promise<LoginLinks> => {
      const { data, error } = await db.rpc("login_link_candidates");
      if (error) {
        if ((error as { code?: string }).code === "PGRST202") return { state: "notSetUp" };
        throw error;
      }
      return { state: "ready", logins: data?.logins ?? [], employees: data?.employees ?? [], linked: data?.linked ?? [] };
    },
  });
}

/** Link and unlink. The database's refusals ("already linked to …") are the messages shown. */
export function useLoginLinkMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ["overtime_roster"] });
  };
  const link = useMutation({
    mutationFn: async ({ userId, employeeId }: { userId: string; employeeId: string }) => {
      const { error } = await db.rpc("link_login_to_employee", { p_user_id: userId, p_employee_id: employeeId });
      if (error) throw new Error(error.message);
    },
    onSuccess: done,
  });
  const unlink = useMutation({
    mutationFn: async (employeeId: string) => {
      const { error } = await db.rpc("unlink_login_from_employee", { p_employee_id: employeeId });
      if (error) throw new Error(error.message);
    },
    onSuccess: done,
  });
  return { link, unlink };
}
