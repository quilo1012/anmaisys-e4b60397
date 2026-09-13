import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    // Duas fraccoes (caixa de texto, teclado decimal) e dois contadores inteiros.
    for (const input of [...screen.getAllByRole("spinbutton"), ...screen.getAllByRole("textbox")]) {
      expect((input as HTMLInputElement).value).toBe("");
    }
    expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  it("asks for attendance as a fraction, the same way Health & Safety does", () => {
    render(<Harness />);
    for (const label of ["Leader attendance (0\u20131)", "Team attendance (0\u20131)"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("inputmode", "decimal");
      fireEvent.change(input, { target: { value: "0.95" } });
      expect((input as HTMLInputElement).value).toBe("0.95");
      expect(input).not.toHaveAttribute("aria-invalid");
    }
    expect(screen.queryByLabelText("Leader attendance %")).not.toBeInTheDocument();
  });

  it("bounds the lateness counters at zero and leaves them whole", () => {
    render(<Harness />);
    for (const label of ["Leader lateness incidents", "Team lateness incidents"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("min", "0");
      expect(input).toHaveAttribute("step", "1");
      expect(input).not.toHaveAttribute("max");
    }
  });
});
