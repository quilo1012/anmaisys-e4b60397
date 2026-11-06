import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultCan } from "@/lib/permissions";

/** Decided 06/11: operators do not see Smart Target yet. The admin and the office do. */
describe("Smart Target on My Production", () => {
  const page = readFileSync(resolve(__dirname, "../pages/dashboard/MyProductionPage.tsx"), "utf8");

  it("is drawn only for someone who may open the Smart Target page", () => {
    expect(page).toMatch(/\{can\(role, "smarttarget\.view"\) && \(\s*<SmartTargetBlock /);
    expect(page.match(/<SmartTargetBlock /g)).toHaveLength(1);
  });

  it("which an operator may not, and the admin and the office may", () => {
    expect(defaultCan("operator", "smarttarget.view")).toBe(false);
    expect(defaultCan("admin", "smarttarget.view")).toBe(true);
    expect(defaultCan("production_office_admin", "smarttarget.view")).toBe(true);
  });
});
