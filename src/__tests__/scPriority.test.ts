import { describe, it, expect } from "vitest";
import { priorityDisplay, priorityRank } from "@/lib/scPriority";

/**
 * A priority a person can read, or an honest admission that nobody has named it.
 *
 * SafetyCulture sends `priority_id` and no name — there is no endpoint that lists
 * priorities — so the three UUIDs in use had to be named by hand once. A fourth will
 * turn up the day somebody adds one in SafetyCulture, and on that day the column must
 * say so rather than print a UUID or quietly show nothing.
 */

describe("priorityDisplay", () => {
  it("shows the name once the UUID has been mapped", () => {
    expect(priorityDisplay({ external_priority: "High", external_priority_id: "u" })).toBe("High");
  });

  it("says a priority arrived that nobody has named", () => {
    // Not the UUID: on screen it looks like data and reads as noise. "Not mapped" is
    // a gap somebody can close on the settings screen.
    expect(priorityDisplay({ external_priority: null, external_priority_id: "0dd-new" }))
      .toBe("Not mapped");
    expect(priorityDisplay({ external_priority: "  ", external_priority_id: "0dd-new" }))
      .toBe("Not mapped");
  });

  it("shows nothing when SafetyCulture sent no priority at all", () => {
    expect(priorityDisplay({})).toBeNull();
    expect(priorityDisplay({ external_priority: null, external_priority_id: null })).toBeNull();
  });
});

describe("priorityRank", () => {
  it("puts the most urgent first", () => {
    expect(["Low", "High", "Medium"].sort((a, b) => priorityRank(a) - priorityRank(b)))
      .toEqual(["High", "Medium", "Low"]);
  });

  it("ignores case and padding", () => {
    expect(priorityRank(" high ")).toBe(priorityRank("High"));
  });

  it("leaves an unranked name after the three, not among them", () => {
    expect(priorityRank("Urgent")).toBeGreaterThan(priorityRank("Low"));
    expect(priorityRank(null)).toBeGreaterThan(priorityRank("Low"));
  });
});
