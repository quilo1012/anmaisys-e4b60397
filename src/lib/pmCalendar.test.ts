import { describe, expect, it } from "vitest";
import { buildMonthGrid, type PmCalendarSchedule } from "./pmCalendar";

/** So o que a grelha le, mais um id para as asseroes lhe pegarem. */
interface Plano extends PmCalendarSchedule { id: string }

const pm = (id: string, next_due_at: string | null, active = true): Plano =>
  ({ id, next_due_at, active });

/** Meio-dia local, para que nenhuma conversao de fuso empurre o dia para o lado. */
const dia = (iso: string) => new Date(`${iso}T12:00:00`);

describe("buildMonthGrid", () => {
  it("devolve semanas inteiras de segunda a domingo", () => {
    const { weeks } = buildMonthGrid(dia("2026-09-15"), [], dia("2026-09-15"));
    for (const semana of weeks) expect(semana).toHaveLength(7);
    expect(weeks[0][0].date.getDay()).toBe(1); // segunda
    expect(weeks[weeks.length - 1][6].date.getDay()).toBe(0); // domingo
  });

  it("comeca no dia que cobre o primeiro do mes", () => {
    // 1 de Setembro de 2026 e uma terca — a grelha abre na segunda, 31 de Agosto.
    const { weeks } = buildMonthGrid(dia("2026-09-15"), [], dia("2026-09-15"));
    expect(weeks[0][0].date.getMonth()).toBe(7); // Agosto
    expect(weeks[0][0].date.getDate()).toBe(31);
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][1].inMonth).toBe(true);
  });

  it("poe cada plano no dia em que vence", () => {
    const { weeks } = buildMonthGrid(
      dia("2026-09-15"),
      [pm("a", "2026-09-10T08:00:00Z"), pm("b", "2026-09-10T16:00:00Z"), pm("c", "2026-09-11T08:00:00Z")],
      dia("2026-09-15"),
    );
    const dias = weeks.flat();
    expect(dias.find((d) => d.date.getDate() === 10 && d.inMonth)!.items.map((s) => s.id))
      .toEqual(["a", "b"]);
    expect(dias.find((d) => d.date.getDate() === 11 && d.inMonth)!.items.map((s) => s.id))
      .toEqual(["c"]);
  });

  it("marca hoje uma vez so", () => {
    const { weeks } = buildMonthGrid(dia("2026-09-15"), [], dia("2026-09-15"));
    const hoje = weeks.flat().filter((d) => d.isToday);
    expect(hoje).toHaveLength(1);
    expect(hoje[0].date.getDate()).toBe(15);
  });

  it("ignora um plano sem data de vencimento", () => {
    const { weeks } = buildMonthGrid(dia("2026-09-15"), [pm("a", null)], dia("2026-09-15"));
    expect(weeks.flat().flatMap((d) => d.items)).toHaveLength(0);
  });

  it("ignora um plano desligado", () => {
    // Um plano inactivo nao vai acontecer; no calendario seria trabalho a fingir.
    const { weeks } = buildMonthGrid(
      dia("2026-09-15"),
      [pm("a", "2026-09-10T08:00:00Z", false)],
      dia("2026-09-15"),
    );
    expect(weeks.flat().flatMap((d) => d.items)).toHaveLength(0);
  });

  it("mostra os dias do mes vizinho que a grelha arrasta, com o que lhes cai", () => {
    const { weeks } = buildMonthGrid(
      dia("2026-09-15"),
      [pm("a", "2026-08-31T08:00:00Z")],
      dia("2026-09-15"),
    );
    const arrastado = weeks[0][0];
    expect(arrastado.inMonth).toBe(false);
    expect(arrastado.items.map((s) => s.id)).toEqual(["a"]);
  });

  it("conta a parte os vencidos que ficaram para tras da grelha", () => {
    // Um plano de Junho por fazer nao aparece na grelha de Setembro, e e o mais
    // urgente que ha. Sem esta lista, desaparecia do ecra por ser antigo demais.
    const { overdueBefore } = buildMonthGrid(
      dia("2026-09-15"),
      [pm("junho", "2026-06-02T08:00:00Z"), pm("setembro", "2026-09-10T08:00:00Z")],
      dia("2026-09-15"),
    );
    expect(overdueBefore.map((s) => s.id)).toEqual(["junho"]);
  });

  it("nao chama vencido a um plano futuro que a grelha ainda nao alcanca", () => {
    const { overdueBefore } = buildMonthGrid(
      dia("2026-09-15"),
      [pm("dezembro", "2026-12-02T08:00:00Z")],
      dia("2026-09-15"),
    );
    expect(overdueBefore).toHaveLength(0);
  });

  it("ordena os vencidos antigos do mais atrasado para o menos", () => {
    const { overdueBefore } = buildMonthGrid(
      dia("2026-09-15"),
      [pm("julho", "2026-07-02T08:00:00Z"), pm("junho", "2026-06-02T08:00:00Z")],
      dia("2026-09-15"),
    );
    expect(overdueBefore.map((s) => s.id)).toEqual(["junho", "julho"]);
  });
});
