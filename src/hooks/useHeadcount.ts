import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { attendanceForStatus, attendanceFromBoard } from "@/lib/attendanceFromBoard";
import { copyableDays, rowsToCopy, type BoardPlacement, type CopyableDay } from "@/lib/copyBoard";
import { keepsLeadership } from "@/lib/leaderMark";
import { isOffRota, statusForPlacement, type RotaCover } from "@/lib/rotaStatus";
import { useShiftPatterns, useShiftHistory, worksOn, resolveShiftOn } from "./useWorkforce";

export type HeadcountArea = {
  id: string;
  name: string;
  /** production | support — what the totals count it as. */
  kind: string;
  /** Which block of the board it is drawn in. Display only; `kind` still counts. */
  section: string;
  /** The department this area's work belongs to. */
  department: string | null;
  /** What the company spreadsheet calls this column. Null means use `name`. */
  sheet_label?: string | null;
  /** Areas sharing this print as one column — Capsules 1 and 2 are "Pill line". */
  sheet_group?: string | null;
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
  /** They came in and went home early, at this time. Null means they worked the shift out. */
  left_early_at: string | null;
  /** They came in after the shift started, at this time. Null means they were in on time. */
  arrived_late_at: string | null;
  note: string | null;
  /** Leads this area on this day. A line can lead differently tomorrow. */
  is_leader: boolean | null;
};

/**
 * How a day counts on the board.
 *
 * `absence` was one of these and said only "did not come in", which left the reason
 * to be guessed by whoever read it later — and the reason is what decides whether the
 * day is paid. It is now `unpaid`, with `sick` beside it, so the board records the
 * two separately at the moment somebody knows which it was.
 */
export type AllocStatus = "assigned" | "overtime" | "sick" | "unpaid" | "holiday";

/** Areas that make up the board columns (production first, then support). */
export function useHeadcountAreas() {
  return useQuery({
    queryKey: ["headcount-areas"],
    queryFn: async (): Promise<HeadcountArea[]> => {
      // `as any`: the two sheet columns are newer than the generated types, which is
      // the same reason the rest of this file casts.
      const { data, error } = await (supabase as any)
        .from("headcount_areas")
        .select("id,name,kind,section,department,sort_order,active,sheet_label,sheet_group")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as HeadcountArea[]).sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
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
/**
 * Which board somebody is drawn on. Two boards, not five.
 *
 * The crews are Day, Night, Weekend, Warehouse Day and Warehouse Weekend, and the
 * board used to have one per crew. That is not how the factory plans: their own
 * headcount sheets draw a single sheet per day carrying everybody whose shift runs
 * while the lines do — the Fri–Mon crew beside the Mon–Thu crew beside the warehouse —
 * and only the night crew is planned apart.
 *
 * Splitting them cost more than it explained. The Weekend board held 45 rows against
 * the Day board's 1516, thirty-one of them duplicates of a day already on Day; a
 * weekend-crew person's approved holiday landed there alone while the board people
 * read showed them missing; and the Day picker would not offer a Fri–Mon name, so
 * nobody could place a Saturday call-in on the board their own allocation was on.
 *
 * The crew has not stopped mattering — it says which days somebody is due in, and it
 * is shown on their card. It just is not a separate wall chart.
 */
export function boardShiftFor(shiftGroup: string | null | undefined): string | null {
  if (!shiftGroup) return null;
  return shiftGroup === "Night" ? "Night" : "Day";
}

/** The crew, short enough for a badge on a card. Null for the plain day shift. */
export function crewBadge(shiftGroup: string | null | undefined): string | null {
  if (!shiftGroup) return null;
  if (shiftGroup === "Weekend") return "FRI–MON";
  if (shiftGroup === "Warehouse Weekend") return "WH FRI–MON";
  if (shiftGroup === "Warehouse Day") return "WH";
  if (shiftGroup === "Night") return "NIGHT";
  return null;
}

export function useShiftRoster(shift: string, onDate: string, showAll = false) {
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
      if (showAll) return true;
      const pattern = held.shift_pattern_id ? patternById.get(held.shift_pattern_id) ?? null : null;
      return !pattern || worksOn(pattern.days, day);
    });
  }, [everyone, patterns, history, shift, onDate, showAll]);

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

