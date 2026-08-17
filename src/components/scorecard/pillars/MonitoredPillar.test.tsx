import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { emptyDraft, type ScorecardEntryDraft } from "@/lib/scorecardEntry";
import { MonitoredPillar } from "./MonitoredPillar";

function Harness() {
  const [draft, setDraft] = useState<ScorecardEntryDraft>(emptyDraft("leader-1", "line-1", "2026-07-05"));
  const setField = <K extends keyof ScorecardEntryDraft>(key: K, value: ScorecardEntryDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };
  return <MonitoredPillar draft={draft} setField={setField} />;
}

describe("MonitoredPillar", () => {
  it("is visibly marked as not scoring", () => {
    render(<Harness />);
    expect(screen.getByText("Monitored — does not score")).toBeInTheDocument();
  });

  it("shows no RAG chip and no RAG colour — nothing here can be mistaken for a verdict", () => {
    const { container } = render(<Harness />);
    expect(screen.queryByText("Red")).not.toBeInTheDocument();
    expect(screen.queryByText("Amber")).not.toBeInTheDocument();
    expect(screen.queryByText("Green")).not.toBeInTheDocument();
    // No element carries the destructive/amber/success tone classes RagChip uses.
    expect(container.querySelector(".text-destructive, .text-amber-700, .text-success")).toBeNull();
  });

  it("all four fields start empty, never zero", () => {
    render(<Harness />);
    for (const input of screen.getAllByRole("spinbutton")) {
      expect((input as HTMLInputElement).value).toBe("");
    }
    expect(screen.getAllByRole("spinbutton")).toHaveLength(4);
  });
});
