/**
 * O calendario, do lado de quem clica.
 *
 * A aritmetica das datas esta testada a parte, em src/lib/pmCalendar.test.ts. O que
 * tem de valer aqui e o gesto: clicar num dia vazio comeca um plano nessa data, e
 * quem nao tem `pm.manage` nao consegue comecar nenhum — a porta fecha-se no clique,
 * antes do formulario, e nao num erro de RLS depois de ele estar preenchido.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PmCalendarMonth } from "./PmCalendarMonth";
import type { PmSchedule } from "@/hooks/usePreventiveMaintenance";

const pm = (over: Partial<PmSchedule>): PmSchedule => ({
  id: "s1", machine: "Blender 3", title: "Quarterly inspection", description: null,
  interval_days: 90, last_done_at: null, next_due_at: "2026-09-10T12:00:00Z",
  active: true, assigned_engineer_id: null, priority: "medium",
  created_by: null, created_at: "", updated_at: "", ...over,
});

/** O componente ancora no mes de hoje, por isso o relogio tem de ser fixo. */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T09:00:00"));
});
afterEach(() => vi.useRealTimers());

function montar(over: Partial<Parameters<typeof PmCalendarMonth>[0]> = {}) {
  const onPickDay = vi.fn();
  const onPickSchedule = vi.fn();
  render(
    <PmCalendarMonth
      schedules={[pm({})]}
      canManage
      onPickDay={onPickDay}
      onPickSchedule={onPickSchedule}
      {...over}
    />,
  );
  return { onPickDay, onPickSchedule };
}

/** A celula do dia 10 de Setembro (a que nao vem arrastada de outro mes). */
const celulaDoDia = (n: string) =>
  screen.getAllByText(n).map((el) => el.closest("div.group")).find(Boolean) as HTMLElement;

describe("PmCalendarMonth", () => {
  it("abre no mes de hoje", () => {
    montar();
    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });

  it("mostra o plano no dia em que vence", () => {
    montar();
    expect(within(celulaDoDia("10")).getByText(/Quarterly inspection/)).toBeInTheDocument();
  });

  it("comeca um plano no dia clicado", () => {
    const { onPickDay } = montar();
    fireEvent.click(celulaDoDia("17"));
    expect(onPickDay).toHaveBeenCalledTimes(1);
    const d: Date = onPickDay.mock.calls[0][0];
    expect(d.getDate()).toBe(17);
    expect(d.getMonth()).toBe(8);
  });

  it("nao deixa comecar um plano a quem nao pode gravar", () => {
    const { onPickDay } = montar({ canManage: false });
    fireEvent.click(celulaDoDia("17"));
    expect(onPickDay).not.toHaveBeenCalled();
  });

  it("abre o plano clicado sem comecar um novo por baixo", () => {
    // A etiqueta esta dentro da celula: sem parar a propagacao, um clique valia dois.
    const { onPickDay, onPickSchedule } = montar();
    fireEvent.click(screen.getByText(/Quarterly inspection/));
    expect(onPickSchedule).toHaveBeenCalledTimes(1);
    expect(onPickDay).not.toHaveBeenCalled();
  });

  it("conta os vencidos antigos que nao cabem na grelha", () => {
    montar({ schedules: [pm({ id: "velho", next_due_at: "2026-06-02T12:00:00Z", title: "Belt change" })] });
    expect(screen.getByText("1 overdue before this month")).toBeInTheDocument();
  });

  it("nao perde de vista um plano que a mudanca de mes deixou para tras", () => {
    // Avancar para Outubro tira o plano de 10 de Setembro da grelha. Se saisse do
    // ecra, o unico plano em atraso desaparecia por se ter carregado numa seta.
    montar();
    expect(within(celulaDoDia("10")).getByText(/Quarterly inspection/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Next month"));
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(screen.getByText("1 overdue before this month")).toBeInTheDocument();
  });
});
