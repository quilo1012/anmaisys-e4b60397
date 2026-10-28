import { describe, expect, it } from "vitest";
import { skuUpdatePayload, skuDeleteError } from "./skuCatalog";
describe("SKU relationship preservation", () => {
  it("never includes the existing primary key in editable attributes", () => {
    const payload = skuUpdatePayload({ id: "original-id", code: " ABC ", name: "Edited" });
    expect(payload).not.toHaveProperty("id");
    expect(payload.code).toBe("ABC");
    expect(payload.name).toBe("Edited");
  });
  it("retirement changes active without changing identity or production attributes", () => {
    const before = { id: "original-id", code: "ABC", name: "Product", target_per_hour: 240, active: true };
    expect(skuUpdatePayload({ ...before, active: false })).toEqual({ ...skuUpdatePayload(before), active: false });
  });
  it("recognizes foreign-key protection without masking other failures", () => {
    expect(skuDeleteError({ code: "23503", message: "production_targets_sku_id_fkey" })).toContain("Deactivate");
    expect(skuDeleteError({ code: "42501", message: "Forbidden" })).toBe("Forbidden");
  });
});