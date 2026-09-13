import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    // Sete contadores inteiros (spinbutton) e duas fraccoes. As fraccoes sao caixas de
    // texto com teclado decimal porque um `type="number"` nao deixa passar o "0." — sem
    // isso os dois campos sao impossiveis de preencher. Ver `NumericField`.
    const fields = [...screen.getAllByRole("spinbutton"), ...screen.getAllByRole("textbox")];
    for (const input of fields) {
      expect((input as HTMLInputElement).value).toBe("");
    }
    expect(screen.getAllByRole("spinbutton")).toHaveLength(7);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
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

  it("asks for the four percentages as the fractions the column actually holds", () => {
    render(<Harness />);
    // numeric(5,4) CHECK BETWEEN 0 AND 1, judged against fraction thresholds.
    // A box labelled "%" invites 95 and the database refuses the whole row.
    for (const label of ["PPE compliance (0\u20131)", "H&S training compliance (0\u20131)"]) {
      const input = screen.getByLabelText(label);
      // O intervalo ja nao vive em `min`/`max` nativos: estes campos sao de texto, para
      // que o "0." sobreviva ao ser teclado. Quem o diz e a etiqueta, e um valor fora
      // do intervalo e marcado em vez de ser recusado em silencio pelo browser.
      expect(input).toHaveAttribute("inputmode", "decimal");
      expect(input).not.toHaveAttribute("aria-invalid");
      fireEvent.change(input, { target: { value: "95" } });
      expect(input).toHaveAttribute("aria-invalid", "true");
      fireEvent.change(input, { target: { value: "0.95" } });
      expect(input).not.toHaveAttribute("aria-invalid");
    }
    expect(screen.queryByLabelText("PPE compliance %")).not.toBeInTheDocument();
  });

  it("deixa escrever uma fraccao ate ao fim, em vez de comer o ponto decimal", () => {
    render(<Harness />);
    const ppe = screen.getByLabelText("PPE compliance (0\u20131)") as HTMLInputElement;

    // Como uma pessoa escreve mesmo: digito, ponto, digitos. O estado intermedio "0."
    // costumava voltar a "0" — e o campo ficava impossivel de preencher.
    fireEvent.change(ppe, { target: { value: "0" } });
    fireEvent.change(ppe, { target: { value: "0." } });
    expect(ppe.value).toBe("0.");
    fireEvent.change(ppe, { target: { value: "0.9" } });
    fireEvent.change(ppe, { target: { value: "0.95" } });
    expect(ppe.value).toBe("0.95");
  });

  it("esvaziar o campo continua a escrever null, e nao um zero", () => {
    render(<Harness />);
    const ppe = screen.getByLabelText("PPE compliance (0\u20131)") as HTMLInputElement;
    fireEvent.change(ppe, { target: { value: "0.95" } });
    fireEvent.change(ppe, { target: { value: "" } });
    expect(ppe.value).toBe("");
  });

  it("bounds the counters at zero, as every CHECK on them does", () => {
    render(<Harness />);
    for (const label of ["Lost time injuries", "Reportable accidents", "First aid cases",
      "Near misses reported", "Safety observations done", "Toolbox talks done", "Overdue H&S actions"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("min", "0");
    }
  });
});
