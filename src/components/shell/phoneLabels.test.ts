import { describe, expect, it } from "vitest";
import { shortTitle } from "./MobileAppHeader";
import { tabLabel } from "../MobileTabBar";

describe("phone header title", () => {
  it("names the Headcount with the word that names it", () => {
    expect(shortTitle("Production Headcount")).toBe("Headcount");
  });
  it("still drops a trailing Dashboard and leaves other titles alone", () => {
    expect(shortTitle("Production Dashboard")).toBe("Production");
    expect(shortTitle("Dashboard")).toBe("Dashboard");
    expect(shortTitle("Work Orders")).toBe("Work Orders");
  });
});

describe("phone tab bar labels", () => {
  const maint = { title: "Maintenance Dashboard", shortTitle: "Overview", group: "Maintenance" };
  const prod = { title: "Production Dashboard", shortTitle: "Overview", group: "Production" };
  const perf = { title: "Performance", group: "Production" };

  it("two tabs never carry the same word", () => {
    const tabs = [maint, prod, perf];
    const labels = tabs.map((t) => tabLabel(t, tabs));
    expect(labels).toEqual(["Maintenance", "Production", "Performance"]);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it("a short title with no twin in the bar is kept", () => {
    const tabs = [prod, perf];
    expect(tabs.map((t) => tabLabel(t, tabs))).toEqual(["Overview", "Performance"]);
  });
});
