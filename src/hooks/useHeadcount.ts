import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type HeadcountArea = {
  id: string;
  name: string;
  kind: string;
  sort_order: number;
  active: boolean;
};

export type HeadcountEmployee = {
  id: string;
  full_name: string;
  shift_group: string | null;
  department: string | null;
};

export type Allocation = {
  id: string;
  on_date: string;
  shift: string;
  employee_id: string;
  area_id: string | null;
  status: string;
  half_day: boolean | null;
  note: string | null;
};

export type AllocStatus = "assigned" | "absence" | "holiday" | "overtime";

/** Areas that make up the board columns (production first, then support). */
export function useHeadcountAreas() {
  return useQuery({
    queryKey: ["headcount-areas"],
    queryFn: async (): Promise<HeadcountArea[]> => {
      const { data, error } = await supabase
        .from("headcount_areas")
        .select("id,name,kind,sort_order,active")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as HeadcountArea[];
      const rank = (k: string) => (k === "production" ? 0 : 1);
      return [...rows].sort(
        (a, b) => rank(a.kind) - rank(b.kind) || a.sort_order - b.sort_order || a.name.localeCompare(b.name),
      );
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Eligible roster for a shift group ('Day' | 'Night'). */
export function useShiftRoster(shift: string) {
  return useQuery({
    queryKey: ["headcount-roster", shift],
    queryFn: async (): Promise<HeadcountEmployee[]> => {
      const { data, error } = await supabase
        .from("employees")
        .select("id,full_name,shift_group,department")
        .eq("active", true)
        .eq("shift_group", shift)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as HeadcountEmployee[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAllocations(onDate: string, shift: string) {
  return useQuery({
    queryKey: ["headcount-allocations", onDate, shift],
    queryFn: async (): Promise<Allocation[]> => {
      const { data, error } = await supabase
        .from("daily_allocations")
        .select("id,on_date,shift,employee_id,area_id,status,half_day,note")
        .eq("on_date", onDate)
        .eq("shift", shift);
      if (error) throw error;
      return (data ?? []) as Allocation[];
    },
  });
}

export function useAllocationMutations(onDate: string, shift: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["headcount-allocations", onDate, shift] });

  const place = useMutation({
    mutationFn: async (input: { employeeId: string; areaId: string | null; status: AllocStatus }) => {
      const { error } = await supabase
        .from("daily_allocations")
        .upsert(
          {
            on_date: onDate,
            shift,
            employee_id: input.employeeId,
            area_id: input.status === "assigned" ? input.areaId : null,
            status: input.status,
          },
          { onConflict: "on_date,shift,employee_id" },
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message ?? "Could not save the allocation", { id: "headcount-place" }),
  });

  const remove = useMutation({
    mutationFn: async (employeeId: string) => {
      const { error } = await supabase
        .from("daily_allocations")
        .delete()
        .eq("on_date", onDate)
        .eq("shift", shift)
        .eq("employee_id", employeeId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message ?? "Could not remove the allocation", { id: "headcount-remove" }),
  });

  /** Copies the most recent previous day of the same day-type into this day. */
  const copyLastLikeDay = useMutation({
    mutationFn: async () => {
      const dayType = (d: string) => {
        const w = new Date(`${d}T12:00:00`).getDay();
        return w === 0 ? "sun" : w === 6 ? "sat" : "week";
      };
      const target = dayType(onDate);
      const { data, error } = await supabase
        .from("daily_allocations")
        .select("on_date,employee_id,area_id,status,half_day,note")
        .eq("shift", shift)
        .lt("on_date", onDate)
        .order("on_date", { ascending: false })
        .limit(2000);
      if (error) throw error;
      const rows = (data ?? []) as Array<Pick<Allocation, "on_date" | "employee_id" | "area_id" | "status" | "half_day" | "note">>;
      const source = rows.find((r) => dayType(r.on_date) === target)?.on_date;
      if (!source) throw new Error("No previous day of the same type found");
      const payload = rows
        .filter((r) => r.on_date === source)
        .map((r) => ({
          on_date: onDate,
          shift,
          employee_id: r.employee_id,
          area_id: r.area_id,
          status: r.status,
          half_day: r.half_day,
          note: r.note,
        }));
      if (payload.length === 0) throw new Error("The last matching day has no allocations");
      const { error: upErr } = await supabase
        .from("daily_allocations")
        .upsert(payload, { onConflict: "on_date,shift,employee_id" });
      if (upErr) throw upErr;
      return { source, count: payload.length };
    },
    onSuccess: (r) => {
      invalidate();
      toast.success(`Copied ${r.count} allocations from ${r.source}`, { id: "headcount-copy" });
    },
    onError: (e: Error) => toast.error(e.message ?? "Could not copy the last day", { id: "headcount-copy" }),
  });

  return { place, remove, copyLastLikeDay };
}
