import { describe, expect, it } from "vitest";
import { audienceLine, requestIsForEmployee } from "@/lib/overtimeRequests";

const ask = (over: Record<string, unknown> = {}) => ({ department: null, shift_group: null, excluded_shift_groups: [] as string[], ...over });
const person = (shift_group: string | null, department: string | null = "Packing") => ({ department, shift_group });

describe("an ask that skips a crew (BLOCO 116)", () => {
  it("is not for the skipped crew, and is for everybody else", () => {
    const a = ask({ excluded_shift_groups: ["Night"] });
    expect(requestIsForEmployee(a, person("Night"))).toBe(false);
    expect(requestIsForEmployee(a, person("Day"))).toBe(true);
    expect(requestIsForEmployee(a, person("Weekend"))).toBe(true);
  });

  it("never skips a person with no crew set", () => {
    expect(requestIsForEmployee(ask({ excluded_shift_groups: ["Night"] }), person(null))).toBe(true);
  });

  it("skips several crews", () => {
    const a = ask({ excluded_shift_groups: ["Night", "Weekend"] });
    expect([person("Night"), person("Weekend"), person("Day")].map((p) => requestIsForEmployee(a, p))).toEqual([false, false, true]);
  });

  it("an ask from before the column existed (no field at all) is for everybody, as it was", () => {
    expect(requestIsForEmployee({ department: null, shift_group: null }, person("Night"))).toBe(true);
  });

  it("still honours the department and the single crew chosen", () => {
    expect(requestIsForEmployee(ask({ department: "Blending" }), person("Day"))).toBe(false);
    expect(requestIsForEmployee(ask({ shift_group: "Day" }), person("Night"))).toBe(false);
  });

  it("says so in the audience line", () => {
    expect(audienceLine(ask())).toBe("Everyone");
    expect(audienceLine(ask({ excluded_shift_groups: ["Night"] }))).toBe("Everyone, not Night crew");
    expect(audienceLine(ask({ department: "Packing", excluded_shift_groups: ["Night", "Weekend"] }))).toBe("Packing, not Night crew or Weekend crew");
  });
});
