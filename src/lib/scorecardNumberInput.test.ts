import { describe, expect, it } from "vitest";
import { FRACTION_INPUT, parseNullableNumber, readNumberEdit } from "./scorecardNumberInput";

describe("readNumberEdit", () => {
  it("deixa escrever 0.95 tecla a tecla, que e o unico valor que estes campos aceitam", () => {
    // Os quatro campos sao numeric(5,4) BETWEEN 0 AND 1: qualquer valor real passa
    // obrigatoriamente por um estado que termina em ponto. Se esse estado escrever no
    // rascunho, o campo volta a "0" e o ponto nunca chega a ser seguido de um digito.
    expect(readNumberEdit("0")).toEqual({ kind: "value", value: 0 });
    expect(readNumberEdit("0.")).toEqual({ kind: "pending" });
    expect(readNumberEdit("0.9")).toEqual({ kind: "value", value: 0.9 });
    expect(readNumberEdit("0.95")).toEqual({ kind: "value", value: 0.95 });
  });

  it("trata o campo esvaziado como null, e so o campo esvaziado", () => {
    expect(readNumberEdit("")).toEqual({ kind: "value", value: null });
    expect(readNumberEdit("   ")).toEqual({ kind: "value", value: null });
    // Lixo nao apaga o que la estava — apagar exige esvaziar.
    expect(readNumberEdit("abc")).toEqual({ kind: "pending" });
  });

  it("reconhece os outros prefixos que ainda nao sao um numero", () => {
    for (const partial of ["-", "+", ".", "-.", "12."]) {
      expect(readNumberEdit(partial)).toEqual({ kind: "pending" });
    }
  });

  it("nunca devolve 0 para um campo que so esta a meio, ao contrario de Number()", () => {
    // O bug, na sua forma mais curta.
    expect(Number("0.")).toBe(0);
    expect(parseNullableNumber("0.")).toBe(0);
    expect(readNumberEdit("0.")).toEqual({ kind: "pending" });
  });

  it("o passo do campo de fraccao continua a ser decimal, senao nada disto teria sentido", () => {
    expect(FRACTION_INPUT).toEqual({ min: 0, max: 1, step: 0.01 });
  });
});
