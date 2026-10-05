import { describe, it, expect } from "vitest";
import {
  classifyAction,
  type ClassificationRuleV2,
  type ClassificationInput,
} from "../../supabase/functions/_shared/safetyculture/classification";

/**
 * AC-6706: "Wrong label version used (L3/warehouse)", filed on Line 2.
 *
 * `resolveLine` runs the alias rules in priority order. In `sc_classification_rules`
 * the L1–L6 rules on the inspection custom field sit at priority 5 and the identical
 * rules on the title sit at 10, so the inspection always wins and the title is never
 * consulted. Correct when they agree. A silent guess when they do not — and the record
 * came out of it reading `line: "Line 2"`, charged to that line's leader, with
 * `checks.line` reporting "ok".
 *
 * The Rules gate in the same function already states the principle: two rules that
 * disagree are not resolved by priority, because whichever won would be a guess and
 * the priority field is for ordering, not arbitration. This is that rule applied to
 * the line, which is the field the charge actually hangs off.
 *
 * Measured against production on 04/10/2026 over the 311 synced actions: 161 titles
 * name a line, and exactly one disagrees with the line on the record. The review queue
 * gains one row, and it is the row nothing was saying anything about.
 */

const PRODUCTION = { site: "Production" };

const LINE_ALIASES: ClassificationRuleV2[] = [
  // Exactly as the table holds them: the custom field first, the title second.
  { id: "cf-l2", name: "L2 (inspection)", match_field: "custom_field", match_key: "inspection", match_value: "(^|[^a-z0-9])L2([^0-9]|$)", match_mode: "regex", line_name: "Line 2", priority: 5 },
  { id: "cf-l3", name: "L3 (inspection)", match_field: "custom_field", match_key: "inspection", match_value: "(^|[^a-z0-9])L3([^0-9]|$)", match_mode: "regex", line_name: "Line 3", priority: 5 },
  { id: "t-l2", name: "L2 (title)", match_field: "title", match_value: "(^|[^a-z0-9])L2([^0-9]|$)", match_mode: "regex", line_name: "Line 2", priority: 10 },
  { id: "t-l3", name: "L3 (title)", match_field: "title", match_value: "(^|[^a-z0-9])L3([^0-9]|$)", match_mode: "regex", line_name: "Line 3", priority: 10 },
];

const everyonePresent = () => "present" as const;

function input(over: Partial<ClassificationInput> = {}): ClassificationInput {
  return {
    ...PRODUCTION,
    actionDate: "2026-09-22T13:30:00Z",
    dueDate: null,
    // What `resolveLine` chose, from the inspection, at priority 5.
    line: "Line 2",
    leader: { id: "leader-guilherme", name: "Guilherme" },
    errorType: "Wrong label",
    department: null,
    labels: ["Label"],
    workers: ["Guilherme"],
    title: "Wrong label version used (L3/warehouse)",
    description: null,
    priority: null,
    asset: null,
    template: null,
    ...over,
  };
}

describe("a title naming another line is not settled by precedence", () => {
  it("sends AC-6706 to review instead of charging Line 2", () => {
    const out = classifyAction(input(), LINE_ALIASES, { attendance: everyonePresent });
    expect(out.classification).toBe("needs_review");
    expect(out.reasons).toContain("line_conflict");
  });

  it("stops the line check reporting ok on a line the title contradicts", () => {
    // The defect as a reviewer met it: the record was in the queue for an unrelated
    // reason — site missing, attendance unknown — and the one check that was wrong
    // was the one saying it was fine.
    const out = classifyAction(input(), LINE_ALIASES, { attendance: everyonePresent });
    expect(out.checks.line).toBe("failed");
  });

  it("says nothing when the two agree", () => {
    const out = classifyAction(
      input({ title: "Wrong label version used (L2/warehouse)" }),
      LINE_ALIASES,
      { attendance: everyonePresent },
    );
    expect(out.checks.line).toBe("ok");
    expect(out.reasons).not.toContain("line_conflict");
    expect(out.classification).not.toBe("needs_review");
  });

  it("says nothing when the title names no line at all", () => {
    // 150 of the 311 synced titles. A title that is silent is not a title that
    // disagrees, and reading it as one would put half the sync into review.
    const out = classifyAction(
      input({ title: "Tubs contaminated with blood" }),
      LINE_ALIASES,
      { attendance: everyonePresent },
    );
    expect(out.checks.line).toBe("ok");
    expect(out.reasons).not.toContain("line_conflict");
  });

  it("reads only the title, not the inspection it is being compared against", () => {
    // Pointed the other way round: the inspection says L3 and so does the title. A
    // rule on the custom field must never be mistaken for the title's opinion.
    const out = classifyAction(
      input({ line: "Line 3", title: "Wrong label version used (L3/warehouse)" }),
      LINE_ALIASES,
      { attendance: everyonePresent },
    );
    expect(out.reasons).not.toContain("line_conflict");
  });

  it("still refuses a line it could not identify, for the reason it always gave", () => {
    const out = classifyAction(
      input({ line: null, department: null, title: "Something went wrong" }),
      LINE_ALIASES,
      { attendance: everyonePresent },
    );
    expect(out.reasons).toContain("line_not_identified");
    expect(out.reasons).not.toContain("line_conflict");
  });

  it("does not shadow the leader gates when the title agrees", () => {
    // The two older refusals on this gate have to keep working: a conflict check that
    // swallowed them would hide a line with nobody accountable on it.
    const unsigned = classifyAction(
      input({ title: "Wrong label version used (L2/warehouse)", leader: null, leaderSource: "session_unsigned" }),
      LINE_ALIASES,
      { attendance: everyonePresent },
    );
    expect(unsigned.reasons).toContain("leader_session_unsigned");

    const missing = classifyAction(
      input({ title: "Wrong label version used (L2/warehouse)", leader: null }),
      LINE_ALIASES,
      { attendance: everyonePresent },
    );
    expect(missing.reasons).toContain("leader_not_found_for_line");
  });
});
