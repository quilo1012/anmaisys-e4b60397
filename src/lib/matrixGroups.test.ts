import { describe, it, expect } from "vitest";
import { groupMatrix, NO_ROTA, type MatrixEntry } from "@/lib/matrixGroups";

const person = (name: string, rota: string | null, area_id: string | null, due = true): MatrixEntry => ({
  employee_id: name.toLowerCase(),
  name,
  area_id,
  rota,
  due,
});

/** Board order, as the columns are drawn. */
const AREAS = ["line-1", "line-2", "pill"];

describe("groupMatrix", () => {
  it("gathers each crew and counts who of it is in today", () => {
    // Saturday: Fri–Mon is in, Mon–Thu is not. Both are in the matrix, because the
    // matrix is the board's whole crew and not one day of it.
    const out = groupMatrix(
      [
        person("Ana", "Fri–Mon days", "line-1"),
        person("Bruno", "Fri–Mon days", "line-2"),
        person("Carla", "Mon–Thu days", "line-1", false),
      ],
      AREAS,
    );
    expect(out.map((g) => [g.rota, g.people, g.due])).toEqual([
      ["Fri–Mon days", 2, 2],
      ["Mon–Thu days", 1, 0],
    ]);
  });

  it("puts the crews who are in today first", () => {
    // The day being planned is why the screen is open, and Mon–Thu nights is the
    // biggest crew on the board — size must not push a crew that is at home to the top.
    const out = groupMatrix(
      [
        ...Array.from({ length: 5 }, (_, i) => person(`Night${i}`, "Mon–Thu nights", "line-1", false)),
        person("Ana", "Fri–Mon days", "line-1"),
      ],
      AREAS,
    );
    expect(out[0].rota).toBe("Fri–Mon days");
  });

  it("follows the board's column order inside a crew", () => {
    const out = groupMatrix(
      [person("Ana", "Fri–Mon days", "pill"), person("Bruno", "Fri–Mon days", "line-1")],
      AREAS,
    );
    expect(out[0].areas.map((a) => a.area_id)).toEqual(["line-1", "pill"]);
  });

  it("leaves people with no column at the end rather than dropping them", () => {
    // A person in the matrix with no column is a gap somebody has to see to close.
    const out = groupMatrix(
      [person("Ana", "Fri–Mon days", null), person("Bruno", "Fri–Mon days", "line-1")],
      AREAS,
    );
    expect(out[0].areas.map((a) => a.area_id)).toEqual(["line-1", null]);
  });

  it("names an unrecorded rota instead of leaving a blank heading", () => {
    // Eleven of the night crew have no rota on file. Unknown is not off — they are
    // copied like anybody else — so the screen has to have somewhere to put them.
    const out = groupMatrix([person("Ana", null, "line-1")], AREAS);
    expect(out[0].rota).toBe(NO_ROTA);
  });

  it("sorts names inside a column", () => {
    const out = groupMatrix(
      [person("Zita", "Fri–Mon days", "line-1"), person("Ana", "Fri–Mon days", "line-1")],
      AREAS,
    );
    expect(out[0].areas[0].names).toEqual(["Ana", "Zita"]);
  });

  it("is empty for an empty matrix", () => {
    expect(groupMatrix([], AREAS)).toEqual([]);
  });
});
