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

  it("shows the CAPA status options in English, never the database's raw Portuguese enum", () => {
    render(<Harness verdict={{ quality_fail_type: "Fail" }} />);
    const status = screen.getByLabelText("CAPA status") as HTMLSelectElement;
    const optionText = Array.from(status.options).map((o) => o.textContent);

    expect(optionText).toEqual(["—", "Open", "In Progress", "Completed", "Verified"]);
    expect(screen.queryByText("Aberta")).not.toBeInTheDocument();
    expect(screen.queryByText("Em Andamento")).not.toBeInTheDocument();
    expect(screen.queryByText("Concluida")).not.toBeInTheDocument();
    expect(screen.queryByText("Verificada")).not.toBeInTheDocument();

    // The underlying VALUE selecting an option writes is still the database's
    // raw enum — DATA, not translated — only the visible label changed.
    fireEvent.change(status, { target: { value: "Em Andamento" } });
    expect(status.value).toBe("Em Andamento");
  });
});
