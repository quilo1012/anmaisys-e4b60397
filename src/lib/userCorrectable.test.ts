import { describe, it, expect } from "vitest";
import { constraintFrom, isUserCorrectable } from "@/lib/userCorrectable";

describe("constraintFrom", () => {
  it("reads the name out of the ways Postgres says it", () => {
    expect(constraintFrom('duplicate key value violates unique constraint "sku_products_code_key"'))
      .toBe("sku_products_code_key");
    expect(constraintFrom('new row for relation "orders" violates check constraint "orders_qty_positive"'))
      .toBe("orders_qty_positive");
    expect(constraintFrom('insert or update on table "a" violates foreign key constraint "a_b_fkey"'))
      .toBe("a_b_fkey");
  });

  it("is null when nothing names a constraint", () => {
    expect(constraintFrom("permission denied for table employees")).toBeNull();
    expect(constraintFrom("")).toBeNull();
    expect(constraintFrom(undefined)).toBeNull();
  });
});

describe("isUserCorrectable", () => {
  it("knows the SKU code somebody typed twice", () => {
    // Handled on the screen since #406: the toast says it is already on the list and
    // the field names the SKU holding the code. Worth recording, not worth alarming.
    expect(isUserCorrectable('duplicate key value violates unique constraint "sku_products_code_key"'))
      .toBe(true);
  });

  it("does NOT excuse the leader constraint", () => {
    // The anchor of this whole file. `daily_allocations_one_leader_per_area` is also a
    // 23505 and was also "already handled" in somebody's view of it — and it was a real
    // defect that ran for weeks: a supervisor dragging a card could do nothing to avoid
    // it. If a future entry ever silences this one, this test fails and says why.
    expect(isUserCorrectable('duplicate key value violates unique constraint "daily_allocations_one_leader_per_area"'))
      .toBe(false);
  });

  it("treats a constraint nobody has ruled on as a fault", () => {
    // The default direction. A new constraint is noisy until somebody decides it is
    // the user's to fix — the safe way round, because the cost of a false alarm is a
    // line in a list and the cost of a false silence is weeks.
    expect(isUserCorrectable('duplicate key value violates unique constraint "something_new_key"'))
      .toBe(false);
    expect(isUserCorrectable("permission denied for table employees")).toBe(false);
  });
});
