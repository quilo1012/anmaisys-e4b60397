import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface PmSchedule {
  id: string;
  machine: string;
  title: string;
  description: string | null;
  interval_days: number;
  last_done_at: string | null;
  next_due_at: string | null;
  active: boolean;
  assigned_engineer_id: string | null;
  priority: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PmTask {
  id: string;
  schedule_id: string;
  title: string;
  required: boolean;
  sort_order: number;
  created_at: string;
}

export interface PmExecution {
  id: string;
  schedule_id: string;
  done_by: string | null;
  done_by_name: string | null;
  done_at: string;
  notes: string | null;
  checklist_state: Array<{ task_id: string; title: string; checked: boolean }>;
  created_at: string;
}

const pm = () => (supabase as any);

export function usePmSchedules() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["pm_schedules"],
    queryFn: async () => {
      const { data, error } = await pm().from("pm_schedules").select("*").order("next_due_at", { ascending: true });
      if (error) throw error;
      return (data || []) as PmSchedule[];
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`pm_schedules_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pm_schedules" }, () => {
        queryClient.invalidateQueries({ queryKey: ["pm_schedules"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return query;
}

export function usePmTasks(scheduleId: string | null | undefined) {
  return useQuery({
    queryKey: ["pm_tasks", scheduleId],
    queryFn: async () => {
      const { data, error } = await pm().from("pm_tasks").select("*").eq("schedule_id", scheduleId).order("sort_order");
      if (error) throw error;
      return (data || []) as PmTask[];
    },
    enabled: !!scheduleId,
    staleTime: 60_000,
  });
}

export function usePmExecutions(scheduleId: string | null | undefined) {
  return useQuery({
    queryKey: ["pm_executions", scheduleId],
    queryFn: async () => {
      const { data, error } = await pm()
        .from("pm_executions")
        .select("*")
        .eq("schedule_id", scheduleId)
        .order("done_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as PmExecution[];
    },
    enabled: !!scheduleId,
    staleTime: 30_000,
  });
}

export function useCreatePmSchedule() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (s: Partial<PmSchedule>) => {
      const payload = { ...s, created_by: user?.id };
      const { data, error } = await pm().from("pm_schedules").insert(payload).select().single();
      if (error) throw error;
      return data as PmSchedule;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pm_schedules"] }),
  });
}

export function useUpdatePmSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<PmSchedule> & { id: string }) => {
      const { error } = await pm().from("pm_schedules").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pm_schedules"] }),
  });
}

export function useDeletePmSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await pm().from("pm_schedules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pm_schedules"] }),
  });
}

export function useAddPmTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: { schedule_id: string; title: string; required?: boolean; sort_order?: number }) => {
      const { error } = await pm().from("pm_tasks").insert(t);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["pm_tasks", vars.schedule_id] }),
  });
}

export function useDeletePmTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; schedule_id: string }) => {
      const { error } = await pm().from("pm_tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["pm_tasks", vars.schedule_id] }),
  });
}

export function useRecordPmExecution() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (e: {
      schedule_id: string;
      notes?: string;
      checklist_state: Array<{ task_id: string; title: string; checked: boolean }>;
    }) => {
      let doneByName: string | null = null;
      if (user) {
        const { data: p } = await supabase.from("profiles").select("name").eq("id", user.id).maybeSingle();
        doneByName = (p as any)?.name ?? null;
      }
      const { error } = await pm().from("pm_executions").insert({
        schedule_id: e.schedule_id,
        done_by: user?.id ?? null,
        done_by_name: doneByName,
        notes: e.notes ?? null,
        checklist_state: e.checklist_state,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["pm_executions", vars.schedule_id] });
      qc.invalidateQueries({ queryKey: ["pm_schedules"] });
    },
  });
}

export type PmStatus = "overdue" | "due_soon" | "ok" | "inactive";

export function pmStatus(s: PmSchedule, now = new Date()): PmStatus {
  if (!s.active) return "inactive";
  if (!s.next_due_at) return "ok";
  const due = new Date(s.next_due_at).getTime();
  const t = now.getTime();
  const diffDays = (due - t) / 86_400_000;
  if (diffDays < 0) return "overdue";
  if (diffDays <= 7) return "due_soon";
  return "ok";
}
