import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TimeMotionMatrixCard } from "./TimeMotionMatrixCard";
import { FILL_SPEED_OVERRIDES_KEY } from "@/lib/fillSpeedMatrixEditor";

describe("Fill speed matrix editing", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it("recalculates and restores the 250 g correction after remounting", () => {
    const first = render(<TimeMotionMatrixCard />);
    const input = screen.getByLabelText("Line 1 250 g fill time in seconds") as HTMLInputElement;
    const row = input.closest("tr") as HTMLTableRowElement;

    fireEvent.change(input, { target: { value: "2.4" } });

    expect(input.value).toBe("2.4");
    expect(row.textContent).toContain("1,500");
    expect(row.textContent).toContain("25.0");
    expect(JSON.parse(window.localStorage.getItem(FILL_SPEED_OVERRIDES_KEY) ?? "{}")).toEqual({ "line:1:0.25": 2.4 });

    first.unmount();
    render(<TimeMotionMatrixCard />);
    const restored = screen.getByLabelText("Line 1 250 g fill time in seconds") as HTMLInputElement;
    expect(restored.value).toBe("2.4");
    expect(restored.closest("tr")?.textContent).toContain("1,500");
  });
});
