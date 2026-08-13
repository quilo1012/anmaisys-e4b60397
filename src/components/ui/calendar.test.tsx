import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Calendar } from "./calendar";

/**
 * A semana começa à segunda, como começa em todo o resto do sistema.
 *
 * O `react-day-picker` abre a semana ao domingo, e o `Calendar` não dizia nada — por
 * isso cada ecrã tinha de se lembrar de a corrigir. A RAG Weekly lembrou-se e passa
 * `weekStartsOn={1}`; o `DateRangeFilter` não, e o mesmo sistema que calcula "esta
 * semana" de segunda a domingo (`startOfWeek(d, { weekStartsOn: 1 })`, em seis sítios)
 * desenhava-a a começar num dia em que a fábrica não abre a semana.
 *
 * Não é uma preferência de estilo: quem escolhe "a semana de 10 Aug" num calendário que
 * põe 9 Aug na mesma linha está a escolher um período que o relatório vai recortar de
 * outra maneira.
 */
describe("Calendar", () => {
  it("abre a semana à segunda-feira", () => {
    render(<Calendar mode="single" defaultMonth={new Date(2026, 7, 1)} />);
    const heads = screen.getAllByRole("columnheader");
    expect(heads[0]).toHaveTextContent("Mo");
    expect(heads[6]).toHaveTextContent("Su");
  });

  it("um ecrã que precise de outro dia continua a poder pedi-lo", () => {
    render(<Calendar mode="single" weekStartsOn={0} defaultMonth={new Date(2026, 7, 1)} />);
    expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent("Su");
  });
});