/**
 * Whether the rota puts somebody on this board, on this day.
 *
 * The roster already works this out to decide who to offer; this exposes the same
 * answer to the writers, so a placement outside the rota is saved as overtime instead
 * of relying on somebody remembering to drag the name onto the Overtime card.
 *
 * Uses `resolveShiftOn` for the same reason the roster does: the crew somebody held on
 * that date, not the one they hold now. Backfilling July must not be judged against an
 * August rota change.
 */
export function useRotaCover() {
  const { data: patterns } = useShiftPatterns();
  const { data: history } = useShiftHistory();
  const { data: everyone } = useQuery({
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

  // Takes the date as an argument rather than closing over one: the sheet import
  // commits a month in a single call, and every row is a different weekday.
  return useCallback(
    (employeeId: string, onDate: string, shift: string): RotaCover => {
      const person = (everyone ?? []).find((e) => e.id === employeeId);
      if (!person) return { known: false, coversDay: false, onThisBoard: true };
      const held = resolveShiftOn(history, person, onDate);
      const pattern = held.shift_pattern_id
        ? (patterns ?? []).find((p) => p.id === held.shift_pattern_id) ?? null
        : null;
      return {
        known: !!pattern,
        // Midday, so a timezone an hour either side cannot move the weekday.
        coversDay: !!pattern && worksOn(pattern.days, new Date(`${onDate}T12:00:00`)),
        onThisBoard: boardShiftFor(held.shift_group) === shift,
      };
    },
    [everyone, patterns, history],
  );
}

export function useAllocations(onDate: string, shift: string) {
  return useQuery({
    queryKey: ["headcount-allocations", onDate, shift],
    queryFn: async (): Promise<Allocation[]> => {
      const { data, error } = await supabase
        .from("daily_allocations")
        .select("id,on_date,shift,employee_id,area_id,status,half_day,left_early_at,arrived_late_at,note,is_leader")
        .eq("on_date", onDate)
        .eq("shift", shift);
      if (error) throw error;
      return (data ?? []) as Allocation[];
    },
  });
}

/**
 * Where a copy takes its placements from.
 *
 * `last` is the button itself and the answer most mornings. `day` is a date off the
 * menu, for the mornings it is not. `matrix` is the board as it is meant to look
 * rather than as it looked once — see `useHeadcountMatrix`.
 */
export type CopySource =
  | { kind: "last" }
  | { kind: "day"; on_date: string }
  | { kind: "matrix"; matrix: MatrixKind };

/**
 * Which of a board's two standards.
 *
 * Monday and Friday are the days one crew hands the factory to another — Fri–Mon
 * finishing as Mon–Thu starts, Tue–Fri finishing as Fri–Mon starts — and they are not
 * staffed like a Wednesday. Never inferred from the date: the menu shows both with the
 * number each has due in today, so the choice is made in front of somebody. A rule
 * guessing it would be a rule to get wrong the first time a rota changes.
 */
export type MatrixKind = "normal" | "changeover";

export const MATRIX_KINDS: { kind: MatrixKind; label: string; hint: string }[] = [
  { kind: "normal", label: "standard day", hint: "the middle of the week, one crew steady on each line" },
  { kind: "changeover", label: "changeover day", hint: "a crew finishing and a crew starting — Mondays and Fridays" },
];

/**
 * `headcount_matrix` in one cast rather than four.
 *
 * The table is newer than the generated types — the same reason `headcount_areas` is
 * cast a hundred lines above. Keeping it to one place means the day the types are
 * regenerated there is one line to delete, not a hunt.
 */
const matrixTable = () => (supabase as any).from("headcount_matrix");

/** One standing place on a board: this person, this column. */
export type MatrixRow = {
  employee_id: string;
  area_id: string | null;
  saved_from: string | null;
};

/** One board's standard, with how much of it this day would actually get. */
export type Matrix = {
  kind: MatrixKind;
  label: string;
  hint: string;
  rows: MatrixRow[];
  /** The people in it whose rota puts them on this board on the day being planned. */
  due: MatrixRow[];
  savedFrom: string | null;
};

/**
 * The standard board for a shift, and who of it is due in on a given day.
 *
 * The matrix holds everybody, and no day has everybody: every weekday here is a
 * crossover between two rotas — Monday is Mon–Thu plus Fri–Mon, Friday is Tue–Fri plus
 * Fri–Mon — so the matrix is only ever half true of a date until the rota is asked.
 * `due` is that half, and it is what the menu counts, because a menu offering "72" and
 * then writing 83 or 40 is a menu nobody trusts twice.
 *
 * The rota is deliberately not stored with the matrix. Somebody moved from Mon–Thu to
 * Tue–Fri changes which days they are offered on from that moment, with nobody having
 * to remember to save the matrix again.
 */
export function useHeadcountMatrix(shift: string, onDate: string) {
  const rotaCover = useRotaCover();
  const { data, isLoading } = useQuery({
    queryKey: ["headcount-matrix", shift],
    queryFn: async (): Promise<Array<MatrixRow & { kind: MatrixKind }>> => {
      const { data, error } = await matrixTable()
        .select("employee_id,area_id,saved_from,kind")
        .eq("shift", shift);
      if (error) throw error;
      return (data ?? []) as Array<MatrixRow & { kind: MatrixKind }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const matrices = useMemo<Matrix[]>(() => {
    const all = data ?? [];
    return MATRIX_KINDS.map(({ kind, label, hint }) => {
      const rows = all.filter((r) => r.kind === kind);
      return {
        kind,
        label,
        hint,
        rows,
        due: rows.filter((r) => !isOffRota(rotaCover(r.employee_id, onDate, shift))),
        savedFrom: rows[0]?.saved_from ?? null,
      };
    });
  }, [data, rotaCover, onDate, shift]);

  return { matrices, isLoading };
}

/**
 * Makes this board the standard its shift goes back to.
 *
 * Saved from a day rather than built on a screen of its own: a matrix that was a real
 * board on a real morning is one somebody has already checked, and the way to change it
 * is the way you already know — arrange a day, save it again.
 *
 * The new rows are written before the old ones are cleared. The other order is one
 * statement away from an empty matrix if the second half fails, and a matrix with two
 * people too many is a thing you can see and fix.
 */
export function useSaveMatrix(onDate: string, shift: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kind: MatrixKind) => {
      const { data, error } = await supabase
        .from("daily_allocations")
        .select("employee_id,area_id")
        .eq("shift", shift)
        .eq("on_date", onDate)
        .in("status", ["assigned", "overtime"]);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ employee_id: string; area_id: string | null }>;
      // Saving an empty board would wipe the standard with a day nobody had filled in
      // yet — the likeliest morning for somebody to press this by mistake.
      if (rows.length === 0) throw new Error(`Nobody is on the ${shift} board today, so there is no matrix to save`);

      const savedBy = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { error: upErr } = await matrixTable()
        .upsert(
          rows.map((r) => ({
            shift,
            kind,
            employee_id: r.employee_id,
            area_id: r.area_id,
            saved_from: onDate,
            saved_by: savedBy,
          })),
          { onConflict: "shift,kind,employee_id" },
        );
      if (upErr) throw upErr;

      // Only this kind is cleared. The other standard of the same board is a separate
      // answer to a separate day and must survive a save it had no part in.
      const { error: delErr } = await matrixTable()
        .delete()
        .eq("shift", shift)
        .eq("kind", kind)
        .not("employee_id", "in", `(${rows.map((r) => r.employee_id).join(",")})`);
      // Not fatal: the standard is saved, it just still names people this board no
      // longer has. Saying so is better than undoing the part that worked.
      if (delErr) toast.warning(`Matrix saved, but the people who left it are still on it: ${delErr.message}`);

      return { count: rows.length, label: MATRIX_KINDS.find((k) => k.kind === kind)?.label ?? kind };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["headcount-matrix", shift] });
      toast.success(`${shift} ${r.label} matrix saved — ${r.count} people, from ${onDate}`, { id: "headcount-matrix" });
    },
    onError: (e: Error) => toast.error(e.message ?? "Could not save the matrix", { id: "headcount-matrix" }),
  });
}

