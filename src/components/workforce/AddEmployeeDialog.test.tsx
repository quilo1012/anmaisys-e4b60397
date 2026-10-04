/**
 * The screen where the second FELIPE was typed.
 *
 * The matching rule is tested next door in src/lib/similarNames.test.ts. What has to
 * hold here is the wiring: that the name somebody is typing is actually checked
 * against the record, that the warning names who is already on file, and that the
 * save cannot happen by reflex — while still being possible, because two brothers on
 * the same line is a real thing in this factory.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddEmployeeDialog } from "@/components/workforce/AddEmployeeDialog";

const mutate = vi.fn();

vi.mock("@/hooks/useWorkforce", () => ({
  useEmployees: () => ({
    data: [
      { id: "1", full_name: "FELIPE DE ARAUJO", active: true, shift_group: "Night", department: "Production", left_on: null },
      { id: "2", full_name: "Ezaquiel Santos", active: false, shift_group: "Day", department: null, left_on: "2026-08-04" },
    ],
  }),
  useHeadcountAreas: () => ({ data: [] }),
  useCreateEmployee: () => ({ mutate, isPending: false }),
}));

const open = () => {
  render(<AddEmployeeDialog />);
  fireEvent.click(screen.getByRole("button", { name: /add employee/i }));
  return screen.getByLabelText(/full name/i);
};

const addButton = () => screen.getByRole("button", { name: /^add( anyway)?$/i });

beforeEach(() => mutate.mockClear());

describe("AddEmployeeDialog", () => {
  it("names who is already on file when the only difference is a connective", () => {
    const name = open();
    fireEvent.change(name, { target: { value: "Felipe Araujo" } });

    expect(screen.getByText(/already on the record/i)).toBeInTheDocument();
    expect(screen.getByText("FELIPE DE ARAUJO")).toBeInTheDocument();
  });

  it("will not save on top of a lookalike until somebody says it is not them", () => {
    const name = open();
    fireEvent.change(name, { target: { value: "Felipe Araujo" } });

    expect(addButton()).toBeDisabled();
    fireEvent.click(addButton());
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: /different person/i }));
    expect(addButton()).toBeEnabled();
    fireEvent.click(addButton());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ full_name: "Felipe Araujo" });
  });

  it("offers the leaver's record rather than a new row", () => {
    const name = open();
    fireEvent.change(name, { target: { value: "Ezaquiel dos Santos" } });

    expect(screen.getByText("Ezaquiel Santos")).toBeInTheDocument();
    expect(screen.getByText(/left 2026-08-04/)).toBeInTheDocument();
  });

  it("stays out of the way for a name nobody on the books resembles", () => {
    const name = open();
    fireEvent.change(name, { target: { value: "Marta Oliveira" } });

    expect(screen.queryByText(/already on the record/i)).not.toBeInTheDocument();
    expect(addButton()).toBeEnabled();
    fireEvent.click(addButton());
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("asks again when the name is retyped into another lookalike", () => {
    // The tick belongs to the name that was on screen when it was ticked. Without
    // this, clearing the box and typing a second duplicate inherits the permission
    // given to the first.
    const name = open();
    fireEvent.change(name, { target: { value: "Felipe Araujo" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /different person/i }));
    expect(addButton()).toBeEnabled();

    fireEvent.change(name, { target: { value: "Ezaquiel Santos" } });
    expect(addButton()).toBeDisabled();
  });
});
