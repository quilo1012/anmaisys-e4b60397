import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useShiftPatterns, useShiftHistory, worksOn, resolveShiftOn } from "./useWorkforce";

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
  /** Which rota they are on. Null means unrecorded, which is not the same as off. */
  shift_pattern_id: string | null;
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

/**
 * Who is due in on this shift, on this day.
 *
 * It used to be `shift_group = 'Day'` and nothing else — the date was on the screen
 * but not in the question. On a Sunday that listed all 68 people of the Day crew as
 * eligible, when no Mon–Thu rota covers Sunday and the 38 people actually in are the
 * Fri–Mon crew. A board that names 68 people who are at home is worse than an empty
 * one, because somebody will allocate them.
 *
 * Two rules, both borrowed from the Workforce board rather than rewritten, so there
 * is one definition of "is this person in today" in the codebase:
 *
 * - `worksOn` — the rota's weekdays must include this one. Someone with no rota
 *   recorded is kept: that is unknown, not off, and dropping them would quietly
 *   shrink the headcount.
 * - `resolveShiftOn` — the shift they held *on that date*, not the one they hold
 *   now. Somebody moved from nights to days in August was on nights in July, and
 *   July's board has to keep saying so.
 */
/**
 * A person's shift group, folded onto the board it belongs to.
 *
 * `daily_allocations.shift` only accepts Day, Night and Weekend — there is no
 * warehouse shift. Somebody on `Warehouse Day` works days and has to appear on the
 * day board; without this fold the allocation was saved as 'Day' and then nobody saw
 * it, because the roster looked for `shift_group = 'Day'` exactly.
 */
export function boardShiftFor(shiftGroup: string | null | undefined): string | null {
  if (!shiftGroup) return null;
  if (shiftGroup === "Warehouse Weekend") return "Weekend";
  if (shiftGroup.startsWith("Warehouse")) return "Day";
  return ["Day", "Night", "Weekend"].includes(shiftGroup) ? shiftGroup : null;
}

export function useShiftRoster(shift: string, onDate: string) {
  const { data: patterns } = useShiftPatterns();
  const { data: history } = useShiftHistory();

  const { data: everyone, isLoading } = useQuery({
    queryKey: ["headcount-roster-all"],
    queryFn: async (): Promise<HeadcountEmployee[]> => {
      const { data, error } = await supabase
        .from("employees")
        .select("id,full_name,shift_group,department,shift_pattern_id")
        .eq("active", true)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as HeadcountEmployee[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const data = useMemo(() => {
    const patternById = new Map((patterns ?? []).map((p) => [p.id, p]));
    // Midday, so a timezone an hour either side cannot move the weekday.
    const day = new Date(`${onDate}T12:00:00`);
    return (everyone ?? []).filter((e) => {
      const held = resolveShiftOn(history, e, onDate);
      if (boardShiftFor(held.shift_group) !== shift) return false;
      const pattern = held.shift_pattern_id ? patternById.get(held.shift_pattern_id) ?? null : null;
      return !pattern || worksOn(pattern.days, day);
    });
  }, [everyone, patterns, history, shift, onDate]);

  /**
   * Everyone active, by id — not only whoever is eligible today.
   *
   * The board draws its columns from the saved allocations, and an allocation for
   * somebody who is not eligible today is still a fact: somebody put them there.
   * Before, anyone outside the roster vanished from the screen while still counting
   * in the totals — the board read "20 support" with the warehouse column at zero.
   */
  const byId = useMemo(
    () => new Map((everyone ?? []).map((e) => [e.id, e])),
    [everyone],
  );

  /**
   * Everyone on this shift, whether or not the rota puts them in today.
   *
   * The picker needs the wider list: nobody is fixed to a line, and a Saturday call-in
   * or tomorrow's plan has to be placeable. A picker that offers nobody on a day
   * nobody is rostered is a picker that cannot be used to change the roster. Each
   * person carries whether the rota covers the day, so placing an off-rota person is
   * a visible decision rather than a silent one.
   */
  const onShift = useMemo(() => {
    const patternById = new Map((patterns ?? []).map((p) => [p.id, p]));
    const day = new Date(`${onDate}T12:00:00`);
    return (everyone ?? [])
      .filter((e) => boardShiftFor(resolveShiftOn(history, e, onDate).shift_group) === shift)
      .map((e) => {
        const held = resolveShiftOn(history, e, onDate);
        const pattern = held.shift_pattern_id ? patternById.get(held.shift_pattern_id) ?? null : null;
        return { ...e, offRota: !!pattern && !worksOn(pattern.days, day) };
      });
  }, [everyone, patterns, history, shift, onDate]);

  return { data, byId, onShift, isLoading };
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
            // Overtime keeps its area. Somebody on an overtime day is working, and the
            // column they are working in is the point — wiping it left the board with
            // nowhere to show them but a list of names. Absence and holiday do lose it:
            // they are not at a place that day.
            area_id: input.status === "assigned" || input.status === "overtime" ? input.areaId : null,
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
