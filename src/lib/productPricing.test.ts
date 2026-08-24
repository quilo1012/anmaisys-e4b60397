import { describe, it, expect } from "vitest";
import { productWritePayload } from "@/lib/productPricing";

const base = { name: "Bearing", line: "L1", code: "BR-1", quantity: 4, min_stock: 1, category: "spare" };

describe("what a product save is allowed to say about price", () => {
  it("carries the price when the person may set one", () => {
    expect(productWritePayload(base, 12.5, true)).toMatchObject({ price: 12.5 });
  });

  // The trigger fires on the value, not the statement — but only because nothing
  // sends a price it did not mean. `price ?? 0` on a part that had none is a move
  // from NULL to 0, which IS a change, and would refuse an ordinary edit.
  it("omits the key entirely when the person may not — never sends 0", () => {
    const p = productWritePayload(base, 12.5, false);
    expect("price" in p).toBe(false);
  });

  it("omits it when there is no price to send", () => {
    expect("price" in productWritePayload(base, undefined, true)).toBe(false);
    expect("price" in productWritePayload(base, NaN, true)).toBe(false);
  });

  it("leaves every other column alone", () => {
    expect(productWritePayload(base, undefined, false)).toMatchObject(base);
  });
});
