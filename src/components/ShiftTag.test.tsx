import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShiftTag } from "@/components/ShiftTag";
import { shiftKind, shiftEdge } from "@/lib/shiftLook";

describe("Day e Night nos ecrãs do trabalhador", () => {
  it("lê o que as linhas trazem, e não inventa um turno para o resto", () => {
    expect(shiftKind("Day")).toBe("day");
    expect(shiftKind(" night ")).toBe("night");
    expect(shiftKind("Nights")).toBe("night");
    expect(shiftKind("Weekend")).toBeNull();
    expect(shiftKind(null)).toBeNull();
  });

  it("diz a palavra, não só a cor", () => {
    render(<><ShiftTag shift="Day" /><ShiftTag shift="Night" noun="crew" /></>);
    expect(screen.getByText("Day shift").getAttribute("data-shift")).toBe("day");
    expect(screen.getByText("Night crew").getAttribute("data-shift")).toBe("night");
  });

  it("um turno que não conhece aparece escrito tal e qual, sem cor", () => {
    const { container } = render(<ShiftTag shift="Weekend" />);
    expect(screen.getByText("Weekend")).toBeTruthy();
    expect(container.querySelector("[data-shift]")).toBeNull();
    expect(shiftEdge("Weekend")).toBe("");
  });

  it("a borda é a do turno", () => {
    expect(shiftEdge("Day")).toContain("border-l-shift-day");
    expect(shiftEdge("Night")).toContain("border-l-shift-night");
  });
});
