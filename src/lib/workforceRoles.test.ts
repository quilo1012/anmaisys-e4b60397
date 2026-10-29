import { describe, expect, it } from "vitest";
import { roleStripe } from "./workforceRoles";

describe("workforce display labels", () => {
  it("distinguishes an operator from an engineer", () => {
    expect(roleStripe("operator")?.short).toBe("OP");
    expect(roleStripe("engineer")?.short).toBe("ENG");
    expect(roleStripe("operator")?.short).not.toBe(roleStripe("engineer")?.short);
  });

  it("labels the Technician Operator position as Operator", () => {
    expect(roleStripe({ position: "Technician Operator", department: "Production" })).toMatchObject({ short: "OP", label: "Operator" });
  });

  it("labels maintenance managers as Engineer", () => {
    expect(roleStripe("maintenance_manager")).toMatchObject({ short: "ENG", label: "Engineer" });
  });

  it("labels people from the engineers table as Engineer regardless of job text", () => {
    expect(roleStripe({ source: "engineers", position: "Technician" })?.short).toBe("ENG");
  });

  it("uses operator roles ahead of generic job text", () => {
    expect(roleStripe({ role: "operator", position: "Technician" })?.short).toBe("OP");
  });

  it("uses engineer roles ahead of generic job text", () => {
    expect(roleStripe({ role: "engineer", position: "Technician Operator" })?.short).toBe("ENG");
  });

  it("distinguishes maintenance departments from machine operator positions", () => {
    expect(roleStripe({ department: "Maintenance" })?.short).toBe("ENG");
    expect(roleStripe({ position: "Technician Operator", department: "Maintenance" })?.short).toBe("OP");
  });

  it.each([
    ["Supervisor", "SUP"], ["Team Leader", "LEAD"], ["Technician", "TEC"],
    ["Lab Operative", "LAB"], ["Blender", "LAB"], ["Quality", "QA"],
    ["Warehouse", "WH"], ["Office", "OFF"], ["admin", "OFF"],
    ["Maintenance Supervisor", "SUP"],
  ])("preserves the existing label for %s", (position, short) => {
    expect(roleStripe(position)?.short).toBe(short);
  });

  it("keeps unnamed production jobs unlabelled", () => {
    expect(roleStripe("Production")).toBeNull();
    expect(roleStripe(null)).toBeNull();
  });
});