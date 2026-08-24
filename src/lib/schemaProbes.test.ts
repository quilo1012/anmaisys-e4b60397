import { describe, it, expect } from "vitest";
import { probedColumn, isProbedColumn } from "@/lib/schemaProbes";

describe("reading which column a 42703 is about", () => {
  it("names the column", () => {
    expect(probedColumn('column quality_options.is_gate does not exist')).toBe(
      "quality_options.is_gate",
    );
  });

  it("survives the quoted form", () => {
    expect(probedColumn('column "quality_options"."is_gate" does not exist')).toBe(
      "quality_options.is_gate",
    );
  });

  it("is null when the message is about something else", () => {
    expect(probedColumn("permission denied for table quality_options")).toBeNull();
    expect(probedColumn(undefined)).toBeNull();
  });
});

describe("which absences the code already handles", () => {
  it("knows the gate column is probed — 20260824090000", () => {
    expect(isProbedColumn("column quality_options.is_gate does not exist")).toBe(true);
  });

  it("knows the other two rungs of the same ladder", () => {
    expect(isProbedColumn("column quality_options.points does not exist")).toBe(true);
    expect(isProbedColumn("column quality_options.counts_against_leader does not exist")).toBe(true);
  });

  it("leaves an undeclared column a fault — the safe direction", () => {
    // Nothing falls back for this one, so its absence has to stay loud.
    expect(isProbedColumn("column quality_actions.scoring_version_id does not exist")).toBe(false);
  });
});
