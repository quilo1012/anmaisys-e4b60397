import { describe, expect, it } from "vitest";
import {
  SKU_IN_USE_MESSAGE, SkuNotChangedError, assertSkuRowsChanged, isSkuInUse, skuDeleteError, skuUpdatePayload,
} from "./skuCatalog";

describe("skuUpdatePayload", () => {
  it("never carries the primary key, so an edit cannot re-key a SKU", () => {
    const payload = skuUpdatePayload({ id: "11111111-1111-1111-1111-111111111111", code: " CRE1KG ", name: "Creatine 1kg" });
    expect(payload).not.toHaveProperty("id");
    expect(payload.code).toBe("CRE1KG");
  });

  it("keeps the active flag the user chose (deactivation is an ordinary edit)", () => {
    expect(skuUpdatePayload({ code: "X", name: "Y", active: false }).active).toBe(false);
    expect(skuUpdatePayload({ code: "X", name: "Y" }).active).toBe(true);
  });
});

describe("a delete refused because production uses the SKU", () => {
  const fk = {
    code: "23503",
    message: 'update or delete on table "sku_products" violates foreign key constraint "production_targets_sku_id_fkey" on table "production_targets"',
  };
  const guard = { code: "23503", message: SKU_IN_USE_MESSAGE };

  it("is recognised from the raw FK error and from the server guard", () => {
    expect(isSkuInUse(fk)).toBe(true);
    expect(isSkuInUse(guard)).toBe(true);
    expect(isSkuInUse({ code: "42501", message: "permission denied for table sku_products" })).toBe(false);
  });

  it("is shown as the plain-language message, never the constraint name", () => {
    expect(skuDeleteError(fk)).toBe(SKU_IN_USE_MESSAGE);
    expect(skuDeleteError(fk)).not.toContain("production_targets_sku_id_fkey");
  });
});

describe("assertSkuRowsChanged", () => {
  it("accepts a write that returned its row", () => {
    expect(() => assertSkuRowsChanged([{ id: "a" }], "save")).not.toThrow();
  });

  it("refuses to call a zero-row write a success (RLS returns 200 [] instead of an error)", () => {
    expect(() => assertSkuRowsChanged([], "save")).toThrow(SkuNotChangedError);
    expect(() => assertSkuRowsChanged(null, "delete")).toThrow(/Nothing was deleted/);
  });
});
