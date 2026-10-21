import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/components/workforce/LinkEmployeeRecord", () => ({ LinkEmployeeRecord: () => <span>link</span> }));

import { EmployeeLoginsTable, EMPLOYEE_LOGINS_PAGE_SIZE, type EmployeeLogin } from "./EmployeeLoginsTable";
import type { Employee } from "@/hooks/useWorkforce";

const login = (id: string, name: string, active = true): EmployeeLogin => ({ id, name, email: `${id}@x.com`, active });
const record = (userId: string, over: Partial<Employee> = {}): Employee => ({
  id: `e-${userId}`, full_name: userId, email: null, department: "Production", shift_pattern_id: null, employee_ref: null,
  active: true, shift_group: "Day", headcount_area_id: null, position: null, manager_id: null, employment_type: "permanent",
  started_on: null, left_on: null, source: "manual", notes: null, current_line_id: null, user_id: userId, ...over,
} as Employee);

function mount(logins: EmployeeLogin[], employees: Employee[], onEdit = vi.fn()) {
  render(<EmployeeLoginsTable logins={logins} employees={employees} canLinkRecords={false}
    canOpenRecords isLoadingRecords={false} onEdit={onEdit} emptyText="No employee logins yet." />);
  return onEdit;
}
const names = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

async function pick(label: RegExp, option: RegExp) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("User Management → Employees", () => {
  const logins = [login("u3", "Carla"), login("u1", "ana"), login("u2", "Bruno"), login("u4", "Diogo")];
  const employees = [
    record("u1", { department: "Production", shift_group: "Day" }),
    record("u2", { department: "Warehouse", shift_group: "Night", headcount_area_id: "a1" }),
    record("u3", { department: null, shift_group: null }),
    // u4 has no record at all
  ];

  it("lists A–Z by default, and Z–A on request", () => {
    mount(logins, employees);
    expect(names()).toEqual(["ana", "Bruno", "Carla", "Diogo"]);
    fireEvent.click(screen.getByRole("button", { name: /Sorted A to Z/i }));
    expect(names()).toEqual(["Diogo", "Carla", "Bruno", "ana"]);
  });

  it("shows department and shift from the linked record, and says plainly what is missing", () => {
    mount(logins, employees);
    const row = (n: string) => screen.getByText(n).closest("tr")!;
    expect(within(row("Bruno")).getByText("Warehouse")).toBeTruthy();
    expect(within(row("Bruno")).getByText("Night")).toBeTruthy();
    expect(screen.queryByText("Production line")).toBeNull();
    expect(within(row("Carla")).getAllByText("Not set")).toHaveLength(2);
    expect(within(row("Diogo")).getAllByText("No employee record")).toHaveLength(2);
  });

  it("filters by department and shift together, and search narrows further without resetting them", async () => {
    mount(logins, employees);
    await pick(/Filter by department/i, /^Production/);
    expect(names()).toEqual(["ana"]);
    await pick(/Filter by shift/i, /^Night/);
    expect(screen.getByText(/No employees match these filters/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/i }));
    expect(names()).toHaveLength(4);
  });

  it("finds the gaps with the 'No department set' filter", async () => {
    mount(logins, employees);
    await pick(/Filter by department/i, /No department set/i);
    expect(names()).toEqual(["Carla", "Diogo"]);
  });

  it("keeps the filters when the sort direction changes", async () => {
    mount(logins, employees);
    await pick(/Filter by department/i, /No department set/i);
    fireEvent.click(screen.getByRole("button", { name: /Sorted A to Z/i }));
    expect(names()).toEqual(["Diogo", "Carla"]);
  });

  it("has one Edit Employee button per row, handing over the linked record (or null)", () => {
    const onEdit = mount(logins, employees);
    fireEvent.click(screen.getByRole("button", { name: "Edit employee Bruno" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "u2" }), expect.objectContaining({ id: "e-u2" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit employee Diogo" }));
    expect(onEdit).toHaveBeenLastCalledWith(expect.objectContaining({ id: "u4" }), null);
    expect(screen.getAllByRole("button", { name: /^Edit employee/ })).toHaveLength(4);
  });

  it("ignores a record that is inactive: a leaver's old link is not the person's shift", () => {
    mount([login("u1", "ana")], [record("u1", { active: false, department: "Lab" })]);
    expect(screen.queryByText("Lab")).toBeNull();
    expect(screen.getAllByText("No employee record").length).toBeGreaterThan(0);
  });

  it("paginates, keeps A–Z across pages, and a filter that shrinks the list returns to page one", async () => {
    const many = Array.from({ length: EMPLOYEE_LOGINS_PAGE_SIZE + 5 }, (_, i) => login(`m${i}`, `P${String(i).padStart(2, "0")}`));
    const recs = many.map((l, i) => record(l.id, { department: i === 29 ? "Lab" : "Production" }));
    mount(many, recs);
    expect(names()).toHaveLength(EMPLOYEE_LOGINS_PAGE_SIZE);
    expect(screen.getByText(/Showing 1–25 of 30/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(names()).toEqual(["P25", "P26", "P27", "P28", "P29"]);
    await pick(/Filter by department/i, /^Lab/);
    expect(names()).toEqual(["P29"]);
    expect(screen.getByText(/Page 1 of 1/)).toBeTruthy();
  });

  it("shows the empty text when there are no logins at all", () => {
    mount([], []);
    expect(screen.getByText("No employee logins yet.")).toBeTruthy();
  });
});

describe("without permission to read employee records", () => {
  it("leaves the record columns and filters out instead of calling everybody 'No employee record'", () => {
    render(<EmployeeLoginsTable logins={[login("u1", "ana"), login("u2", "Bruno")]} employees={null} canLinkRecords={false}
      canOpenRecords={false} onEdit={vi.fn()} emptyText="none" />);
    expect(screen.queryByText("No employee record")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Department" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Filter by department/i })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy();
    expect(names()).toEqual(["ana", "Bruno"]);
  });

  it("still sorts, searches and edits the login", () => {
    const onEdit = vi.fn();
    render(<EmployeeLoginsTable logins={[login("u1", "ana"), login("u2", "Bruno")]} employees={null} canLinkRecords={false}
      canOpenRecords={false} onEdit={onEdit} emptyText="none" />);
    fireEvent.click(screen.getByRole("button", { name: /Sorted A to Z/i }));
    expect(names()).toEqual(["Bruno", "ana"]);
    fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "bru" } });
    expect(names()).toEqual(["Bruno"]);
    fireEvent.click(screen.getByRole("button", { name: "Edit employee Bruno" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "u2" }), null);
  });

  it("says so when the records could not be read, rather than showing false gaps", () => {
    render(<EmployeeLoginsTable logins={[login("u1", "ana")]} employees={null} canLinkRecords={false}
      canOpenRecords notice="The employee records could not be loaded" onEdit={vi.fn()} emptyText="none" />);
    expect(screen.getByRole("status").textContent).toMatch(/could not be loaded/);
    expect(screen.queryByText("No employee record")).toBeNull();
  });
});

describe("phone alerts column", () => {
  const logins = [login("u1", "ana"), login("u2", "Bruno"), login("u3", "Carla")];
  const employees = [record("u1"), record("u2"), record("u3")];
  const coverage = new Map([
    ["u1", { phones: 1, platforms: ["iPhone/iPad"], lastRegistered: null }],
    ["u3", { phones: 2, platforms: ["Android/Chrome", "iPhone/iPad"], lastRegistered: null }],
  ]);
  const mountWith = (pushCoverage: ReadonlyMap<string, { phones: number; platforms: string[]; lastRegistered: string | null }> | null) =>
    render(<EmployeeLoginsTable logins={logins} employees={employees} canLinkRecords={false} canOpenRecords
      isLoadingRecords={false} onEdit={vi.fn()} emptyText="none" pushCoverage={pushCoverage} />);

  it("says who is on and who is off, with the kind of phone", () => {
    mountWith(coverage);
    expect(screen.getByText("On · iPhone/iPad")).toBeTruthy();
    expect(screen.getByText("On · Android/Chrome, iPhone/iPad")).toBeTruthy();
    const bruno = screen.getAllByRole("row").find((r) => r.textContent?.startsWith("Bruno"))!;
    expect(within(bruno).getByText("Off")).toBeTruthy();
  });

  it("finds the people still to chase", async () => {
    mountWith(coverage);
    await pick(/Filter by phone alerts/i, /^Alerts off/);
    expect(names()).toEqual(["Bruno"]);
    await pick(/Filter by phone alerts/i, /^Alerts on/);
    expect(names()).toEqual(["ana", "Carla"]);
  });

  it("is left out, not drawn as 'Off' for everybody, when the answer is not available", () => {
    mountWith(null);
    expect(screen.queryByText("Phone alerts")).toBeNull();
    expect(screen.queryByText("Off")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /phone alerts/i })).toBeNull();
  });
});