/**
 * The earlier days this board could be copied from, with how many people each holds.
 *
 * Only days somebody worked. A day carrying nothing but two holiday marks is not a
 * board — 06/08 and 09/08 to 13/08 are exactly that — and offering it would offer an
 * empty one. The count is what makes the menu a decision rather than a guess: it is
 * the difference between a full Tuesday and a skeleton Saturday, said before pressing.
 *
 * The block is deliberately larger than the ten days shown — a thousand rows is a
 * fortnight of a full board — and asks for exactly what PostgREST caps a response at.
 * Asking for more would hide the cut: the answer would come back short of what was
 * asked for and look complete. At the cap, a full block means the oldest date in it
 * may be the half of one that fitted, and `copyableDays` drops that date rather than
 * show a Tuesday of seventy-five with twelve against it.
 */
const COPYABLE_BLOCK = 1000;

export function useCopyableDays(onDate: string, shift: string) {
  return useQuery({
    queryKey: ["headcount-copyable-days", onDate, shift],
    queryFn: async (): Promise<CopyableDay[]> => {
      const { data, error } = await supabase
        .from("daily_allocations")
        .select("on_date,employee_id")
        .eq("shift", shift)
        .lt("on_date", onDate)
        .in("status", ["assigned", "overtime"])
        .order("on_date", { ascending: false })
        .limit(COPYABLE_BLOCK);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ on_date: string; employee_id: string }>;
      return copyableDays(rows, { maybeTruncated: rows.length >= COPYABLE_BLOCK });
    },
    staleTime: 60 * 1000,
  });
}

