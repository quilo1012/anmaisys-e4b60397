import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The button that fills a board from the last day worked.
 *
 * Its rule lives in a query, which is where it hid: it used to ask for the most recent
 * day of the same *type* — weekday, Saturday or Sunday — inside a three-week window,
 * and the night board is two days old, so on it that was every weekend. It failed with
 * "No previous day of the same type found" every time it was pressed there, and the
 * Saturday board was typed in by hand instead. Nothing in the table's whole history was
 * ever filled by it.
 *
 * `rowsToCopy` is tested on its own. These tests cover the half that a unit test of a
 * pure function cannot reach: which day is asked for, and who is left out of the answer
 * because the day already has something to say about them.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

type Recorded = {
  table: string;
  op: "read" | "upsert" | "update" | "delete";
  select?: string;
  filters: Record<string, unknown>;
  payload?: unknown;
  options?: unknown;
};

let recorded: Recorded[] = [];
let answer: (r: Recorded) => unknown[] = () => [];

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const rec: Recorded = { table, op: "read", filters: {} };
    const finish = (single: boolean) => {
      recorded.push(rec);
      const rows = answer(rec) ?? [];
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: (cols?: string) => { rec.select = cols; return b; },
      eq: (c: string, v: unknown) => { rec.filters[c] = v; return b; },
      lt: (c: string, v: unknown) => { rec.filters[`lt:${c}`] = v; return b; },
      gte: (c: string, v: unknown) => { rec.filters[`gte:${c}`] = v; return b; },
      in: (c: string, v: unknown) => { rec.filters[`in:${c}`] = v; return b; },
      order: (c: string, o: unknown) => { rec.filters[`order:${c}`] = o; return b; },
      limit: (n: number) => { rec.filters.limit = n; return b; },
      upsert: (p: unknown, o: unknown) => { rec.op = "upsert"; rec.payload = p; rec.options = o; return b; },
      update: (p: unknown) => { rec.op = "update"; rec.payload = p; return b; },
      delete: () => { rec.op = "delete"; return b; },
      not: (c: string, op: string, v: unknown) => { rec.filters[`not:${c}`] = `${op}.${v}`; return b; },
      maybeSingle: async () => finish(true),
      single: async () => finish(true),
      then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(finish(false)).then(resolve, reject),
    });
    return b;
  }
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      auth: { getUser: async () => ({ data: { user: { id: "supervisor" } }, error: null }) },
    },
  };
});

import { useAllocationMutations, useSaveMatrix } from "./useHeadcount";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const ON_DATE = "2026-08-08";
const SOURCE = "2026-08-07";

/** The read that picks the day to copy from. */
const sourceQuery = () =>
  recorded.find((r) => r.table === "daily_allocations" && r.op === "read" && r.select === "on_date");
const boardWrite = () => recorded.find((r) => r.table === "daily_allocations" && r.op === "upsert");
const payrollWrite = () => recorded.find((r) => r.table === "employee_attendance" && r.op === "upsert");

/**
 * Four people on the source night. Only Ana should come across: Bruno is already on
 * this board, Carla's day off reached payroll and never reached the board, and Diogo
 * has left — his rows stay where they were worked, but he is not put on a new day.
 */
function fourPeople(): (r: Recorded) => unknown[] {
  return (r) => {
    if (r.table === "daily_allocations" && r.select === "on_date") return [{ on_date: SOURCE }];
    if (r.table === "daily_allocations" && r.select === "employee_id,area_id,status") {
      return [
        { employee_id: "ana", area_id: "line-1", status: "assigned" },
        { employee_id: "bruno", area_id: "line-2", status: "assigned" },
        { employee_id: "carla", area_id: "line-1", status: "assigned" },
        { employee_id: "diogo", area_id: "line-3", status: "assigned" },
      ];
    }
    if (r.table === "daily_allocations" && r.select === "employee_id") return [{ employee_id: "bruno" }];
    if (r.table === "employee_attendance" && r.op === "read") return [{ employee_id: "carla", status: "holiday" }];
    if (r.table === "employees" && r.select === "id") return [{ id: "ana" }, { id: "bruno" }, { id: "carla" }];
    if (r.table === "daily_allocations" && r.op === "upsert") {
      return (r.payload as Array<{ employee_id: string; status: string }>);
    }
    return [];
  };
}

async function copy(chosen?: string) {
  const { result } = renderHook(() => useAllocationMutations(ON_DATE, "Night"), { wrapper: wrapper() });
  result.current.copyLastLikeDay.mutate(chosen ? { kind: "day", on_date: chosen } : { kind: "last" });
  await waitFor(() => expect(result.current.copyLastLikeDay.isSuccess).toBe(true));
}

