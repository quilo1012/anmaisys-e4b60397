import { describe, it, expect } from "vitest";
import { parseQualityImport, parseSheetDate, severityFromLabel } from "@/lib/qualityImport";

const leaders = [{ id: "id-a", name: "Ailton" }, { id: "id-m", name: "MARCIO" }];
const row = (over: Record<string, unknown> = {}) => ({
  Date: "22/07/2026", "Action #": "AC-1", Validation: "Open", Severity: "High", Line: "Line 4", Shift: "DAY",
  Leader: "Marcio", Department: "Quality", SKU: "ABEBR500", Product: "ignored", Batch: "B4",
  Labels: "CCP; Foreign Body", Notes: "plastic", ...over,
});

describe("parseQualityImport", () => {
  it("rebuilds the form payload from an exported row, leader matched by folded name", () => {
    const r = parseQualityImport([row()], leaders);
    expect(r.valid).toBe(1);
    const p = r.rows[0].payload!;
    expect(p.leader_id).toBe("id-m");
    expect(p.leader_name).toBe("MARCIO");
    expect(p.severity).toBe("high");
    expect(p.labels).toEqual(["CCP", "Foreign Body"]);
    expect(p.sku).toBe("ABEBR500");
    expect(p.domain).toBe("quality");
    expect(p.safety_kind).toBeNull();
    expect("status" in p).toBe(false);
    expect("validation_status" in p).toBe(false);
  });

  it("never imports a Validation verdict — warns and lets the DB default apply", () => {
    const r = parseQualityImport([row({ Validation: "Validated" })], leaders);
    expect(r.valid).toBe(1);
    expect("validation_status" in r.rows[0].payload!).toBe(false);
    expect(r.rows[0].warnings[0]).toBe('Validation "Validated" ignored — Quality rules on this in the app');
    // blank / Open / Awaiting verdict stay silent
    const quiet = parseQualityImport([row({ Validation: "" }), row({ Validation: "Open" }), row({ Validation: "Awaiting verdict" })], leaders);
    expect(quiet.rows.every((x) => x.warnings.length === 0)).toBe(true);
  });

  it("rejects an unknown severity and an unreadable date instead of guessing", () => {
    const r = parseQualityImport([row({ Severity: "Huge" }), row({ Date: "31/02/2026" })], leaders);
    expect(r.rejected).toBe(2);
    expect(r.rows[0].errors[0]).toMatch(/severity/i);
    expect(r.rows[1].errors[0]).toMatch(/date/i);
  });

  it("keeps an unmatched leader by name only, as a warning", () => {
    const r = parseQualityImport([row({ Leader: "Nobody" })], leaders);
    expect(r.valid).toBe(1);
    expect(r.rows[0].payload!.leader_id).toBeNull();
    expect(r.rows[0].warnings[0]).toMatch(/leader/i);
  });

  it("skips blank trailing rows and refuses a bad domain", () => {
    const r = parseQualityImport([row(), { Date: "", Line: "", Notes: "" }, row({ Domain: "hr" })], leaders);
    expect(r.rows.length).toBe(2);
    expect(r.rows[1].errors[0]).toMatch(/domain/i);
  });

  it("helpers", () => {
    expect(severityFromLabel("Critical").value).toBe("critical");
    expect(severityFromLabel("").value).toBeNull();
    expect(parseSheetDate("01/09/2026")!.slice(0, 7)).toBe("2026-09");
    expect(parseSheetDate("nonsense")).toBeNull();
  });
});
