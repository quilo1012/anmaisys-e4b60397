import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StopCodeDot } from "@/components/intouch/StopCodeDot";
import { stopColour } from "@/lib/intouchStopColours";

/**
 * The lists of stop codes wear iTouching's colours for the same reason the board
 * does. What matters here is the silence: a name iTouching does not paint gets no
 * dot at all, because these are the screens where somebody is deciding whether a
 * name still matches iTouching's, and a grey dot would answer "yes" to that.
 */
describe("StopCodeDot", () => {
  const dot = (name: string | null) =>
    render(<StopCodeDot name={name} />).container.querySelector("span[style]");

  it("wears the colour iTouching paints the code", () => {
    // Verified against the live panel when the palette was taken.
    expect(dot("Breaks")).toHaveStyle({ backgroundColor: "#1DE9ED" });
    expect(dot("No Planned Shift")).toHaveStyle({ backgroundColor: "#A9BC15" });
  });

  it("draws nothing for a name iTouching does not paint", () => {
    // A label typed by hand that has drifted — a stray word, a different spelling —
    // is a label the board can no longer colour, and the missing dot says so.
    expect(render(<StopCodeDot name="Waiting for the kettle" />).container).toBeEmptyDOMElement();
    expect(render(<StopCodeDot name={null} />).container).toBeEmptyDOMElement();
  });

  it("reads the name the way iTouching's own map does", () => {
    // Case and spacing are not a different code. The map normalises, and the dot has
    // to agree with it or the catalogue would disagree with the board.
    expect(dot("  breaks  ")).toHaveStyle({ backgroundColor: stopColour("Breaks")! });
  });

  it("marks the one code that cannot be told apart", () => {
    // iTouching holds two codes called Metal Detected, in two colours, and only the
    // name joins them to ours. The asterisk is the admission.
    const { container } = render(<StopCodeDot name="Metal Detected" />);
    expect(container.textContent).toContain("*");
    expect(container.querySelector("[title]")?.getAttribute("title")).toContain("two codes");
  });
});