beforeEach(() => {
  recorded = [];
  answer = fourPeople();
});

describe("copyLastLikeDay, choosing the day", () => {
  it("asks for the last earlier day this board had somebody working", async () => {
    await copy();
    const q = sourceQuery();
    expect(q?.filters).toMatchObject({
      shift: "Night",
      "lt:on_date": ON_DATE,
      // A day holding nothing but holiday marks is not a day with people on it.
      "in:status": ["assigned", "overtime"],
      "order:on_date": { ascending: false },
      limit: 1,
    });
  });

  it("does not bound the search by day-type or by a window", async () => {
    await copy();
    const keys = Object.keys(sourceQuery()?.filters ?? {});
    // The three-week floor was the bug: on the night board it ruled out the only day
    // there was. Nothing may quietly put a floor back.
    expect(keys.some((k) => k.startsWith("gte:"))).toBe(false);
  });
});

describe("copyLastLikeDay, choosing who comes across", () => {
  it("writes only the people this day has nothing to say about", async () => {
    await copy();
    expect(boardWrite()?.payload).toEqual([
      { on_date: ON_DATE, shift: "Night", employee_id: "ana", area_id: "line-1", status: "assigned" },
    ]);
  });

  it("never overwrites a row this day already holds", async () => {
    await copy();
    // The database enforces it, not the read above: between the two there is a race,
    // and on the other side of it is somebody's approved holiday.
    expect(boardWrite()?.options).toMatchObject({
      onConflict: "on_date,shift,employee_id",
      ignoreDuplicates: true,
    });
  });

  it("does not rewrite payroll for somebody already booked off", async () => {
    await copy();
    const rows = payrollWrite()?.payload as Array<{ employee_id: string; status: string }>;
    expect(rows).toEqual([{ employee_id: "ana", on_date: ON_DATE, status: "present" }]);
    // Carla's holiday reached payroll and not the board. Marking her present would
    // have replaced approved leave with a day the finance close pays for.
    expect(rows.some((r) => r.employee_id === "carla")).toBe(false);
  });

  it("tells payroll about the rows it actually created", async () => {
    // Ignored duplicates come back as nothing, so the attendance write is built from
    // what the insert returned rather than from what it was asked to insert.
    await copy();
    expect(payrollWrite()).toBeDefined();
    expect((payrollWrite()?.payload as unknown[]).length).toBe(1);
  });

  it("writes nothing at all when the day is already accounted for", async () => {
    const full = fourPeople();
    answer = (r) =>
      r.table === "daily_allocations" && r.select === "employee_id"
        ? [{ employee_id: "ana" }, { employee_id: "bruno" }, { employee_id: "carla" }, { employee_id: "diogo" }]
        : full(r);
    await copy();
    expect(boardWrite()).toBeUndefined();
    expect(payrollWrite()).toBeUndefined();
  });
});

describe("copyLastLikeDay, from a day the user names", () => {
  it("takes the day it was given and does not go looking", async () => {
    await copy("2026-08-04");
    expect(sourceQuery()).toBeUndefined();
    const read = recorded.find((r) => r.select === "employee_id,area_id,status");
    expect(read?.filters).toMatchObject({ shift: "Night", on_date: "2026-08-04" });
  });

  it("applies the same rules to a named day", async () => {
    // Choosing the day changes which board is copied, and nothing else: Bruno is on
    // this day already, Carla is booked off, Diogo has left.
    await copy("2026-08-04");
    expect(boardWrite()?.payload).toEqual([
      { on_date: ON_DATE, shift: "Night", employee_id: "ana", area_id: "line-1", status: "assigned" },
    ]);
  });

  it("says so when nobody worked the day that was named", async () => {
    const full = fourPeople();
    answer = (r) => (r.select === "employee_id,area_id,status" ? [] : full(r));
    const { result } = renderHook(() => useAllocationMutations(ON_DATE, "Night"), { wrapper: wrapper() });
    result.current.copyLastLikeDay.mutate({ kind: "day", on_date: "2026-07-31" });
    await waitFor(() => expect(result.current.copyLastLikeDay.isError).toBe(true));
    // "Nobody was copied" and "nobody was there" are different answers, and only one
    // of them means try another day.
    expect(result.current.copyLastLikeDay.error?.message).toContain("2026-07-31");
    expect(boardWrite()).toBeUndefined();
  });
});

/**
 * The matrix path. 2026-08-08 is a Saturday, and "Mon–Thu nights" is [1,2,3,4]: Ana is
 * in the matrix and not due in. Every weekday here is a crossover of two rotas, so a
 * matrix copied without asking the rota would put a whole crew on a day they do not
 * work and record every one of them as overtime.
 */