export function useAllocationMutations(onDate: string, shift: string) {
  const qc = useQueryClient();
  const rotaCover = useRotaCover();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["headcount-allocations", onDate, shift] });

  const place = useMutation({
    mutationFn: async (input: {
      employeeId: string; areaId: string | null; status: AllocStatus;
      halfDay?: boolean;
      /** "HH:MM" if they went home early, null if they worked the shift out. */
      leftEarlyAt?: string | null;
      /** "HH:MM" if they came in after the shift started, null if they were on time. */
      arrivedLateAt?: string | null;
      /**
       * True when the status is the thing being chosen, not a side effect of moving
       * somebody. Set by the day dialog's controls; left off by every drag and picker,
       * where "assigned" only ever means "put them here".
       */
      explicit?: boolean;
    }) => {
      // What is being written over. Placing somebody on a line replaced an approved
      // holiday without a word: Ricardo Fernandes was booked off on 11/08, somebody
      // planned him onto Line 6 that afternoon, and the board simply showed him on the
      // line. The leave request still said approved, so the two screens disagreed and
      // neither said why.
      //
      // Read before writing rather than refused: he may genuinely have come in, and a
      // board nobody can override on the day is a board people work around. It just
      // has to be a decision instead of an accident.
      //
      // Read for every placement now, not only the working ones, because the row also
      // says where they stand and whether they lead it — and both decide what this
      // write is allowed to be.
      const { data: prevRow } = await supabase
        .from("daily_allocations")
        .select("status,area_id,is_leader")
        .eq("on_date", onDate).eq("shift", shift).eq("employee_id", input.employeeId)
        .maybeSingle();
      const prev = prevRow as { status?: string; area_id?: string | null; is_leader?: boolean } | null;
      const was = prev?.status;
      let replaced: string | null = null;
      if ((input.status === "assigned" || input.status === "overtime")
        && (was === "holiday" || was === "sick" || was === "unpaid")) {
        replaced = was;
      }

      // A shift nobody's rota covers is overtime whether or not anyone remembers to say
      // so. Eleven people were on the night board on Friday 07/08, which no night rota
      // covers; ten were saved as "assigned" and paid as an ordinary night.
      const status = statusForPlacement(
        input.status,
        (was ?? null) as AllocStatus | null,
        rotaCover(input.employeeId, onDate, shift),
        input.explicit === true,
      );

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
            area_id: status === "assigned" || status === "overtime" ? input.areaId : null,
            status,
            // Half a day off. The column has been on this table since it was created
            // and nothing ever wrote to it, so a half-day holiday was recorded as a
            // whole one — the difference between somebody who worked the morning and
            // somebody who was not there at all.
            half_day: input.halfDay ?? false,
            // A day worked and cut short is not a day off, so it does not go through
            // `half_day`. Somebody who left at two was on the line all morning: the
            // headcount still counted them, and the supervisor still needs to see it.
            // Only a working status can carry it — you cannot leave early from a day
            // you were never at.
            left_early_at:
              status === "assigned" || status === "overtime"
                ? input.leftEarlyAt ?? null
                : null,
            // The other end of the same day, and the same rule: a late start is only a
            // late start if there was a shift to be late for. The board could say "went
            // home early" and had no way at all to say "came in at nine", so three hours
            // of a line running short lived nowhere.
            arrived_late_at:
              status === "assigned" || status === "overtime"
                ? input.arrivedLateAt ?? null
                : null,
            // Moving somebody out of a column ends their leadership of it. The rule is
            // in `keepsLeadership`, with the index it exists to satisfy and the evening
            // it was learnt on. The sheet import writes `area_id` too and asks the same
            // function: the rule had already been written twice, and the second copy is
            // how the import came to carry a mark the board would have dropped.
            is_leader: keepsLeadership(prev, { areaId: input.areaId, status }),
          },
          { onConflict: "on_date,shift,employee_id" },
        );
      if (error) throw error;

      // The board and the payroll record have to say the same thing.
      //
      // Marking somebody off here wrote only `daily_allocations`, so a holiday put on
      // the board never reached `employee_attendance` and the finance close never
      // counted it — eight of the thirteen days marked this way were invisible to
      // payroll. Anderson Cavalcante's 06/08 was one of them.
      //
      // Assigned and overtime write "present" for the same reason in reverse: moving
      // somebody back onto a line has to clear the holiday it replaced, or the close
      // pays a day they worked.
      // Each board status has a payroll record of its own now. Sick and unpaid used to
      // collapse into "absent", which the finance close could only report as an
      // absence of unstated kind — and the kind is what decides whether it is paid.
      // Shared with the sheet import, which is where the two last disagreed.
      const attendance = attendanceForStatus(status);
      const { error: attErr } = await (supabase as any)
        .from("employee_attendance")
        .upsert(
          { employee_id: input.employeeId, on_date: onDate, status: attendance },
          { onConflict: "employee_id,on_date" },
        );
      // Not fatal: the board placement is the thing the user asked for, and a failure
      // here must not undo it. It surfaces as a warning rather than a rollback.
      if (attErr) toast.warning(`Placed on the board, but the attendance record did not save: ${attErr.message}`);

      if (replaced) {
        toast.warning(
          replaced === "holiday"
            ? "That day was booked as holiday — putting them on a line has replaced it."
            : `That day was recorded as ${replaced} — putting them on a line has replaced it.`,
          { duration: 8000 },
        );
      }
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

  /**
   * Fills this day with the last day this board had people on it.
   *
   * It used to look for the most recent day of the same *type* — weekday, Saturday or
   * Sunday — inside a three-week window, and to throw "No previous day of the same
   * type found" when there was none. The night board is two days old, so on it that
   * was every weekend: Saturday 08/08 was typed in by hand, a name a minute for
   * twenty minutes, while the button sat there refusing to offer the Friday night
   * standing right behind it. No day in this table's history was ever filled by it.
   *
   * The last day worked is now simply the last day worked. A day that holds nothing
   * but a couple of holiday marks is not one — 06/08 and 09/08 to 13/08 are each two
   * or three absences and no one else — so the search is for somebody working, which
   * is also the only thing that gets copied. See `rowsToCopy` for what does not.
   *
   * A date can be named instead, from the menu of days `useCopyableDays` builds. The
   * last day worked is the one wanted most mornings, but not on a Monday: the day
   * behind it is a Sunday of thirty people and the board being planned is a weekday of
   * seventy. Naming the day is the same copy with the search skipped — every rule
   * below it is untouched, because which day it came from changes nothing about who
   * may be written over.
   *
   * Or the matrix: the board as it is meant to look, rather than as it looked once.
   * That one is filtered by the rota before anything else happens — the matrix holds
   * everybody on the board and only some of them are due in on any given date. Every
   * weekday here is a crossover: Monday is the Mon–Thu crew and the Fri–Mon crew,
   * Friday is Tue–Fri and Fri–Mon, and copying the lot onto a Friday would put the
   * thirty-nine of Mon–Thu on a day they are not due and record every one of them as
   * overtime.
   */
  const copyLastLikeDay = useMutation({
    mutationFn: async (from: CopySource = { kind: "last" }) => {
      let source: string | null = from.kind === "day" ? from.on_date : null;
      const matrixKind = from.kind === "matrix" ? from.matrix : null;
      if (from.kind === "last") {
        const { data: last, error: srcErr } = await supabase
          .from("daily_allocations")
          .select("on_date")
          .eq("shift", shift)
          .lt("on_date", onDate)
          .in("status", ["assigned", "overtime"])
          .order("on_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (srcErr) throw srcErr;
        source = (last as { on_date: string } | null)?.on_date ?? null;
        if (!source) throw new Error(`No earlier day on the ${shift} board has anybody to copy`);
      }

      // Where the placements come from, and what this day already says. Read together
      // because the second decides who is left out of the first.
      const [srcRows, hereRows] = await Promise.all([
        source === null
          ? matrixTable().select("employee_id,area_id").eq("shift", shift).eq("kind", matrixKind)
          : supabase.from("daily_allocations").select("employee_id,area_id,status").eq("shift", shift).eq("on_date", source),
        supabase.from("daily_allocations").select("employee_id").eq("shift", shift).eq("on_date", onDate),
      ]);
      if (srcRows.error) throw srcRows.error;
      if (hereRows.error) throw hereRows.error;

      // The matrix says where somebody stands, never that they are in. Anybody the
      // rota does not put on this board on this date is dropped here rather than
      // written down as working outside their rota — they are simply not due.
      // Unknown is not off, exactly as everywhere else: an unrecorded rota is kept.
      const placements: BoardPlacement[] = source === null
        ? ((srcRows.data ?? []) as Array<{ employee_id: string; area_id: string | null }>)
            .filter((r) => !isOffRota(rotaCover(r.employee_id, onDate, shift)))
            .map((r) => ({ employee_id: r.employee_id, area_id: r.area_id, status: "assigned" }))
        : ((srcRows.data ?? []) as BoardPlacement[]);
      const label = source ?? `the ${shift} ${MATRIX_KINDS.find((k) => k.kind === matrixKind)?.label ?? ""} matrix`;

      const here = (hereRows.data ?? []) as Array<{ employee_id: string }>;
      const onBoard = new Set(here.map((r) => r.employee_id));
      const working = placements.filter((r) => r.status === "assigned" || r.status === "overtime");
      // A named day can be a day nobody worked, and a matrix can be empty or hold
      // nobody due in today. Said plainly, because "nobody was copied" and "nobody was
      // there" are different answers and only one of them means try another day.
      if (working.length === 0) {
        throw new Error(
          source === null
            ? `Nobody in the ${shift} ${MATRIX_KINDS.find((k) => k.kind === matrixKind)?.label ?? ""} matrix is due in on this day`
            : `Nobody worked the ${shift} board on ${source}`,
        );
      }
      const candidates = [...new Set(
        working.filter((r) => !onBoard.has(r.employee_id)).map((r) => r.employee_id),
      )];

      // The other two things this day can already say about somebody.
      //
      // A day off is recorded twice — `daily_allocations` and `employee_attendance` —
      // and the two are not always both there. Eleven days in the last week hold an
      // attendance row with no board row behind it, several of them holiday, sick and
      // unpaid: leave booked before anybody was placed, or booked on a day whose board
      // nobody has opened. Those people are not at work, and copying them onto a line
      // would have overwritten approved leave with a day the close pays for.
      //
      // And a leaver keeps the days they worked — the history is theirs — so they are
      // still on the source day. Copied forward they would land on a board that draws
      // only active people: a row nobody can see, nobody can drag off, and payroll
      // counts anyway.
      const [awayRows, activeRows] = candidates.length
        ? await Promise.all([
            supabase.from("employee_attendance").select("employee_id,status").eq("on_date", onDate).in("employee_id", candidates),
            supabase.from("employees").select("id").eq("active", true).in("id", candidates),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (awayRows.error) throw awayRows.error;
      if (activeRows.error) throw activeRows.error;
      const away = ((awayRows.data ?? []) as Array<{ employee_id: string; status: string }>)
        .filter((r) => r.status !== "present")
        .map((r) => r.employee_id);
      const active = new Set(((activeRows.data ?? []) as Array<{ id: string }>).map((r) => r.id));
      const gone = candidates.filter((id) => !active.has(id));

      const payload = rowsToCopy({
        source: placements,
        onDate,
        shift,
        alreadyOnTheDay: [...onBoard, ...away, ...gone],
        cover: (id) => rotaCover(id, onDate, shift),
      });
      if (payload.length === 0) {
        return { source: label, written: 0, kept: here.length, away: away.length, gone: gone.length };
      }

      // Ignoring duplicates rather than overwriting them, so nothing already on the
      // day can be replaced by a race between the reads above and this write. The rows
      // that come back are the ones that were actually inserted, which is what the
      // count and the payroll write below are both built from — claiming a row a race
      // dropped would be the same lie in two places.
      const { data: written, error: upErr } = await supabase
        .from("daily_allocations")
        .upsert(payload, { onConflict: "on_date,shift,employee_id", ignoreDuplicates: true })
        .select("employee_id,status");
      if (upErr) throw upErr;
      const inserted = (written ?? []) as Array<{ employee_id: string; status: string }>;

      // Payroll hears about it too, for the same reason `place` tells it: a day filled
      // only from here would otherwise be a full board the finance close cannot see.
      // Only for the rows just created — everybody this day already had a word about,
      // on the board or in payroll, was left out long before this line.
      if (inserted.length) {
        const { error: attErr } = await supabase
          .from("employee_attendance")
          .upsert(
            attendanceFromBoard(inserted.map((p) => ({ employeeId: p.employee_id, date: onDate, status: p.status }))),
            { onConflict: "employee_id,on_date" },
          );
        if (attErr) toast.warning(`Copied onto the board, but the attendance records did not save: ${attErr.message}`);
      }

      return { source: label, written: inserted.length, kept: here.length, away: away.length, gone: gone.length };
    },
    onSuccess: (r) => {
      invalidate();
      // The screens that read the other half of what this wrote. A copy that fills a
      // board also fills sixty attendance rows, and Leave and the finance close would
      // otherwise go on showing the day as empty until something else refetched them.
      qc.invalidateQueries({ queryKey: ["employee_attendance"] });
      qc.invalidateQueries({ queryKey: ["employee_attendance_range"] });
      // This day has just become one of the days another day can be copied from.
      qc.invalidateQueries({ queryKey: ["headcount-copyable-days"] });
      // Nobody to copy is not a failure — it is the answer to the question, and a red
      // toast for it reads like the button is broken again.
      if (r.written === 0) {
        toast.info(`Everybody in ${r.source} is already accounted for on this day`, { id: "headcount-copy" });
        return;
      }
      const left = [
        r.kept > 0 ? `${r.kept} already on this board` : null,
        r.away > 0 ? `${r.away} booked off` : null,
        r.gone > 0 ? `${r.gone} no longer with us` : null,
      ].filter(Boolean);
      toast.success(
        left.length
          ? `Copied ${r.written} people from ${r.source}. Left as they were: ${left.join(", ")}.`
          : `Copied ${r.written} people from ${r.source}`,
        { id: "headcount-copy" },
      );
    },
    onError: (e: Error) => toast.error(e.message ?? "Could not copy the last day", { id: "headcount-copy" }),
  });

  /**
   * Who leads an area today.
   *
   * Leadership used to be read off `department`, which is free text holding things
   * like "Lab Operative" — a toggle there would have overwritten the person's role to
   * record a fact about one shift. It belongs on the day: the same line can be led by
   * somebody else tomorrow, and a leader on days is not the leader on nights.
   *
   * Setting one clears whoever held it on that area, so the column cannot show two.
   */
  const setLeader = useMutation({
    mutationFn: async ({ employeeId, areaId, leader }: { employeeId: string; areaId: string | null; leader: boolean }) => {
      if (leader && areaId) {
        const { error: clearErr } = await supabase
          .from("daily_allocations")
          .update({ is_leader: false })
          .eq("on_date", onDate).eq("shift", shift).eq("area_id", areaId).eq("is_leader", true);
        if (clearErr) throw clearErr;
      }
      const { error } = await supabase
        .from("daily_allocations")
        .update({ is_leader: leader })
        .eq("on_date", onDate).eq("shift", shift).eq("employee_id", employeeId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message ?? "Could not set the leader"),
  });

  return { place, remove, copyLastLikeDay, setLeader };
}

/**
 * Move somebody to another shift, and take their upcoming days with them.
 *
 * `daily_allocations.shift` is the board a person was planned onto, not a copy of
 * their crew — that is what lets the Fri–Mon crew be planned onto Monday's day board.
 * But when somebody genuinely changes shift, the days still ahead were planned on the
 * wrong board and would leave them showing on the tab they just left.
 *
 * Days already past are not touched. Somebody moved to nights in August was on days
 * in July, and July's board has to keep saying so.
 */
export function useChangeShift(onDate: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, shiftGroup }: { employeeId: string; shiftGroup: string }) => {
      // The rota this move must not disturb. A position row carries the crew and the
      // rota together, so writing one without reading the other would blank it.
      const { data: held, error: readErr } = await supabase
        .from("employees")
        .select("shift_pattern_id")
        .eq("id", employeeId)
        .single();
      if (readErr) throw readErr;

      const { error } = await supabase.from("employees").update({ shift_group: shiftGroup }).eq("id", employeeId);
      if (error) throw error;

      // And the record of it, which is what every date-aware read actually asks.
      // See `recordPosition`: the column alone was never enough.
      await recordPosition({
        employeeId,
        onDate,
        shiftGroup,
        shiftPatternId: (held as { shift_pattern_id: string | null }).shift_pattern_id,
        note: "Shift changed on the headcount board",
      });

      const board = boardShiftFor(shiftGroup);
      if (board) {
        // The mark stays behind with the board it was on: leading Line 1 on days says
        // nothing about Line 1 on nights, and carrying it across could land a second
        // leader in a column that already has one — the same index, the same refusal.
        const { error: moveErr } = await supabase
          .from("daily_allocations")
          .update({ shift: board, is_leader: false })
          .eq("employee_id", employeeId)
          .gte("on_date", onDate);
        if (moveErr) throw moveErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["headcount-roster-all"] });
      qc.invalidateQueries({ queryKey: ["headcount-allocations"] });
      qc.invalidateQueries({ queryKey: ["employee_shift_history"] });
      toast.success("Shift changed. Days already past keep the shift they were worked on.");
    },
    onError: (e: Error) => toast.error(e.message ?? "Could not change the shift"),
  });
}

