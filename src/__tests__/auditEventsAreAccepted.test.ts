import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { REPORT_AUDIT_ACTION } from "@/hooks/useMaintenanceReportHistory";

const fn = readFileSync("supabase/functions/log-audit-event/index.ts", "utf8");
const list = (name: string) =>
  [...(fn.split(`const ${name} = [`)[1].split("] as const")[0].matchAll(/"([^"]+)"/g))].map((m) => m[1]);

describe("log-audit-event accepts what the engineer's report sends", () => {
  it("allows the maintenance report action", () => {
    expect(list("ALLOWED_ACTIONS")).toContain(REPORT_AUDIT_ACTION);
  });
  it("allows the maintenance_report entity type", () => {
    expect(list("ALLOWED_ENTITY_TYPES")).toContain("maintenance_report");
  });
  it("returns a readable message for a refused body", () => {
    expect(fn).toMatch(/error: "invalid_body", message/);
  });
});
