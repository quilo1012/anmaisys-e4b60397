import { describe, it, expect } from "vitest";
import { planMatrixDelete, type MatrixSavePerson } from "@/lib/matrixSave";

// The changeover matrix used to be replaced wholesale by one day's board, so a Friday
// save erased the Mon–Thu crew and a Monday save erased Tue–Fri. Simulates both saves
// against an in-memory matrix.
const p = (id: string, shift_group: string, active = true): MatrixSavePerson =>
  ({ id, active, shift_group, shift_pattern_id: null });

const people = [
  p("mt1", "Mon-Thu"), p("mt2", "Mon-Thu"),
  p("fm1", "Fri-Mon"), p("fm2", "Fri-Mon"),
  p("tf1", "Tue-Fri"), p("tf2", "Tue-Fri"),
  p("gone", "Mon-Thu", false),
];

function save(matrix: Set<string>, onDate: string, board: string[]) {
  const toDelete = planMatrixDelete({ onDate, boardEmployeeIds: board, existingMatrixIds: [...matrix], people, history: [] });
  board.forEach((id) => matrix.add(id));
  toDelete.forEach((id) => matrix.delete(id));
  return toDelete;
}

describe("saving the changeover matrix", () => {
  it("Monday then Friday keeps all three crews", () => {
    const m = new Set<string>();
    save(m, "2026-09-28", ["mt1", "mt2", "fm1", "fm2"]);
    expect(save(m, "2026-10-02", ["tf1", "tf2", "fm1", "fm2"])).toEqual([]);
    expect([...m].sort()).toEqual(["fm1", "fm2", "mt1", "mt2", "tf1", "tf2"]);
  });

  it("Friday then Monday keeps all three crews too", () => {
    const m = new Set<string>();
    save(m, "2026-10-02", ["tf1", "tf2", "fm1", "fm2"]);
    expect(save(m, "2026-09-28", ["mt1", "mt2", "fm1", "fm2"])).toEqual([]);
    expect(m.size).toBe(6);
  });

  it("drops someone of a saved crew who was not on the board", () => {
    const m = new Set(["mt1", "mt2", "fm1", "fm2", "tf1"]);
    expect(save(m, "2026-09-28", ["mt1", "fm1", "fm2"])).toEqual(["mt2"]);
  });

  it("drops people who are no longer active employees, whatever their crew", () => {
    const m = new Set(["gone", "unknown-id", "tf1"]);
    expect(save(m, "2026-10-02", ["fm1"]).sort()).toEqual(["gone", "unknown-id"]);
  });

  it("uses the crew held on that date, not today's", () => {
    // tf1 was on Mon-Thu on 28/09 and moved later: a Monday save without them removes them.
    const toDelete = planMatrixDelete({
      onDate: "2026-09-28", boardEmployeeIds: ["mt1"], existingMatrixIds: ["tf1"], people,
      history: [{ employee_id: "tf1", shift_group: "Mon-Thu", shift_pattern_id: null, effective_from: "2026-09-01", note: null } as any],
    });
    expect(toDelete).toEqual(["tf1"]);
  });
});
