import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SHIFT_HOURS, type ShiftHours } from "@/lib/batchReview";

// Table exists only after APLICAR-fill-shift-hours.sql; not in generated types.
const db = supabase as unknown as { from: (t: string) => any };
const KEY = ["fill-shift-hours"];

/** Factory shift hours shared by everyone; `active` false until the table exists. */
export function useShiftHours() {
  const q = useQuery({
    queryKey: KEY,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ hours: ShiftHours; active: boolean }> => {
      const { data, error } = await db.from("fill_shift_hours").select("day_start, day_end").eq("id", 1).maybeSingle();
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return { hours: DEFAULT_SHIFT_HOURS, active: false };
        throw error;
      }
      return { hours: data ? { dayStart: data.day_start, dayEnd: data.day_end } : DEFAULT_SHIFT_HOURS, active: true };
    },
  });
  return { hours: q.data?.hours ?? DEFAULT_SHIFT_HOURS, active: q.data?.active ?? false, isLoading: q.isLoading, error: q.error };
}

export function useSaveShiftHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (h: ShiftHours) => {
      const { data, error } = await db.from("fill_shift_hours").upsert({ id: 1, day_start: h.dayStart, day_end: h.dayEnd, updated_at: new Date().toISOString() }, { onConflict: "id" }).select("day_start, day_end").single();
      if (error) throw error;
      if (!data || data.day_start !== h.dayStart || data.day_end !== h.dayEnd) throw new Error("The shift hours were not saved. Please reload and try again.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
