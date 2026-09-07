import { describe, it, expect } from "vitest";
import { parseAction } from "../../supabase/functions/_shared/safetyculture/parseAction";
import { buildRecord } from "../../supabase/functions/_shared/safetyculture/normalize";

/**
 * Four fields the importer was dropping on the floor.
 *
 * Measured across all 49 imported actions on 07/09/2026:
 *
 *   action_no          0/49    the number the floor reads off SafetyCulture
 *   labels             2/49    and one of those two says "Label", a rule's name
 *   severity           0/49    so every action scores 1 point, all 49 of them
 *   priority as text   0/49    all 49 hold a bare UUID
 *
 * They are four separate causes, not one:
 *
 *   1. `unique_id` — "The human readable unique ID of the task" in the API — was
 *      never read by the parser.
 *   2. The parser DOES read `action_label[].label_name` correctly. `buildRecord`
 *      then threw the result away and wrote `[cls.label]`, the matching rule's own
 *      name. That is why one action reads "Label".
 *   3. Nothing ever set `severity`. It came only from a rule, and none of the 63
 *      rules sets one.
 *   4. The API answers with `priority_id`, a UUID, and carries no human-readable
 *      priority anywhere in the response. Confirmed against the published schema,
 *      not assumed. So the name has to be mapped, and the UUID has to be kept —
 *      it is the only thing SafetyCulture actually said.
 *
 * Together, 2 and 3 are why the Quality screen scores everything at 1 point:
 * `action_points_at` takes GREATEST(label charge, severity grade) and both inputs
 * were empty.
 */

const RAW = {
  task: {
    task_id: "53949fc3-c679-4b98-95eb-b77c803ca40b",
    unique_id: "A-1042",
    title: "Mixed Labels Supplied from Warehouse to Production (L4/Warehouse)",
    description: "Two batches on the same pallet.",
    priority_id: "ce87c58a-eeb2-4fde-9dc4-c6e85f1f4055",
    created_at: "2026-09-06T07:19:47Z",
    due_at: "2026-09-13T07:19:47Z",
    status: { key: "TO_DO" },
    site: { name: "Production" },
    asset: { code: "L4-FILLER" },
    action_label: [
      { label_id: "1", label_name: "Paperwork" },
      { label_id: "2", label_name: "Batch code" },
    ],
    collaborators: [
      { assigned_role: "ASSIGNEE", user: { firstname: "Ramao", lastname: "Junior" } },
      { assigned_role: "ASSIGNEE", group: { name: "Quality Control" } },
      { assigned_role: "VIEWER", user: { firstname: "Nobody", lastname: "Here" } },
    ],
  },
};

describe("parseAction reads what SafetyCulture actually sends", () => {
  it("keeps the human-readable action number", () => {
    // The `#` column on the Quality screen was empty on every row because nothing
    // ever looked at this field.
    expect(parseAction(RAW)?.unique_id).toBe("A-1042");
  });

  it("keeps the priority UUID apart from a priority NAME", () => {
    const a = parseAction(RAW);
    // The id is what the API sent; it is never shown to a person as-is.
    expect(a?.priority_id).toBe("ce87c58a-eeb2-4fde-9dc4-c6e85f1f4055");
    // And it is NOT passed off as a name. Before this, `priority` held the UUID and
    // the screen had nowhere to get "High" from.
    expect(a?.priority).toBeNull();
  });

  it("takes a real priority name when one is sent", () => {
    // The actions feed carries a readable priority. If we ever read from it, or the
    // API starts sending one, it must be used rather than treated as an id.
    const a = parseAction({ task: { ...RAW.task, priority: "High" } });
    expect(a?.priority).toBe("High");
    expect(a?.priority_id).toBe("ce87c58a-eeb2-4fde-9dc4-c6e85f1f4055");
  });

  it("reads every label SafetyCulture put on the action", () => {
    expect(parseAction(RAW)?.labels).toEqual(["Paperwork", "Batch code"]);
  });

  it("takes only the people actually assigned", () => {
    expect(parseAction(RAW)?.assignees).toEqual(["Ramao Junior", "Quality Control"]);
  });
});

const OPTS = {
  lineNames: ["Line 4"],
  rules: [],
  leaderFor: () => ({ id: "leader-marcio", name: "Marcio" }),
  now: "2026-09-07T08:00:00Z",
};

describe("buildRecord keeps what the action carried", () => {
  it("stores the action number", () => {
    const { draft } = buildRecord(parseAction(RAW)!, OPTS);
    expect(draft.action_no).toBe("A-1042");
  });

  it("keeps SafetyCulture's own labels", () => {
    // This is the bug that made every action score 1: `action_points_at` charges by
    // label, and the labels never arrived.
    const { draft } = buildRecord(parseAction(RAW)!, OPTS);
    expect(draft.labels).toEqual(["Paperwork", "Batch code"]);
  });

  it("adds a rule's label without losing the real ones", () => {
    const { draft } = buildRecord(parseAction(RAW)!, {
      ...OPTS,
      rules: [{
        id: "r1", name: "Paperwork rule", match_field: "title", match_value: "Mixed Labels",
        match_mode: "contains", label: "GMP", priority: 10, active: true,
      }],
    });
    expect(draft.labels).toEqual(["Paperwork", "Batch code", "GMP"]);
  });

  it("does not repeat a label the action already had", () => {
    const { draft } = buildRecord(parseAction(RAW)!, {
      ...OPTS,
      rules: [{
        id: "r1", name: "dup", match_field: "title", match_value: "Mixed Labels",
        match_mode: "contains", label: "paperwork", priority: 10, active: true,
      }],
    });
    expect(draft.labels).toEqual(["Paperwork", "Batch code"]);
  });

  it("turns the priority into a name and a severity", () => {
    const { draft } = buildRecord(parseAction(RAW)!, {
      ...OPTS,
      priorityOf: (id: string) =>
        id === "ce87c58a-eeb2-4fde-9dc4-c6e85f1f4055"
          ? { name: "Medium", severity: "medium" }
          : null,
    });
    expect(draft.external_priority).toBe("Medium");
    expect(draft.external_priority_id).toBe("ce87c58a-eeb2-4fde-9dc4-c6e85f1f4055");
    // severity is what `action_points_at` grades on: medium = 3 points.
    expect(draft.severity).toBe("medium");
  });

  it("leaves the name empty rather than showing a UUID nobody can read", () => {
    // An unmapped priority is a gap for a person to close on the settings screen,
    // not something to paper over by printing the id.
    const { draft } = buildRecord(parseAction(RAW)!, OPTS);
    expect(draft.external_priority).toBeNull();
    expect(draft.external_priority_id).toBe("ce87c58a-eeb2-4fde-9dc4-c6e85f1f4055");
    expect(draft.severity).toBeNull();
  });

  it("lets a rule's severity win over the priority's", () => {
    // Quality grading a specific finding beats a blanket priority: the rule was
    // written about this kind of error, the priority was a default on the template.
    const { draft } = buildRecord(parseAction(RAW)!, {
      ...OPTS,
      priorityOf: () => ({ name: "Low", severity: "low" }),
      rules: [{
        id: "r1", name: "metal", match_field: "title", match_value: "Mixed Labels",
        match_mode: "contains", severity: "critical", priority: 10, active: true,
      }],
    });
    expect(draft.severity).toBe("critical");
  });

  it("keeps the description", () => {
    const { draft } = buildRecord(parseAction(RAW)!, OPTS);
    expect(draft.description).toBe("Two batches on the same pallet.");
  });
});