function matrixOf(rows: Array<{ employee_id: string; area_id: string | null }>): (r: Recorded) => unknown[] {
  return (r) => {
    if (r.table === "headcount_matrix") return rows;
    if (r.table === "shift_patterns") return [{ id: "mon-thu-nights", name: "Mon–Thu nights", days: [1, 2, 3, 4] }];
    if (r.table === "employees" && (r.select ?? "").includes("full_name")) {
      return [
        { id: "ana", full_name: "Ana", shift_group: "Night", department: null, shift_pattern_id: "mon-thu-nights" },
        { id: "bruno", full_name: "Bruno", shift_group: "Night", department: null, shift_pattern_id: null },
      ];
    }
    if (r.table === "employees" && r.select === "id") return [{ id: "ana" }, { id: "bruno" }];
    if (r.table === "daily_allocations" && r.op === "upsert") {
      return r.payload as Array<{ employee_id: string; status: string }>;
    }
    return [];
  };
}

async function copyMatrix() {
  const { result } = renderHook(() => useAllocationMutations(ON_DATE, "Night"), { wrapper: wrapper() });
  // The rota has to be in hand before the copy asks it anything.
  await waitFor(() => {
    expect(recorded.some((r) => r.table === "shift_patterns")).toBe(true);
    expect(recorded.some((r) => r.table === "employees" && (r.select ?? "").includes("full_name"))).toBe(true);
  });
  result.current.copyLastLikeDay.mutate({ kind: "matrix", matrix: "normal" });
  await waitFor(() => expect(result.current.copyLastLikeDay.isSuccess).toBe(true));
}

describe("copyLastLikeDay, from the matrix", () => {
  it("reads the matrix and does not go looking for a day", async () => {
    answer = matrixOf([{ employee_id: "bruno", area_id: "line-2" }]);
    await copyMatrix();
    expect(sourceQuery()).toBeUndefined();
    expect(recorded.find((r) => r.table === "headcount_matrix")?.filters).toMatchObject({ shift: "Night" });
  });

  it("leaves out whoever the rota does not put in that day", async () => {
    answer = matrixOf([
      { employee_id: "ana", area_id: "line-1" },
      { employee_id: "bruno", area_id: "line-2" },
    ]);
    await copyMatrix();
    // Ana works Mon–Thu nights; 08/08 is a Saturday. She is not overtime, she is not in.
    expect(boardWrite()?.payload).toEqual([
      { on_date: ON_DATE, shift: "Night", employee_id: "bruno", area_id: "line-2", status: "assigned" },
    ]);
  });

  it("keeps somebody whose rota nobody has recorded", async () => {
    // Eleven of the night crew have no rota on file. Unknown is not off, and dropping
    // them would quietly shrink every board the matrix fills.
    answer = matrixOf([{ employee_id: "bruno", area_id: null }]);
    await copyMatrix();
    expect((boardWrite()?.payload as unknown[]).length).toBe(1);
  });

  it("says nobody is due rather than writing an empty day", async () => {
    answer = matrixOf([{ employee_id: "ana", area_id: "line-1" }]);
    const { result } = renderHook(() => useAllocationMutations(ON_DATE, "Night"), { wrapper: wrapper() });
    await waitFor(() => {
      expect(recorded.some((r) => r.table === "shift_patterns")).toBe(true);
      expect(recorded.some((r) => r.table === "employees" && (r.select ?? "").includes("full_name"))).toBe(true);
    });
    result.current.copyLastLikeDay.mutate({ kind: "matrix", matrix: "normal" });
    await waitFor(() => expect(result.current.copyLastLikeDay.isError).toBe(true));
    expect(result.current.copyLastLikeDay.error?.message).toContain("due in");
    expect(boardWrite()).toBeUndefined();
  });
});

describe("copyLastLikeDay, two matrices per board", () => {
  it("reads the matrix that was asked for and not the other one", async () => {
    // A changeover day is not a Wednesday. Monday and Friday are a crew finishing and
    // a crew starting, and the board they need is not the one the middle of the week
    // is copied from — so the two are stored apart and asked for by name.
    answer = matrixOf([{ employee_id: "bruno", area_id: "line-2" }]);
    const { result } = renderHook(() => useAllocationMutations(ON_DATE, "Night"), { wrapper: wrapper() });
    await waitFor(() => {
      expect(recorded.some((r) => r.table === "shift_patterns")).toBe(true);
      expect(recorded.some((r) => r.table === "employees" && (r.select ?? "").includes("full_name"))).toBe(true);
    });
    result.current.copyLastLikeDay.mutate({ kind: "matrix", matrix: "changeover" });
    await waitFor(() => expect(result.current.copyLastLikeDay.isSuccess).toBe(true));

    expect(recorded.find((r) => r.table === "headcount_matrix")?.filters).toMatchObject({
      shift: "Night",
      kind: "changeover",
    });
  });
});

