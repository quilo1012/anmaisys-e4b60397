import { describe, it, expect } from "vitest";
import { bayHue, bayInk, baySpine, bayWash } from "@/lib/lineBay";

const NUMBERED = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
const MACHINES = ["Tablet Line", "Capsules Machine 1", "Capsules Machine 2", "Blister Line"];

describe("bayHue", () => {
  /**
   * A razão de existir do arco.
   *
   * Verde, âmbar e vermelho são as três cores com que este sistema diz `go`, `hold` e
   * `stop` — e o mesmo ecrã tem filas realmente pintadas de âmbar por lhes faltar o
   * líder. Se uma baía caísse no verde, a folha passava a ter uma linha "em ordem" que
   * ninguém mandou pôr em ordem. Este é o teste que impede alguém de alargar o arco
   * "para ter mais cores".
   */
  it("never lands where the andon speaks", () => {
    for (const name of [...NUMBERED, ...MACHINES]) {
      const h = bayHue(name);
      // 192° (ciano) a 334.5° (o meio passo mais alto, rosa-magenta). O vermelho do
      // `stop` começa por volta dos 355°, o âmbar do `hold` aos 38° e o verde do `go`
      // aos 152° — todos fora deste intervalo, e é isso que aqui se prega.
      expect(h, name).toBeGreaterThanOrEqual(192);
      expect(h, name).toBeLessThanOrEqual(335);
    }
  });

  it("gives every filler line its own hue, in the order of the floor", () => {
    const hues = NUMBERED.map(bayHue);
    expect(new Set(hues).size).toBe(NUMBERED.length);
    // Crescente e a passo igual: a cor é a posição na nave, não uma identidade avulsa.
    for (let i = 1; i < hues.length; i++) expect(hues[i] - hues[i - 1]).toBe(15);
  });

  it("puts the machines between the bays, never on one", () => {
    const bays = new Set(NUMBERED.map(bayHue));
    for (const m of MACHINES) {
      expect(bays.has(bayHue(m)), m).toBe(false);
      expect((bayHue(m) - 192) % 15, m).toBe(7.5);
    }
    // E distinguem-se umas das outras: dobrá-las todas na mesma cor foi um bug que este
    // ecrã já teve, quando chamava "Tablet" a três máquinas diferentes.
    expect(new Set(MACHINES.map(bayHue)).size).toBeGreaterThan(1);
  });

  it("reads the number, not the spelling", () => {
    expect(bayHue("Line 3")).toBe(bayHue("line3"));
    expect(bayHue("  LINE  3 ")).toBe(bayHue("Line 3"));
  });

  /** Uma cor que muda quando se escolhe outro dia não identifica nada. */
  it("depends only on the name", () => {
    expect(bayHue("Line 7")).toBe(bayHue("Line 7"));
    expect(bayHue(null)).toBe(bayHue(undefined));
  });

  it("wraps an eleventh line back into the arc rather than out of it", () => {
    expect(bayHue("Line 11")).toBe(bayHue("Line 1"));
  });
});

describe("bayInk, bayWash, baySpine", () => {
  /** Saturação e valor vêm dos tokens, ou a faixa não vira com o tema. */
  it("take their saturation and lightness from the theme", () => {
    for (const css of [bayInk("Line 2"), bayWash("Line 2"), baySpine("Line 2")]) {
      expect(css).toContain("var(--bay-s)");
      expect(css).toContain("var(--bay-l)");
    }
    expect(bayWash("Line 2")).toContain("var(--bay-wash)");
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
