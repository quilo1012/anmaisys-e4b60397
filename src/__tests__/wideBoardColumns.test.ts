import { describe, expect, it } from "vitest";
import { wideBoardColumns } from "@/lib/lineBoardColumns";

/**
 * O caso que trouxe isto aqui: sete linhas em três colunas deixam a Tablet Line
 * sozinha numa fila, com dois terços de cartão vazio à direita dela.
 */
describe("wideBoardColumns", () => {
  it("gives seven lines four columns, so the last row holds three and not one", () => {
    expect(wideBoardColumns(7)).toBe(4);
  });

  it("keeps nine lines at three, which is the only width that closes them", () => {
    expect(wideBoardColumns(9)).toBe(3);
  });

  it("fills the row exactly whenever one of the two widths can", () => {
    expect(wideBoardColumns(8)).toBe(4);
    expect(wideBoardColumns(6)).toBe(3);
    expect(wideBoardColumns(12)).toBe(4);
  });

  it("never leaves a bigger hole than the other width would", () => {
    for (let n = 1; n <= 30; n++) {
      const chosen = wideBoardColumns(n);
      const other = chosen === 4 ? 3 : 4;
      const holes = (cols: number) => (cols - (n % cols)) % cols;
      expect(holes(chosen)).toBeLessThanOrEqual(holes(other));
    }
  });

  it("does not divide by zero on an empty board", () => {
    expect(wideBoardColumns(0)).toBe(3);
  });
});