describe("useSaveMatrix", () => {
  const board = () => (r: Recorded) =>
    r.table === "daily_allocations" && r.op === "read"
      ? [
          { employee_id: "ana", area_id: "line-1" },
          { employee_id: "bruno", area_id: null },
        ]
      : [];

  async function save(kind: "normal" | "changeover") {
    const { result } = renderHook(() => useSaveMatrix(ON_DATE, "Night"), { wrapper: wrapper() });
    result.current.mutate(kind);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  }

  const matrixWrite = () => recorded.find((r) => r.table === "headcount_matrix" && r.op === "upsert");
  const matrixClear = () => recorded.find((r) => r.table === "headcount_matrix" && r.op === "delete");

  it("saves the board under the kind it was told", async () => {
    answer = board();
    await save("changeover");
    expect(matrixWrite()?.payload).toEqual([
      { shift: "Night", kind: "changeover", employee_id: "ana", area_id: "line-1", saved_from: ON_DATE, saved_by: "supervisor" },
      { shift: "Night", kind: "changeover", employee_id: "bruno", area_id: null, saved_from: ON_DATE, saved_by: "supervisor" },
    ]);
    expect(matrixWrite()?.options).toMatchObject({ onConflict: "shift,kind,employee_id" });
  });

  it("clears only that kind, never the board's other standard", async () => {
    // The two answer different days. A save of one must not empty the other.
    answer = board();
    await save("normal");
    expect(matrixClear()?.filters).toMatchObject({ shift: "Night", kind: "normal" });
  });

  it("refuses to save an empty board", async () => {
    // The likeliest morning for somebody to press this by mistake is the one where the
    // board has nothing on it yet — and it would wipe the standard with the mistake.
    answer = () => [];
    const { result } = renderHook(() => useSaveMatrix(ON_DATE, "Night"), { wrapper: wrapper() });
    result.current.mutate("normal");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(matrixWrite()).toBeUndefined();
    expect(matrixClear()).toBeUndefined();
  });
});

/**
 * `one_leader_per_area` is a unique index over (day, shift, area) where `is_leader`.
 * A write that changes somebody's column while leaving the mark on them can put two
 * leaders in one column, and Postgres refuses the whole statement — which is how a
 * supervisor dragging one card got "duplicate key value violates unique constraint
 * daily_allocations_one_leader_per_area" and nothing saved.
 *
 * On 08/08 the Day board had 68e0b058 leading Line 1 and 60ef2b63 leading Line 2.
 */
describe("place, and the leader mark", () => {
  const standing = (area_id: string | null, is_leader: boolean) => (r: Recorded) =>
    r.table === "daily_allocations" && r.op === "read"
      ? [{ status: "assigned", area_id, is_leader }]
      : [];

  async function place(input: { areaId: string | null; status?: "assigned" | "holiday" }) {
    const { result } = renderHook(() => useAllocationMutations(ON_DATE, "Night"), { wrapper: wrapper() });
    result.current.place.mutate({ employeeId: "ana", areaId: input.areaId, status: input.status ?? "assigned" });
    await waitFor(() => expect(result.current.place.isSuccess).toBe(true));
    return recorded.find((r) => r.table === "daily_allocations" && r.op === "upsert")?.payload as
      { is_leader: boolean; area_id: string | null };
  }

  it("drops the mark when the leader is moved to another column", async () => {
    answer = standing("line-1", true);
    expect((await place({ areaId: "line-2" })).is_leader).toBe(false);
  });

  it("keeps the mark when they are saved where they already stand", async () => {
    // Ticking half day or an early finish re-saves the row. It must not cost somebody
    // their line.
    answer = standing("line-1", true);
    expect((await place({ areaId: "line-1" })).is_leader).toBe(true);
  });

  it("drops the mark when the day stops being worked", async () => {
    // A holiday has no column, so it can lead none.
    answer = standing("line-1", true);
    expect((await place({ areaId: "line-1", status: "holiday" })).is_leader).toBe(false);
  });

  it("never invents a mark for somebody who had none", async () => {
    answer = standing("line-1", false);
    expect((await place({ areaId: "line-1" })).is_leader).toBe(false);
  });
});
