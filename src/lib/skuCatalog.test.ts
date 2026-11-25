import { describe, expect, it } from "vitest";
import { skuUpdatePayload, skuDeleteError, editedAllergens } from "./skuCatalog";
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

describe("SKU allergens", () => {
  it("includes confirmed allergens in an existing SKU update without changing its ID", () => {
    const payload = skuUpdatePayload({ id: "original-id", code: "ABC", name: "Product", allergens: editedAllergens("Milk, Gluten, Milk", true) });
    expect(payload.allergens).toEqual(["Milk", "Gluten"]);
    expect(payload).not.toHaveProperty("id");
  });
  it("does not confirm an untouched unknown product", () => {
    expect(skuUpdatePayload({ allergens: editedAllergens(null, null, null) })).not.toHaveProperty("allergens");
  });
  it("distinguishes confirmed none from not confirmed", () => {
    expect(editedAllergens("", true)).toEqual([]);
    expect(editedAllergens("Milk", false, ["Milk"])).toBeNull();
  });
});