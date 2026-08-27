import { describe, it, expect } from "vitest";
import { bayColor, bayHue, bayInk, baySpine, bayWash } from "@/lib/lineBay";

const NUMBERED = Array.from({ length: 6 }, (_, i) => `Line ${i + 1}`);
const MACHINES = ["Tablet Line", "Capsules Machine 1", "Capsules Machine 2", "Blister Line"];

/** As listas do quadro, na ordem em que lá estão. Se isto mudar, mudou o quadro. */
const BOARD_HUES: Record<string, number> = {
  "Line 1": 155, // green
  "Line 2": 46,  // yellow
  "Line 3": 215, // blue
  "Line 4": 4,   // red
  "Line 5": 323, // pink
  "Line 6": 84,  // lime
};

describe("bayColor", () => {
  /**
   * A razão de existir deste ficheiro.
   *
   * A cor de uma linha não se inventa aqui: já está decorada por quem faz o plano no
   * quadro do Trello. Uma aproximação "parecida" não serve — o que faz a faixa no ecrã e
   * a lista no quadro serem a mesma coisa é serem o mesmo matiz, e não dois primos. Este
   * é o teste que impede alguém de "arrumar" a paleta para um arco mais bonito.
   */
  it("wears the hue of its own list on the board", () => {
    for (const [name, hue] of Object.entries(BOARD_HUES)) {
      expect(bayHue(name), name).toBe(hue);
    }
  });

  it("gives every filler line its own colour", () => {
    const inks = NUMBERED.map(bayInk);
    expect(new Set(inks).size).toBe(NUMBERED.length);
  });

  /** No quadro a 5A e a 5B são a mesma cor, porque são a mesma linha em dois lados. */
  it("folds the A and B sides of a line into one colour, as the board does", () => {
    expect(bayInk("Line 5A")).toBe(bayInk("Line 5"));
    expect(bayInk("Line 5B")).toBe(bayInk("Line 5A"));
    expect(bayInk("Line 6A")).toBe(bayInk("Line 6B"));
    expect(bayInk("Line 6A")).not.toBe(bayInk("Line 5A"));
  });

  it("keeps the machines off the board's six", () => {
    const lines = new Set(NUMBERED.map(bayInk));
    for (const m of MACHINES) expect(lines.has(bayInk(m)), m).toBe(false);
    // E distinguem-se umas das outras: dobrá-las todas na mesma cor foi um bug que este
    // ecrã já teve, quando chamava "Tablet" a três máquinas diferentes.
    expect(new Set(MACHINES.map(bayInk)).size).toBeGreaterThan(1);
  });

  it("reads the number, not the spelling", () => {
    expect(bayInk("Line 3")).toBe(bayInk("line3"));
    expect(bayInk("  LINE  3 ")).toBe(bayInk("Line 3"));
  });

  /** Uma cor que muda quando se escolhe outro dia não identifica nada. */
  it("depends only on the name", () => {
    expect(bayInk("Line 4")).toBe(bayInk("Line 4"));
    expect(bayInk(null)).toBe(bayInk(undefined));
  });

  it("does not hand a seventh line the colour of the first", () => {
    expect(bayInk("Line 7")).not.toBe(bayInk("Line 1"));
  });

  /**
   * Verde, âmbar e vermelho são também as três cores com que este sistema diz `go`,
   * `hold` e `stop`, e a folha tem filas realmente pintadas de âmbar por lhes faltar o
   * líder. A baía convive com isso por uma razão só: entra pela faixa contínua do chão e
   * pelo quadrado da placa, nunca pelo bordo de 3 px do `railEdge`, que é onde o estado
   * fala. Este teste guarda a fronteira, não a paleta.
   */
  it("never claims a hue the board does not have", () => {
    const board = new Set(Object.values(BOARD_HUES));
    const offBoard = new Set([250, 195, 25, 217]);
    for (const name of [...NUMBERED, ...MACHINES, "Line 7", "Line 9", ""]) {
      const h = bayHue(name);
      expect(board.has(h) || offBoard.has(h), `${name} → ${h}`).toBe(true);
    }
  });
});

describe("bayInk, bayWash, baySpine", () => {
  /** Croma e valor vêm dos tokens, ou a faixa não vira com o tema. */
  it("take their chroma and value from the theme", () => {
    for (const css of [bayInk("Line 2"), bayWash("Line 2"), baySpine("Line 2")]) {
      expect(css).toContain("var(--bay-sat)");
      expect(css).toContain("var(--bay-lum)");
    }
    expect(bayWash("Line 2")).toContain("var(--bay-wash)");
  });

  /** O matiz nunca passa por token nenhum: é ele que ata o ecrã ao quadro. */
  it("never lets the theme touch the hue", () => {
    const [h] = bayColor("Line 3");
    for (const css of [bayInk("Line 3"), bayWash("Line 3"), baySpine("Line 3", true)]) {
      expect(css.startsWith(`hsl(${h} `), css).toBe(true);
    }
  });

  it("dims the spine for the night without changing the bay", () => {
    const day = baySpine("Line 4");
    const night = baySpine("Line 4", true);
    expect(day).toBe(bayInk("Line 4"));
    expect(night).not.toBe(day);
    // A mesma cor, menos força: o matiz é o mesmo às seis da manhã e às seis da tarde.
    expect(night).toContain(`hsl(${bayHue("Line 4")} `);
    expect(night).toContain("/ 0.4)");
  });
});
