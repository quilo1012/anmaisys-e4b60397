import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type Shift = "DAY" | "NIGHT";

export interface ProductionSession {
  id: string;
  session_date: string;
  shift: string;
  line: string;
  leader_id: string | null;
  leader_name: string | null;
  staff_planned: number | null;
  staff_actual: number | null;
  locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
  notes: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface ProductionItem {
  id: string;
  session_id: string;
  sku_id: string;
  target_qty: number | null;
  planned_qty: number | null;
  actual_qty: number | null;
  notes: string | null;
}

export interface SkuProduct {
  id: string;
  code: string;
  name: string;
  category: string | null;
  target_per_hour: number | null;
  active: boolean;
}

export function useLines() {
  return useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lines")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLeaders() {
  return useQuery({
    queryKey: ["leaders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("line_leaders")
        .select("id, name")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

export function useSkuProducts(activeOnly = true) {
  return useQuery({
    queryKey: ["sku_products", activeOnly],
    queryFn: async () => {
      let q = supabase.from("sku_products").select("*").order("code").limit(5000);
      if (activeOnly) q = q.eq("active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SkuProduct[];
    },
  });
}

export function useSessionsRange(from: string, to: string, line?: string) {
  return useQuery({
    queryKey: ["production_sessions", from, to, line ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("production_sessions")
        .select("*")
        .gte("session_date", from)
        .lte("session_date", to)
        .order("session_date", { ascending: false });
      if (line) q = q.eq("line", line);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ProductionSession[];
    },
  });
}

export function useSession(sessionId: string | null) {
  return useQuery({
    queryKey: ["production_session", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_sessions")
        .select("*")
        .eq("id", sessionId!)
        .maybeSingle();
      if (error) throw error;
      return data as ProductionSession | null;
    },
  });
}

export function useSessionItems(sessionId: string | null) {
  return useQuery({
    queryKey: ["production_items", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_items")
        .select("*")
        .eq("session_id", sessionId!);
      if (error) throw error;
      return (data ?? []) as ProductionItem[];
    },
  });
}

export function useUpsertSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      session_date: string;
      shift: string;
      line: string;
      leader_id: string | null;
      leader_name: string | null;
      staff_planned: number;
      staff_actual: number;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("production_sessions")
        .upsert(input, { onConflict: "session_date,line,shift" })
        .select()
        .single();
      if (error) throw error;
      return data as ProductionSession;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_sessions"] });
      qc.invalidateQueries({ queryKey: ["production_session"] });
      toast.success("Session saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface PlannerItemInput {
  sku_id: string;
  target_qty: number;
  planned_qty: number;
  blender_ref?: string | null;
  notes?: string | null;
  /** Ignored by the planner save — actual_qty is owned by the operator flow. */
  actual_qty?: number;
}

export function useSaveItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { session_id: string; items: PlannerItemInput[] }) => {
      // NON-DESTRUCTIVE: upsert plan fields on (session_id, sku_id) WITHOUT
      // touching actual_qty, then delete only SKUs removed from the plan. This
      // preserves operator-entered actual_qty and their production_blender_entries
      // (which cascade off production_items.id). Never delete+re-insert here.
      const keepSkuIds = input.items.map((i) => i.sku_id).filter(Boolean);

      if (keepSkuIds.length > 0) {
        const rows = input.items
          .filter((i) => i.sku_id)
          .map((i) => ({
            session_id: input.session_id,
            sku_id: i.sku_id,
            target_qty: i.target_qty ?? 0,
            planned_qty: i.planned_qty ?? 0,
            blender_ref: i.blender_ref ?? null,
            notes: i.notes ?? null,
            // actual_qty intentionally omitted: default 0 on INSERT, untouched on UPDATE.
          }));
        const { error } = await supabase
          .from("production_items")
          .upsert(rows, { onConflict: "session_id,sku_id" });
        if (error) throw error;
      }

      // Remove items dropped from the plan (rows with a sku_id not kept). Rows
      // with a NULL sku_id are not matched by `not.in`, so they survive.
      let delQ = supabase.from("production_items").delete().eq("session_id", input.session_id);
      if (keepSkuIds.length > 0) {
        delQ = delQ.not("sku_id", "in", `(${keepSkuIds.join(",")})`);
      } else {
        delQ = delQ.not("sku_id", "is", null);
      }
      const { error: delErr } = await delQ;
      if (delErr) throw delErr;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["production_items", vars.session_id] });
      toast.success("SKUs saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useToggleSessionLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, lock }: { id: string; lock: boolean }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("production_sessions")
        .update({
          locked: lock,
          locked_at: lock ? new Date().toISOString() : null,
          locked_by: lock ? u.user?.id ?? null : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_sessions"] });
      qc.invalidateQueries({ queryKey: ["production_session"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
