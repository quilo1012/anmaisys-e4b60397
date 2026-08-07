import { describe, it, expect } from "vitest";
import {
  DEPARTMENTS, POSITIONS, normaliseDepartment, normalisePosition, normalisePerson,
} from "@/lib/orgNames";

describe("normaliseDepartment", () => {
  it("keeps the seven the headcount areas already use", () => {
    for (const d of DEPARTMENTS) expect(normaliseDepartment(d)).toBe(d);
  });

  it("folds the spellings that were on file", () => {
    expect(normaliseDepartment("Office Admin")).toBe("Office");
    expect(normaliseDepartment("Blender Room")).toBe("Production");
    expect(normaliseDepartment("Lab / Blender Room")).toBe("Lab");
    expect(normaliseDepartment("Warehouse Operative")).toBe("Warehouse");
  });

  it("ignores case and stray spacing", () => {
    expect(normaliseDepartment("  production ")).toBe("Production");
    expect(normaliseDepartment("WH  Team")).toBe("Warehouse");
  });

  it("returns null for a job title, which is not a department", () => {
    // Twenty people had "Team Leader" as their department, so they had no department
    // at all while appearing to have one.
    expect(normaliseDepartment("Team Leader")).toBeNull();
    expect(normaliseDepartment("Supervisor")).toBeNull();
  });

  it("returns null rather than inventing one", () => {
    for (const v of ["", "   ", "Something else", null, undefined]) {
      expect(normaliseDepartment(v)).toBeNull();
    }
  });
});

describe("normalisePosition", () => {
  it("keeps the known jobs", () => {
    for (const p of POSITIONS) expect(normalisePosition(p)).toBe(p);
  });

  it("fixes the typo that outnumbered the correct spelling", () => {
    // 22 rows said "Prodcution Operative" against 4 spelled properly, so grouping by
    // position counted them as two different jobs.
    expect(normalisePosition("Prodcution Operative")).toBe("Production Operative");
    expect(normalisePosition("Prodcution")).toBe("Production Operative");
    expect(normalisePosition("Labe Operative")).toBe("Lab Operative");
  });
});

describe("normalisePerson", () => {
  it("reads the job out of the department box", () => {
    expect(normalisePerson("Team Leader", null)).toEqual({
      department: null, position: "Team Leader",
    });
  });

  it("reads the department out of the job box", () => {
    expect(normalisePerson(null, "Warehouse")).toEqual({
      department: "Warehouse", position: "Warehouse Operative",
    });
  });

  it("lets an explicit department beat one implied by the job", () => {
    // Somebody recorded as Production who is a Lab Operative was put in Production on
    // purpose. This is not the place to overrule it.
    expect(normalisePerson("Production", "Lab Operative")).toEqual({
      department: "Production", position: "Lab Operative",
    });
  });

  it("leaves both null when neither field says anything usable", () => {
    expect(normalisePerson("", "  ")).toEqual({ department: null, position: null });
  });
});
