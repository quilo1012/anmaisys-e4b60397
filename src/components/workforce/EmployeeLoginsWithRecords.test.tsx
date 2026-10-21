import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { employees: [] as unknown[], isError: false };
vi.mock("@/hooks/useWorkforce", () => ({
  useEmployees: () => ({ data: state.employees, isLoading: false, isError: state.isError }),
  useEmployeeSupervisors: () => ({ data: null }),
  useSetEmployeeSupervisors: () => ({ mutate: vi.fn(), isPending: false }),
  supervisorIdsOf: (e: { manager_id: string | null }) => (e.manager_id ? [e.manager_id] : []),
  useShiftPatterns: () => ({ data: [] }),
  useShiftHistory: () => ({ data: [], isLoading: false }),
  useEmployeeRecordHistory: () => ({ data: [], isLoading: false }),
  useMovements: () => ({ data: [], isLoading: false }),
  useEmployeeOvertime: () => ({ data: [], isLoading: false }),
  useOvertimeEverImported: () => ({ data: false }),
  useUpdateEmployee: () => ({ mutate: vi.fn(), isPending: false }),
  describeDays: () => "", describeSchedule: () => "",
}));
vi.mock("@/hooks/usePushCoverage", () => ({ usePushCoverage: () => ({ data: null }) }));
vi.mock("@/components/workforce/LinkEmployeeRecord", () => ({ LinkEmployeeRecord: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EmployeeLoginsWithRecords } from "./EmployeeLoginsWithRecords";

const REC = { id: "e1", full_name: "Ana Silva", email: null, department: "Production", shift_pattern_id: null, employee_ref: null,
  active: true, shift_group: "Day", headcount_area_id: "a1", position: null, manager_id: null, employment_type: "permanent",
  started_on: null, left_on: null, source: "manual", notes: null, current_line_id: null, user_id: "u1" };
const LOGINS = [{ id: "u1", name: "Ana", email: "ana@x.com", active: true }, { id: "u2", name: "Bruno", email: "b@x.com", active: true }];

beforeEach(() => {
  state.employees = [REC]; state.isError = false;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

function mount(onEditLogin = vi.fn(), accountSection = vi.fn(() => <span>account-slot</span>)) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EmployeeLoginsWithRecords logins={LOGINS} canLinkRecords={false} canEditRecords emptyText="none"
        onEditLogin={onEditLogin} accountSection={accountSection} />
    </QueryClientProvider>,
  );
  return { onEditLogin, accountSection };
}

describe("Edit Employee from User Management", () => {
  it("opens the one unified form for a login that has a record, with the sign-in in Account & Access", async () => {
    const { onEditLogin, accountSection } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit employee Ana" }));
    expect(await screen.findByLabelText(/Full name/i)).toBeTruthy();
    expect(screen.getByText("Account & Access")).toBeTruthy();
    expect(screen.getByText("account-slot")).toBeTruthy();
    expect(accountSection).toHaveBeenCalledWith("u1", expect.any(Function));
    expect(onEditLogin).not.toHaveBeenCalled();
  });

  it("opens the account dialog for a login that has no record", () => {
    const { onEditLogin } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit employee Bruno" }));
    expect(onEditLogin).toHaveBeenCalledWith(expect.objectContaining({ id: "u2" }));
    expect(screen.queryByLabelText(/Full name/i)).toBeNull();
  });

  it("does not turn a failed read into 'No employee record'", () => {
    state.isError = true;
    mount();
    expect(screen.queryByText("No employee record")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/could not be loaded/);
  });
});
