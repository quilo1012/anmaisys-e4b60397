/**
 * O separador Board marks, quando sai em papel.
 *
 * O período desta tabela é dela: abre no mês de calendário e tem os seus próprios
 * seletores de data, que não são os da folha de horas ao lado. Em papel os seletores
 * desaparecem (`no-print`) e a tabela ficava sem data nenhuma — por baixo de uma banda
 * que anunciava o período do TimeMoto, que é outro. Um mapa de presenças que diz o
 * período errado é pior do que um que não diz nenhum.
 *
 * A linha do `<thead>` é a única coisa que um browser repete em cada página, por isso é
 * lá que a data tem de estar. O resto — o que essas classes fazem ao papel — vive no
 * `@media print` do index.css.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MonthlySummary } from "@/components/workforce/MonthlySummary";

const EMPLOYEES = [
  { id: "e1", full_name: "Ana Silva", department: "Production", active: true },
] as never[];

vi.mock("@/hooks/useWorkforce", () => ({
  useEmployees: () => ({ data: [] }),
  useOvertimePeriods: () => ({ data: [] }),
  useAttendanceRange: () => ({
    data: [{ employee_id: "e1", on_date: "2026-09-02", status: "present" }],
    isLoading: false,
  }),
}));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MonthlySummary employees={EMPLOYEES} />
    </QueryClientProvider>,
  );
}

describe("a folha do Board marks", () => {
  it("leva o seu próprio período numa linha que se repete em cada página", () => {
    const { container } = renderIt();

    const caption = screen.getByText(/^Board marks · \d{2}\/\d{2}\/\d{4} → \d{2}\/\d{2}\/\d{4}$/);
    expect(caption.closest("thead")).not.toBeNull();
    expect(caption.closest("tr")).toHaveClass("print-caption-row");
    // E é a data desta tabela, não a da banda: abre no mês de calendário.
    const now = new Date();
    const mes = String(now.getMonth() + 1).padStart(2, "0");
    expect(caption.textContent).toContain(`01/${mes}/${now.getFullYear()}`);

    // A margem de baixo de cada página, pelo mesmo mecanismo.
    expect(container.querySelector("tfoot.print-edge")).not.toBeNull();
  });

  it("não prende a tabela a uma página só", () => {
    const { container } = renderIt();
    // `break-inside: avoid` num cartão mais alto do que a folha empurra o cartão
    // inteiro para a página seguinte e deixa a primeira em branco.
    expect(container.querySelector(".break-inside-avoid")).toBeNull();
  });
});
