import { describe, it, expect } from "vitest";
import { format } from "date-fns";
import { periodLabel, stepRange } from "@/lib/dateStep";

/** A folha fala `yyyy-MM-dd` local de ponta a ponta; `toISOString` mudaria de dia
 *  em qualquer fuso a leste de Greenwich, e o servidor de testes está em Londres. */
const day = (x: Date | undefined) => (x ? format(x, "yyyy-MM-dd") : null);

const d = (iso: string) => new Date(iso);

describe("stepRange", () => {
  it("walks a single day one day at a time", () => {
    const back = stepRange({ from: d("2026-08-26T00:00:00"), to: d("2026-08-26T23:59:59") }, -1);
    expect(day(back?.from)).toBe("2026-08-25");
    expect(day(back?.to)).toBe("2026-08-25");
  });

  it("walks a week by a week", () => {
    const fwd = stepRange({ from: d("2026-08-17T00:00:00"), to: d("2026-08-23T00:00:00") }, 1);
    expect(day(fwd?.from)).toBe("2026-08-24");
    expect(day(fwd?.to)).toBe("2026-08-30");
  });

  /**
   * A razão de o mês não ser "mais 30 dias".
   *
   * Agosto tem 31 dias e Setembro tem 30. Se o passo fosse o número de dias do
   * intervalo, quem estivesse em Agosto inteiro aterrava a 1–31 de Setembro — um mês
   * que não existe — e o mês seguinte começava no dia 2. Um mês inteiro anda de mês.
   */
  it("walks a whole calendar month by a month, not by its number of days", () => {
    const august = { from: d("2026-08-01T00:00:00"), to: d("2026-08-31T23:59:59") };
    const sep = stepRange(august, 1);
    expect(day(sep?.from)).toBe("2026-09-01");
    expect(day(sep?.to)).toBe("2026-09-30");
    const jul = stepRange(august, -1);
    expect(day(jul?.from)).toBe("2026-07-01");
    expect(day(jul?.to)).toBe("2026-07-31");
  });

  it("lands on the short month without spilling into the next", () => {
    const feb = stepRange({ from: d("2026-03-01T00:00:00"), to: d("2026-03-31T23:59:59") }, -1);
    expect(day(feb?.from)).toBe("2026-02-01");
    expect(day(feb?.to)).toBe("2026-02-28");
  });

  /** Trinta dias a meio de dois meses são trinta dias, não um mês. */
  it("treats a month-long range that does not sit on a month as plain days", () => {
    const fwd = stepRange({ from: d("2026-08-15T00:00:00"), to: d("2026-09-14T00:00:00") }, 1);
    expect(day(fwd?.from)).toBe("2026-09-15");
    expect(day(fwd?.to)).toBe("2026-10-15");
  });

  /** "All time" não tem tamanho, e o que não tem tamanho não anda. */
  it("refuses to step a range with an open end", () => {
    expect(stepRange({ from: undefined, to: d("2026-08-26T00:00:00") }, 1)).toBeNull();
    expect(stepRange({ from: d("2026-08-26T00:00:00"), to: undefined }, 1)).toBeNull();
    expect(stepRange({ from: undefined, to: undefined }, -1)).toBeNull();
  });

  it("keeps the time of day of each end", () => {
    const r = stepRange({ from: d("2026-08-26T06:00:00"), to: d("2026-08-26T17:59:59") }, 1);
    expect(r?.from.getHours()).toBe(6);
    expect(r?.to.getHours()).toBe(17);
    expect(r?.to.getMinutes()).toBe(59);
  });

  it("comes back to where it started", () => {
    for (const r of [
      { from: d("2026-08-26T00:00:00"), to: d("2026-08-26T23:59:59") },
      { from: d("2026-08-01T00:00:00"), to: d("2026-08-31T23:59:59") },
      { from: d("2026-08-17T00:00:00"), to: d("2026-08-23T00:00:00") },
    ]) {
      const there = stepRange(r, 1)!;
      const back = stepRange(there, -1)!;
      expect(back.from.toISOString()).toBe(r.from.toISOString());
      expect(back.to.toISOString()).toBe(r.to.toISOString());
    }
  });
});

describe("periodLabel", () => {
  /**
   * O rótulo é agora a única coisa que diz o que está no ecrã.
   *
   * O título da página dizia-o, o alternador dizia-o e o campo dizia-o; ficou só o
   * campo. Um botão que diz "Custom · 26/08/26 – 26/08/26" faz o leitor ler duas datas
   * e reparar que são a mesma para saber que está a olhar para um dia.
   */
  it("names a single day", () => {
    expect(periodLabel(d("2026-08-26T00:00:00"), d("2026-08-26T23:59:59"))).toBe("Wed 26 Aug 2026");
  });

  it("names a whole month by its name", () => {
    expect(periodLabel(d("2026-08-01T00:00:00"), d("2026-08-31T23:59:59"))).toBe("August 2026");
  });

  it("names a whole year", () => {
    expect(periodLabel(d("2026-01-01T00:00:00"), d("2026-12-31T23:59:59"))).toBe("2026");
  });

  /** Dentro do mesmo mês o mês não precisa de ser dito duas vezes. */
  it("says the month once when both ends share it", () => {
    expect(periodLabel(d("2026-08-17T00:00:00"), d("2026-08-23T00:00:00"))).toBe("17 – 23 Aug 2026");
  });

  it("spells both ends when they cross a month", () => {
    expect(periodLabel(d("2026-08-28T00:00:00"), d("2026-09-03T00:00:00"))).toBe("28 Aug – 3 Sep 2026");
  });

  it("spells both years when they cross one", () => {
    expect(periodLabel(d("2026-12-28T00:00:00"), d("2027-01-03T00:00:00"))).toBe("28 Dec 2026 – 3 Jan 2027");
  });

  it("says All time when a range has no ends", () => {
    expect(periodLabel(undefined, undefined)).toBe("All time");
  });

  it("says what it has when only one end is open", () => {
    expect(periodLabel(d("2026-08-26T00:00:00"), undefined)).toBe("From 26 Aug 2026");
    expect(periodLabel(undefined, d("2026-08-26T00:00:00"))).toBe("Until 26 Aug 2026");
  });
});
