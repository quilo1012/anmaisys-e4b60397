import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { emptyDraft, type ScorecardEntryDraft } from "@/lib/scorecardEntry";
import { CapaBlock } from "./CapaBlock";

function Harness({ verdict }: { verdict: { quality_fail_type: string | null } | null }) {
  const [draft, setDraft] = useState<ScorecardEntryDraft>(emptyDraft("leader-1", "line-1", "2026-07-05"));
  const setField = <K extends keyof ScorecardEntryDraft>(key: K, value: ScorecardEntryDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };
  return <CapaBlock draft={draft} setField={setField} verdict={verdict} />;
}

describe("CapaBlock", () => {
  it("does not render when there is no verdict yet", () => {
    const { container } = render(<Harness verdict={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render for a Not Done — that is a discipline failure, not a product deviation", () => {
    const { container } = render(<Harness verdict={{ quality_fail_type: "Not Done" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render for a Pass", () => {
    const { container } = render(<Harness verdict={{ quality_fail_type: "Pass" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the four CAPA fields for a Fail", () => {
    render(<Harness verdict={{ quality_fail_type: "Fail" }} />);
    expect(screen.getByLabelText("Root cause")).toBeInTheDocument();
    expect(screen.getByLabelText("Corrective action")).toBeInTheDocument();
    expect(screen.getByLabelText("CAPA owner")).toBeInTheDocument();
    expect(screen.getByLabelText("CAPA due date")).toBeInTheDocument();
  });

  it("writes what is typed through setField, exactly like the other pillars", () => {
    render(<Harness verdict={{ quality_fail_type: "Fail" }} />);
    const rootCause = screen.getByLabelText("Root cause") as HTMLTextAreaElement;
    fireEvent.change(rootCause, { target: { value: "Mixer overfilled" } });
    expect(rootCause.value).toBe("Mixer overfilled");

    const owner = screen.getByLabelText("CAPA owner") as HTMLInputElement;
    fireEvent.change(owner, { target: { value: "M. Silva" } });
    expect(owner.value).toBe("M. Silva");

    const due = screen.getByLabelText("CAPA due date") as HTMLInputElement;
    fireEvent.change(due, { target: { value: "2026-07-31" } });
    expect(due.value).toBe("2026-07-31");
  });
});
