import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { emptyDraft, type ScorecardEntryDraft } from "@/lib/scorecardEntry";
import { QualityPillar } from "./QualityPillar";

function Harness({ verdict = null }: { verdict?: { quality_fail_type: string | null } | null }) {
  const [draft, setDraft] = useState<ScorecardEntryDraft>(emptyDraft("leader-1", "line-1", "2026-07-05"));
  const setField = <K extends keyof ScorecardEntryDraft>(key: K, value: ScorecardEntryDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };
  return <QualityPillar draft={draft} setField={setField} verdict={verdict} />;
}

describe("QualityPillar", () => {
  it("starts with none of the three options selected — an unrecorded check is not a pass", () => {
    render(<Harness />);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
  });

  it("can express all three states for a single check", () => {
    render(<Harness />);
    const pass = document.getElementById("ccp_check_status-Pass") as HTMLElement;
    const fail = document.getElementById("ccp_check_status-Fail") as HTMLElement;
    const notDone = document.getElementById("ccp_check_status-Not Done") as HTMLElement;

    fireEvent.click(pass);
    expect(pass).toBeChecked();

    fireEvent.click(fail);
    expect(fail).toBeChecked();
    expect(pass).not.toBeChecked();

    fireEvent.click(notDone);
    expect(notDone).toBeChecked();
    expect(fail).not.toBeChecked();
  });

  it("shows the Fail sentence only when the server says Fail, never decided locally", () => {
    render(<Harness verdict={{ quality_fail_type: "Fail" }} />);
    expect(screen.getByText("Fail — a CAPA is required")).toBeInTheDocument();
    expect(screen.queryByText(/no product deviation/i)).not.toBeInTheDocument();
  });

  it("shows the Not Done sentence, which is a different fact from Fail", () => {
    render(<Harness verdict={{ quality_fail_type: "Not Done" }} />);
    expect(screen.getByText(/no product deviation to investigate/i)).toBeInTheDocument();
    expect(screen.queryByText(/a capa is required/i)).not.toBeInTheDocument();
  });

  it("shows neither sentence when the server has not flagged anything", () => {
    render(<Harness verdict={{ quality_fail_type: null }} />);
    expect(screen.queryByText(/capa is required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no product deviation/i)).not.toBeInTheDocument();
  });
});
