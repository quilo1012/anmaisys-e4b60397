import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModuleHeader } from "./ModuleHeader";

vi.mock("@/assets/appliedlogo.jpeg", () => ({ default: "applied-mark.jpeg" }));

/**
 * The band already answers "where am I" with the module eyebrow. On a phone it is
 * also the only thing that can answer "whose system is this".
 *
 * The sidebar carries the Applied Nutrition mark, and on a desktop that is enough —
 * repeating it in the band would be two logos on one screen. But the floor answers
 * overtime from a phone, where the sidebar is a closed drawer: the brand is absent
 * from the whole page. So the mark rides in the band, and only where the sidebar is
 * not showing.
 */
describe("ModuleHeader", () => {
  it("carries no mark by default, because the sidebar already has one", () => {
    render(<ModuleHeader title="Finance Close" />);
    expect(screen.queryByAltText("Applied Nutrition")).toBeNull();
  });

  it("shows the mark when the screen asks for it", () => {
    render(<ModuleHeader title="Overtime" brand />);
    expect(screen.getByAltText("Applied Nutrition")).toBeTruthy();
  });

  it("hides the mark at the width where the sidebar appears", () => {
    // Two logos on one screen is the failure this guards against, and it is invisible
    // in jsdom — only the class says it.
    render(<ModuleHeader title="Overtime" brand />);
    const img = screen.getByAltText("Applied Nutrition");
    expect(img.parentElement?.className ?? "").toMatch(/md:hidden/);
  });

  it("still says which module it is, with or without the mark", () => {
    render(<ModuleHeader title="Overtime" module="Overtime" brand />);
    expect(screen.getByText("Overtime", { selector: "h1" })).toBeTruthy();
  });
});
