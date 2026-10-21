import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PeopleTable, type PersonRow } from "@/components/workforce/PeopleTable";

const person = (id: string, name: string, over: Partial<PersonRow> = {}): PersonRow => ({
  id, full_name: name, email: null, department: "Production", shift_pattern_id: null, employee_ref: null, active: true,
  shift_group: "Day", headcount_area_id: null, position: null, manager_id: null, employment_type: "permanent",
  started_on: null, left_on: null, source: "manual", notes: null, current_line_id: null, pattern: null, ...over,
} as PersonRow);

const PEOPLE = [
  person("1", "Carla", { department: "Warehouse", shift_group: "Night", headcount_area_id: "l2" }),
  person("2", "ana", { department: "Production", shift_group: "Day", headcount_area_id: "l1" }),
  person("3", "Bruno", { department: null, shift_group: "Day" }),
  person("4", "Diogo", { department: "Production", shift_group: null, headcount_area_id: "l1" }),
];
const AREAS = [{ id: "l1", name: "Line 1" }, { id: "l2", name: "Line 2" }];

const who = () => names().map((n) => ["ana", "Bruno", "Carla", "Diogo"].find((x) => n.startsWith(x)));
const names = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
async function pick(label: RegExp, option: RegExp) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  render(<PeopleTable people={PEOPLE} areas={AREAS} onOpen={() => {}} />);
});
afterEach(cleanup);

describe("Workforce → Employee table", () => {
  it("opens A–Z and flips to Z–A from the Employee header", () => {
    expect(who()).toEqual(["ana", "Bruno", "Carla", "Diogo"]);
    fireEvent.click(screen.getByRole("button", { name: /^Employee/ }));
    expect(who()).toEqual(["Diogo", "Carla", "Bruno", "ana"]);
  });

  it("filters by production line, and by 'Not assigned' to find who has none", async () => {
    await pick(/Filter by production line/i, /^Line 1/);
    expect(names()).toHaveLength(2);
    await pick(/Filter by production line/i, /Not assigned/i);
    expect(names()).toHaveLength(1);
    expect(names()[0]).toMatch(/^Bruno/);
  });

  it("offers 'No department set' and 'No shift set' only because somebody really has none", async () => {
    await pick(/Filter by department/i, /No department set/i);
    expect(names()).toHaveLength(1);
    expect(names()[0]).toMatch(/^Bruno/);
    await pick(/Filter by department/i, /All departments/i);
    await pick(/Filter by shift/i, /No shift set/i);
    expect(names()[0]).toMatch(/^Diogo/);
  });

  it("combines department, shift and line without one resetting another", async () => {
    await pick(/Filter by department/i, /^Production/);
    await pick(/Filter by shift/i, /^Day/);
    await pick(/Filter by production line/i, /^Line 1/);
    expect(names()).toHaveLength(1);
    expect(names()[0]).toMatch(/^ana/);
  });
});