/**
 * Write down where somebody stands from a date.
 *
 * `employees.shift_group` and `employees.shift_pattern_id` are where the app looks
 * when it is not asking about a date. `employee_shift_history` is where it looks when
 * it is — and it is asking about a date every time it decides whether a shift is an
 * ordinary day or overtime, because July must be judged against July's rota.
 *
 * The board's two controls wrote only the columns. So a rota changed here reached
 * every screen and none of the rules: Josiley Rocon was put on Fri–Mon days, the
 * history still said Mon–Thu days, and the Saturday he was due in was saved as
 * overtime — while the dialog showed Fri–Mon back to the person who had just set it.
 * Eighty of a hundred and ninety-four active people had drifted the same way.
 *
 * Effective from the board's own date, not from today. Somebody correcting Tuesday's
 * board on Thursday means Tuesday, and that is also the date the allocations move on.
 */
async function recordPosition(input: {
  employeeId: string;
  onDate: string;
  shiftGroup: string | null;
  shiftPatternId: string | null;
  note: string;
}) {
  const { error } = await (supabase as any).from("employee_shift_history").upsert(
    {
      employee_id: input.employeeId,
      shift_group: input.shiftGroup,
      shift_pattern_id: input.shiftPatternId,
      effective_from: input.onDate,
      note: input.note,
    },
    { onConflict: "employee_id,effective_from" },
  );
  if (error) throw error;
}

