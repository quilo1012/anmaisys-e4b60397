import { describe, it, expect, beforeEach } from "vitest";
import { holdDrag, clearDrag, takeDrag, peekDrag } from "@/lib/boardDrag";

/**
 * O que fixa é o defeito que estava no board: a memória do arrasto sobrevivia ao
 * próprio arrasto.
 *
 * Era uma variável de módulo posta no `dragStart` e nunca limpa. Escape a meio, ou
 * largar sobre nada, e o id ficava — e o `drop` seguinte, em qualquer zona, colocava
 * essa pessoa. Na vista Split são dois boards a ler a mesma variável, por isso a
 * pessoa presa podia aterrar no turno errado. Arrastar um ficheiro do ambiente de
 * trabalho para cima do board chegava para disparar.
 */

beforeEach(() => clearDrag());

describe("a memória do arrasto", () => {
  it("é de uso único: o segundo drop não recebe a pessoa do primeiro", () => {
    holdDrag("e1");
    expect(takeDrag()).toBe("e1");
    // O arrasto acabou no primeiro. Este segundo drop não é sobre ninguém.
    expect(takeDrag()).toBe("");
  });

  it("esvazia-se mesmo quando o evento trouxe a pessoa", () => {
    holdDrag("e1");
    expect(takeDrag("e1")).toBe("e1");
    expect(peekDrag()).toBeNull();
  });

  it("um arrasto cancelado não deixa ninguém para trás", () => {
    holdDrag("e1");
    clearDrag(); // Escape, ou largar fora de qualquer zona
    expect(takeDrag()).toBe("");
  });

  it("o que o browser entrega ganha ao que ficou em memória", () => {
    // O evento pertence a ESTE drop; a memória pertence ao último arrasto que começou.
    holdDrag("e-antigo");
    expect(takeDrag("e-deste-drop")).toBe("e-deste-drop");
  });

  it("recorre à memória só quando o evento vem vazio", () => {
    // jsdom e alguns shims de toque nos tablets não trazem o payload até ao drop.
    holdDrag("e1");
    expect(takeDrag("")).toBe("e1");
    holdDrag("e2");
    expect(takeDrag(null)).toBe("e2");
    holdDrag("e3");
    expect(takeDrag(undefined)).toBe("e3");
  });

  it("devolve vazio quando nada de nosso foi largado", () => {
    // Um ficheiro arrastado do ambiente de trabalho. O chamador não faz nada com isto.
    expect(takeDrag()).toBe("");
    expect(takeDrag("")).toBe("");
  });
});
