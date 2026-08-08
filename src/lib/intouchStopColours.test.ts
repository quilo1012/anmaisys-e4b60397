import { describe, it, expect } from "vitest";
import { stopColour, isAmbiguousStop, ITOUCH_RUNNING, STOP_COLOUR_GROUPS } from "./intouchStopColours";

describe("stopColour", () => {
  it("matches the three codes checked against the panel's own pixels", () => {
    expect(stopColour("No Planned Shift")).toBe("#A9BC15");
    expect(stopColour("Breaks")).toBe("#1DE9ED");
    expect(stopColour("Brushing and Cleaning")).toBe("#7030A0");
  });

  it("groups faults, alarms and waiting apart from each other", () => {
    expect(stopColour("Filler Fault")).toBe("#E36C09");
    expect(stopColour("Blender Fault")).toBe("#FF0000");
    expect(stopColour("Quality Issue")).toBe("#FFC000");
  });

  it("keeps red for the two codes iTouching reserves it for", () => {
    const red = STOP_COLOUR_GROUPS.find((g) => g.colour === "#FF0000");
    expect(red?.label).toBe("Alarm / blender fault");
    expect(stopColour("Alarm")).toBe("#FF0000");
    expect(stopColour("Electrical Issue")).not.toBe("#FF0000");
  });

  it("reads the blending code with or without the stray space iTouching sends", () => {
    // The API returns "Filling Blender/ Blending"; the configuration lists it as
    // "Filling Blender/Blending". Same stop.
    expect(stopColour("Filling Blender/ Blending")).toBe("#7030A0");
    expect(stopColour("Filling Blender/Blending")).toBe("#7030A0");
  });

  it("is not confused by case or extra whitespace", () => {
    expect(stopColour("  deep   clean ")).toBe("#00B0F0");
    expect(stopColour("BREAKS")).toBe("#1DE9ED");
  });

  it("has no colour for a code it has never been told about", () => {
    expect(stopColour("Something Nobody Configured")).toBeNull();
    expect(stopColour(null)).toBeNull();
    expect(stopColour("")).toBeNull();
  });
});

describe("the two Metal Detected codes", () => {
  it("says it cannot tell them apart", () => {
    // id 59 is amber and id 81 is orange in iTouching, and our stop-code map is
    // keyed by GUID while the catalogue is keyed by an integer id — only the name
    // joins them, and the name is the same.
    expect(isAmbiguousStop("Metal Detected")).toBe(true);
    expect(stopColour("Metal Detected")).toBe("#FFC000");
  });

  it("does not mark the checks code as ambiguous — that one is unique", () => {
    expect(isAmbiguousStop("Metal Detector Checks")).toBe(false);
    expect(stopColour("Metal Detector Checks")).toBe("#E88787");
  });
});

describe("the running colour", () => {
  it("comes from iTouching's legend, not from the stop palette", () => {
    expect(ITOUCH_RUNNING).toBe("#00C000");
    expect(STOP_COLOUR_GROUPS.some((g) => g.colour === ITOUCH_RUNNING)).toBe(false);
  });
});

describe("the legend", () => {
  it("lists every distinct colour exactly once", () => {
    const colours = STOP_COLOUR_GROUPS.map((g) => g.colour);
    expect(new Set(colours).size).toBe(colours.length);
  });
});
