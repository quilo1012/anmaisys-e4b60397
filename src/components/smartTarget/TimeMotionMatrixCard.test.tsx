import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeMotionMatrixCard } from "./TimeMotionMatrixCard";
import { FILL_SPEED_OVERRIDES_KEY } from "@/lib/fillSpeedMatrixEditor";
import { OTHER_MACHINES } from "@/lib/timeMotionMatrix";

describe("Fill speed matrix editing", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it.each(OTHER_MACHINES)("persists decimal corrections for $name", (machine) => {
    const row = machine.rows[0];
    const first = render(<TimeMotionMatrixCard />);
    const label = `${machine.name} ${row.pack} fill time in seconds`;
    const input = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2,77" } });
    expect(input.checkValidity()).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(FILL_SPEED_OVERRIDES_KEY) ?? "{}")[`machine:${machine.name}:${row.pack}`]).toBe(2.77);
    first.unmount();
    render(<TimeMotionMatrixCard />);
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("2.77");
  });

  it("keeps the editor open when browser storage refuses a save", () => {
    render(<TimeMotionMatrixCard />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    const input = screen.getByLabelText("Line 4 250 g fill time in seconds") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2.77" } });
    expect(input.value).toBe("2.77");
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("accepts and persists Line 4 250 g decimal fill times without browser validation errors", () => {
    const first = render(<TimeMotionMatrixCard />);
    const input = screen.getByLabelText("Line 4 250 g fill time in seconds") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2.4" } });
    expect(input.checkValidity()).toBe(true);
    fireEvent.change(input, { target: { value: "2,77" } });
    fireEvent.blur(input);
    expect(JSON.parse(window.localStorage.getItem(FILL_SPEED_OVERRIDES_KEY) ?? "{}")["line:4:0.25"]).toBe(2.77);
    first.unmount();
    render(<TimeMotionMatrixCard />);
    expect((screen.getByLabelText("Line 4 250 g fill time in seconds") as HTMLInputElement).value).toBe("2.77");
  });

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
