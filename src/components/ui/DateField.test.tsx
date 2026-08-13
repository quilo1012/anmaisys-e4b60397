import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DateField } from "./DateField";

/**
 * O campo de data, lido como o resto do sistema o escreve.
 *
 * O `<input type="date"/>` nativo imprime a data na LOCALE DO BROWSER, que a app não
 * escolhe: numa fábrica inglesa, com o Chrome em en-US, a placa de comando dizia
 * "08/13/2026" a dois centímetros de um cabeçalho que dizia "13 Aug 2026". Não é uma
 * questão de estilo — são duas datas escritas de duas maneiras no mesmo ecrã, e uma
 * delas com o dia e o mês trocados. É esse o comportamento que estes testes fixam.
 */
describe("DateField", () => {
  it("escreve a data como o resto do sistema a escreve, e não na locale do browser", () => {
    render(<DateField value="2026-08-13" onChange={() => {}} aria-label="Date" />);
    expect(screen.getByLabelText("Date")).toHaveTextContent("13 Aug 2026");
    expect(screen.getByLabelText("Date")).not.toHaveTextContent("08/13/2026");
  });

  it("devolve a data em yyyy-MM-dd, que é o que a base guarda", async () => {
    const onChange = vi.fn();
    render(<DateField value="2026-08-13" onChange={onChange} aria-label="Date" />);

    fireEvent.click(screen.getByLabelText("Date"));
    const grid = await screen.findByRole("grid");
    fireEvent.click(within(grid).getByRole("gridcell", { name: "20" }));

    expect(onChange).toHaveBeenCalledWith("2026-08-20");
  });

  it("um dia anterior ao mínimo não se pode escolher", async () => {
    const onChange = vi.fn();
    render(<DateField value="2026-08-13" min="2026-08-10" onChange={onChange} aria-label="To" />);

    fireEvent.click(screen.getByLabelText("To"));
    const grid = await screen.findByRole("grid");
    // 8, e não 3: a grelha de Agosto de 2026 mostra os dias que sobram de Setembro,
    // e "3" está lá duas vezes. O 8 só existe uma.
    fireEvent.click(within(grid).getByRole("gridcell", { name: "8" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("um valor vazio não inventa uma data", () => {
    render(<DateField value="" onChange={() => {}} aria-label="Date" />);
    expect(screen.getByLabelText("Date")).toHaveTextContent("—");
  });
});