/**
 * Save the order the columns are shown in.
 *
 * `sort_order` already decided the order — it was just nobody's to change without a
 * SQL client. The order is a property of the area, not of a person or a day, so
 * moving Line 2 sticks for everyone and for every date; that is the point, because
 * the board is meant to read like the sheet the factory already has.
 */
export function useReorderAreas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ordered: { id: string; sort_order: number }[]) => {
      for (const a of ordered) {
        const { error } = await supabase
          .from("headcount_areas")
          .update({ sort_order: a.sort_order })
          .eq("id", a.id);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["headcount-areas"] }),
    onError: (e: Error) => toast.error(e.message ?? "Could not save the new order"),
  });
}

/**
 * Put somebody on a different rota.
 *
 * The rota and the shift are two answers, not one. The shift says which crew they
 * belong to — which board they show on. The rota says which weekdays they are due in,
 * and it is what decides whether today is a normal day or a call-in. "Mon–Thu" exists
 * for both days and nights, so folding them into one list would make one of the two
 * unanswerable.
 */
export function useSetShiftPattern(onDate: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, patternId }: { employeeId: string; patternId: string | null }) => {
      // The crew this change must not disturb — the position row holds both.
      const { data: held, error: readErr } = await supabase
        .from("employees")
        .select("shift_group")
        .eq("id", employeeId)
        .single();
      if (readErr) throw readErr;

      const { error } = await supabase
        .from("employees")
        .update({ shift_pattern_id: patternId })
        .eq("id", employeeId);
      if (error) throw error;

      await recordPosition({
        employeeId,
        onDate,
        shiftGroup: (held as { shift_group: string | null }).shift_group,
        shiftPatternId: patternId,
        note: "Rota changed on the headcount board",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["headcount-roster-all"] });
      qc.invalidateQueries({ queryKey: ["headcount-allocations"] });
      qc.invalidateQueries({ queryKey: ["employee_shift_history"] });
      toast.success("Rota changed. Which days they are due in follows it from this day on.");
    },
    onError: (e: Error) => toast.error(e.message ?? "Could not change the rota"),
  });
}
