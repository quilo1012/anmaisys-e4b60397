import { describe, expect, it } from "vitest";
import { filterByDomain } from "@/lib/actionDomain";

const q = { id: "1", domain: "quality" };
const s = { id: "2", domain: "safety" };
const old = { id: "3" }; // gravada antes da coluna existir

describe("filterByDomain", () => {
  it("shows only what the tab is about", () => {
    expect(filterByDomain([q, s], "quality").map((a) => a.id)).toEqual(["1"]);
    expect(filterByDomain([q, s], "safety").map((a) => a.id)).toEqual(["2"]);
  });

  it("shows both under All", () => {
    expect(filterByDomain([q, s], "all")).toHaveLength(2);
  });

  it("reads a row with no domain as quality, so nothing already logged disappears", () => {
    expect(filterByDomain([old], "quality").map((a) => a.id)).toEqual(["3"]);
    expect(filterByDomain([old], "safety")).toHaveLength(0);
  });
});
