import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { emptyDraft, type ScorecardEntryDraft } from "@/lib/scorecardEntry";
import { HealthSafetyPillar } from "./HealthSafetyPillar";

function Harness({ verdict = null }: { verdict?: { hs_driver: string[] | null } | null }) {
  const [draft, setDraft] = useState<ScorecardEntryDraft>(emptyDraft("leader-1", "line-1", "2026-07-05"));
  const setField = <K extends keyof ScorecardEntryDraft>(key: K, value: ScorecardEntryDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };
  return <HealthSafetyPillar draft={draft} setField={setField} verdict={verdict} />;
}

describe("HealthSafetyPillar", () => {
  it("every one of the nine fields starts empty, never zero", () => {
    render(<Harness />);
    for (const input of screen.getAllByRole("spinbutton")) {
      expect((input as HTMLInputElement).value).toBe("");
    }
    expect(screen.getAllByRole("spinbutton")).toHaveLength(9);
  });

  it("carries the under-reporting caption next to near misses, and only there", () => {
    render(<Harness />);
    const caption = screen.getByText(/zero reported reads as under-reporting/i);
    expect(caption).toBeInTheDocument();
    // Confirm it sits with the near-misses field, not the first-aid one.
    const nearMissesGroup = screen.getByLabelText("Near misses reported").closest("div");
    expect(nearMissesGroup).toContainElement(caption);
  });

  it("keeps first_aid_cases and near_misses_reported in separate groups, not adjacent", () => {
    render(<Harness />);
    const firstAidField = screen.getByLabelText("First aid cases").closest("div");
    const nearMissField = screen.getByLabelText("Near misses reported").closest("div");
    // Different immediate parent group (different <div className="grid ...">).
    expect(firstAidField?.parentElement).not.toBe(nearMissField?.parentElement);
  });

  it("lists every hs_driver condition the server sent, verbatim", () => {
    render(<Harness verdict={{ hs_driver: ["Lost time injury this week", "Two reportable accidents"] }} />);
    expect(screen.getByText("Lost time injury this week")).toBeInTheDocument();
    expect(screen.getByText("Two reportable accidents")).toBeInTheDocument();
  });

  it("shows nothing when the server sent no drivers", () => {
    render(<Harness verdict={{ hs_driver: [] }} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
