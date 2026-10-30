/**
 * The unified Edit Employee form: one form in sections, one Save, one Cancel, and a
 * warning before edits are lost. (The field-level behaviour — name, email, aliases,
 * permissions — is covered by EmployeeDetailPanel.test.tsx.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const EMPLOYEE = {
  id: "e1", full_name: "Ana Silva", department: "Production", position: null, email: null,
  active: true, shift_group: "Night", shift_pattern_id: "p-day", manager_id: null,
  headcount_area_id: null, employee_ref: null, started_on: null, left_on: null,
  notes: null, sheet_aliases: null, user_id: "u1", employment_type: "permanent",
};
const guardar = vi.fn();
const guardarSupervisores = vi.fn();

vi.mock("@/hooks/useWorkforce", () => ({
  useEmployees: () => ({ data: [EMPLOYEE, { ...EMPLOYEE, id: "s1", full_name: "Joao Surian", position: "Supervisor", manager_id: null }, { ...EMPLOYEE, id: "s2", full_name: "Maria Lopes", position: "Supervisor", manager_id: null }] }),
  useShiftPatterns: () => ({ data: [
    { id: "p-day", name: "Mon–Fri days", days: [1, 2, 3, 4, 5], active: true, starts_at: "06:00:00", ends_at: "18:00:00", dayOverrides: [] },
    { id: "p-night", name: "Mon–Thu nights", days: [1, 2, 3, 4], active: true, starts_at: "18:00:00", ends_at: "06:00:00", dayOverrides: [] },
  ] }),
  useShiftHistory: () => ({ data: [], isLoading: false }),
  useEmployeeRecordHistory: () => ({ data: [], isLoading: false }),
  useEmployeeSupervisors: () => ({ data: null }),
  useSetEmployeeSupervisors: () => ({ mutate: guardarSupervisores, isPending: false }),
  supervisorIdsOf: (e: { manager_id: string | null }) => (e.manager_id ? [e.manager_id] : []),
  useMovements: () => ({ data: [], isLoading: false }),
  useRecentPlacements: () => ({ data: [], isLoading: false, isError: false }),
  useEmployeeBoardOvertime: () => ({ board: { data: [], isLoading: false, isError: false }, asks: { data: [] }, clock: { data: [] } }),
  useEmployeeOvertime: () => ({ data: [], isLoading: false }),
  useOvertimeEverImported: () => ({ data: false }),
  useUpdateEmployee: () => ({ mutate: guardar, isPending: false }),
  describeDays: () => "Mon, Tue",
  describeSchedule: () => "",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EmployeeDetailPanel } from "@/components/workforce/EmployeeDetailPanel";

const onOpenChange = vi.fn();

function mount(canEdit = true, accountSection?: Parameters<typeof EmployeeDetailPanel>[0]["accountSection"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EmployeeDetailPanel employee={EMPLOYEE as never} open onOpenChange={onOpenChange} canEdit={canEdit} accountSection={accountSection} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); guardar.mockClear(); onOpenChange.mockClear(); });

const combo = (text: string) => screen.getAllByRole("combobox").find((el) => el.textContent?.includes(text));
async function choose(text: string, option: RegExp) {
  const el = combo(text);
  if (!el) throw new Error(`No selector showing "${text}"`);
  fireEvent.keyDown(el, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("Edit Employee, as one form", () => {
  it("is organised in the six sections", async () => {
    mount();
    await screen.findByLabelText(/Full name/i);
    for (const title of [
      "Personal & Employment Details", "Department & Role", "Shift & Working Schedule",
      "Supervisor & Line Leader", "Account & Access", "Additional Information",
    ]) expect(screen.getByText(title)).toBeTruthy();
  });

  it("has no production-line field any more, and does not touch the person's line when saving", async () => {
    mount();
    await screen.findByLabelText(/Full name/i);
    expect(screen.queryByText("Production Assignment")).toBeNull();
    expect(screen.queryByText(/Usual production line/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: "Ana Souza" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(guardar).toHaveBeenCalledTimes(1);
    expect("headcount_area_id" in guardar.mock.calls[0][0].patch).toBe(false);
    expect(guardar.mock.calls[0][0].patch.shift_group).toBe("Night");
  });

  it("takes more than one supervisor, keeps them for Save, and the first stays the manager", async () => {
    mount();
    await screen.findByLabelText(/Full name/i);
    await choose("Choose a supervisor", /Joao Surian/);
    await choose("Add another supervisor", /Maria Lopes/);
    expect(guardar).not.toHaveBeenCalled();
    expect(within(screen.getByRole("list", { name: "Supervisors" })).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(guardar.mock.calls[0][0].patch.manager_id).toBe("s1");
    // The full list goes in one call once the record is saved.
    guardar.mock.calls[0][1].onSuccess();
    expect(guardarSupervisores).toHaveBeenCalledWith(
      { id: EMPLOYEE.id, supervisors: ["s1", "s2"] }, expect.anything(),
    );
  });

  it("removes one supervisor without losing the other", async () => {
    mount();
    await screen.findByLabelText(/Full name/i);
    await choose("Choose a supervisor", /Joao Surian/);
    await choose("Add another supervisor", /Maria Lopes/);
    fireEvent.click(screen.getByRole("button", { name: "Remove Joao Surian" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(guardar.mock.calls[0][0].patch.manager_id).toBe("s2");
  });

  it("Cancel puts every field back and disables Save again", async () => {
    mount();
    const name = (await screen.findByLabelText(/Full name/i)) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Ana Souza" } });
    const save = screen.getByRole("button", { name: "Save Changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(name.value).toBe("Ana Silva");
    expect(save.disabled).toBe(true);
    expect(guardar).not.toHaveBeenCalled();
  });

  it("asks before closing with unsaved edits, and closes straight away when nothing changed", async () => {
    mount();
    await screen.findByLabelText(/Full name/i);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false); // clean: no question
    onOpenChange.mockClear();

    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: "Ana Souza" } });
    fireEvent.keyDown(document.body, { key: "Escape" });
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Discard unsaved changes/i)).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /Keep editing/i }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Full name/i) as HTMLInputElement).value).toBe("Ana Souza");
  });

  it("discarding closes the panel and drops the edits", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText(/Full name/i), { target: { value: "Ana Souza" } });
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Discard changes/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(guardar).not.toHaveBeenCalled();
  });

  it("flags a Night shift on a daytime rota as needing review, and clears it when they agree", async () => {
    mount();
    await screen.findByLabelText(/Full name/i);
    expect(screen.getByRole("alert").textContent).toMatch(/Needs review: Night shift/);
    await choose("Mon–Fri days", /Mon–Thu nights/);
    expect(screen.queryByText(/Needs review/)).toBeNull();
  });

  it("says Not set for a missing shift, rota or department instead of leaving them blank", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <EmployeeDetailPanel employee={{ ...EMPLOYEE, department: null, shift_group: null, shift_pattern_id: null } as never}
          open onOpenChange={() => {}} canEdit />
      </QueryClientProvider>,
    );
    await screen.findByLabelText(/Full name/i);
    expect(screen.getByText(/Not set — overtime offers cannot be matched/)).toBeTruthy();
    expect(screen.getByText(/Not set — this person is due in every day/)).toBeTruthy();
    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
  });

  it("shows no password anywhere, and says whether a sign-in is linked", async () => {
    mount();
    await screen.findByLabelText(/Full name/i);
    expect(screen.getByText(/has an app sign-in/i)).toBeTruthy();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  it("lets the host put sign-in controls in Account & Access, leaving through the unsaved-edits guard", async () => {
    const manage = vi.fn();
    mount(true, (leave) => <button onClick={() => leave(manage)}>Manage sign-in…</button>);
    await screen.findByLabelText(/Full name/i);
    fireEvent.click(screen.getByRole("button", { name: /Manage sign-in/ }));
    expect(manage).toHaveBeenCalledTimes(1); // clean: straight through
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: "Ana Souza" } });
    fireEvent.click(screen.getByRole("button", { name: /Manage sign-in/ }));
    expect(manage).toHaveBeenCalledTimes(1); // dirty: asks first
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Discard changes/i }));
    expect(manage).toHaveBeenCalledTimes(2);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("is read-only without permission: no Save, no Cancel", async () => {
    mount(false);
    await screen.findByLabelText(/Full name/i);
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
