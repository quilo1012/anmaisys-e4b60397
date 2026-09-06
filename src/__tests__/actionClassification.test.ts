import { describe, it, expect } from "vitest";
import {
  classifyAction,
  londonDay,
  type ClassificationRuleV2,
  type ClassificationInput,
} from "../../supabase/functions/_shared/safetyculture/classification";

/**
 * What this file is defending.
 *
 * The Quality screen showed "Line 4 — Rafael Tosta — 06/09/2026" as a settled fact.
 * Three separate things had to be true for that row to be honest, and the importer
 * checked none of them:
 *
 *   1. that the finding was raised inside Production at all (nine of the forty-nine
 *      imported records came from site "External" and were counted anyway);
 *   2. that 06/09 was the day the finding was RAISED, not the day it falls due;
 *   3. that Rafael was on the floor that day, and that Line 4 was his that day.
 *
 * The third is the one that bites, because the evidence for it is thin in a way that
 * is easy to misread. `employee_attendance` stops on 2026-09-03 and covers about
 * fifty of two hundred and thirty-one people on the days it does have. So "no row
 * saying he was there" and "a row saying he was away" are NOT the same statement,
 * and a classifier that treats them as one either sends every recent action to
 * review (if silence means absent) or keeps inventing attributions (if silence
 * means present).
 *
 * Hence three states, not two. Only a contradiction blocks; a gap is reported.
 */

const PRODUCTION: Pick<ClassificationInput, "site"> = { site: "Production" };

function input(over: Partial<ClassificationInput> = {}): ClassificationInput {
  return {
    ...PRODUCTION,
    actionDate: "2026-09-06T08:00:00Z",
    dueDate: "2026-09-13T09:23:00Z",
    line: "Line 4",
    leader: { id: "leader-rafael", name: "Rafael Tosta" },
    errorType: "Missing signature or time",
    department: null,
    labels: ["Paperwork"],
    workers: ["Rafael Tosta"],
    title: "Missing the last check on Line 4",
    description: null,
    priority: "High",
    asset: null,
    template: null,
    ...over,
  };
}

const NO_RULES: ClassificationRuleV2[] = [];

/** Nobody has any attendance recorded — the state the factory is actually in. */
const noAttendance = () => "unknown" as const;
const everyonePresent = () => "present" as const;
const everyoneAway = () => "absent" as const;

describe("site is the first gate", () => {
  it("excludes anything raised outside Production", () => {
    const out = classifyAction(input({ site: "External" }), NO_RULES, {
      attendance: everyonePresent,
    });
    expect(out.classification).toBe("excluded");
    expect(out.checks.site).toBe("failed");
    expect(out.reasons).toContain("site_not_production");
  });

  it("matches the site name regardless of case or padding", () => {
    const out = classifyAction(input({ site: "  production " }), NO_RULES, {
      attendance: everyonePresent,
    });
    expect(out.checks.site).toBe("ok");
    expect(out.classification).not.toBe("excluded");
  });

  it("does not EXCLUDE a record whose site is simply missing", () => {
    // Two imported records carry no site at all. Excluding them would delete them
    // from the operational view on the strength of an absent field; a human should
    // look instead.
    const out = classifyAction(input({ site: null }), NO_RULES, {
      attendance: everyonePresent,
    });
    expect(out.classification).toBe("needs_review");
    expect(out.checks.site).toBe("unknown");
    expect(out.reasons).toContain("site_missing");
  });
});

describe("the action date is the date it was raised", () => {
  it("never falls back to the due date", () => {
    const out = classifyAction(
      input({ actionDate: null, dueDate: "2026-09-13T09:23:00Z" }),
      NO_RULES,
      { attendance: everyonePresent },
    );
    expect(out.classification).toBe("needs_review");
    expect(out.checks.action_date).toBe("unknown");
    expect(out.reasons).toContain("action_date_missing");
    expect(out.actionDay).toBeNull();
  });

  it("reads the day in Europe/London, not UTC", () => {
    // 22:30 in London on 6 July is 21:30 UTC — a UTC read puts it on the same day,
    // so the case that separates them is the other side of midnight.
    expect(londonDay("2026-07-06T23:30:00Z")).toBe("2026-07-07");
    expect(londonDay("2026-01-06T23:30:00Z")).toBe("2026-01-06");
  });

  it("refuses a due date that precedes the action date", () => {
    const out = classifyAction(
      input({ actionDate: "2026-09-06T08:00:00Z", dueDate: "2026-09-01T08:00:00Z" }),
      NO_RULES,
      { attendance: everyonePresent },
    );
    expect(out.classification).toBe("needs_review");
    expect(out.reasons).toContain("due_before_action_date");
  });
});

describe("the worker check has three answers, not two", () => {
  it("blocks when attendance CONTRADICTS the attribution", () => {
    const out = classifyAction(input(), NO_RULES, { attendance: everyoneAway });
    expect(out.classification).toBe("needs_review");
    expect(out.checks.worker).toBe("failed");
    expect(out.reasons).toContain("worker_absent_on_action_date");
  });

  it("does not block when attendance is merely SILENT", () => {
    // The Rafael Tosta case as the data actually stands: no row for 2026-09-06 for
    // anybody. Silence is not evidence of absence, and treating it as such empties
    // the screen of every action raised in the last three days.
    const out = classifyAction(input(), NO_RULES, { attendance: noAttendance });
    expect(out.checks.worker).toBe("unknown");
    expect(out.classification).not.toBe("needs_review");
    expect(out.reasons).toContain("worker_attendance_unknown");
  });

  it("blocks on silence when the caller asks for the strict reading", () => {
    const out = classifyAction(input(), NO_RULES, {
      attendance: noAttendance,
      requireWorkerEvidence: true,
    });
    expect(out.classification).toBe("needs_review");
    expect(out.checks.worker).toBe("unknown");
  });

  it("one assignee on the floor is enough — a QC mailbox is not evidence of absence", () => {
    const out = classifyAction(
      input({ workers: ["Quality Control", "Rafael Tosta"] }),
      NO_RULES,
      {
        attendance: (worker) => (worker === "Rafael Tosta" ? "present" : "absent"),
      },
    );
    expect(out.checks.worker).toBe("ok");
  });
});

describe("a line needs a leader who held it on the day", () => {
  it("sends a line with nobody accountable to review", () => {
    const out = classifyAction(input({ leader: null }), NO_RULES, {
      attendance: everyonePresent,
    });
    expect(out.classification).toBe("needs_review");
    expect(out.checks.line).toBe("unknown");
    expect(out.reasons).toContain("leader_not_found_for_line");
  });

  it("classifies as a quality error when there is no line but there is a department", () => {
    const out = classifyAction(
      input({ line: null, leader: null, department: "Warehouse" }),
      NO_RULES,
      { attendance: everyonePresent },
    );
    expect(out.classification).toBe("quality_error");
    expect(out.checks.line).toBe("unknown");
  });

  it("sends a record with neither line nor department to review", () => {
    const out = classifyAction(
      input({ line: null, leader: null, department: null, errorType: null }),
      NO_RULES,
      { attendance: everyonePresent },
    );
    expect(out.classification).toBe("needs_review");
    expect(out.reasons).toContain("line_not_identified");
  });
});

describe("what a validated line action is charged to", () => {
  it("is the leader when the label is one the leader answers for", () => {
    const out = classifyAction(input({ labels: ["Paperwork"] }), NO_RULES, {
      attendance: everyonePresent,
    });
    expect(out.classification).toBe("leader");
  });

  it("is the line when the label is one the leader does not answer for", () => {
    // `quality_label_attribution` already says a machine failure is not the shift
    // leader's doing. The classifier reads that table rather than repeating it.
    const out = classifyAction(input({ labels: ["Maintenance"] }), NO_RULES, {
      attendance: everyonePresent,
      countsAgainstLeader: (label) => label !== "Maintenance",
    });
    expect(out.classification).toBe("line");
  });

  it("is the line when no error type was ever worked out", () => {
    const out = classifyAction(input({ errorType: null }), NO_RULES, {
      attendance: everyonePresent,
    });
    expect(out.classification).toBe("line");
  });
});

describe("rules decide, and say which one decided", () => {
  const lineRule: ClassificationRuleV2 = {
    id: "rule-1",
    name: "Production Line Action",
    match_field: "label",
    match_value: "Paperwork",
    match_mode: "contains",
    classification: "line",
    priority: 10,
    active: true,
  };

  it("records the rule that matched", () => {
    const out = classifyAction(input(), [lineRule], { attendance: everyonePresent });
    expect(out.classification).toBe("line");
    expect(out.matched_rule_ids).toEqual(["rule-1"]);
    expect(out.matched_rule_names).toEqual(["Production Line Action"]);
  });

  it("ignores a rule that is switched off", () => {
    const out = classifyAction(input(), [{ ...lineRule, active: false }], {
      attendance: everyonePresent,
    });
    expect(out.matched_rule_ids).toEqual([]);
    // Falls back to the default reading, which charges Paperwork to the leader.
    expect(out.classification).toBe("leader");
  });

  it("sends two rules that disagree to review instead of picking one", () => {
    const qualityRule: ClassificationRuleV2 = {
      id: "rule-2",
      name: "Documentation Error",
      match_field: "title",
      match_value: "missing the last check",
      match_mode: "contains",
      classification: "quality_error",
      priority: 10,
      active: true,
    };
    const out = classifyAction(input(), [lineRule, qualityRule], {
      attendance: everyonePresent,
    });
    expect(out.classification).toBe("needs_review");
    expect(out.reasons).toContain("rule_conflict");
    expect(out.conflict?.classes.sort()).toEqual(["line", "quality_error"]);
    expect(out.conflict?.rules.sort()).toEqual(["Documentation Error", "Production Line Action"]);
  });

  it("is not a conflict when two rules agree", () => {
    const second: ClassificationRuleV2 = {
      ...lineRule,
      id: "rule-3",
      name: "Line 4 paperwork",
      match_field: "title",
      match_value: "Line 4",
      match_mode: "contains",
      priority: 20,
    };
    const out = classifyAction(input(), [lineRule, second], {
      attendance: everyonePresent,
    });
    expect(out.classification).toBe("line");
    expect(out.matched_rule_ids.sort()).toEqual(["rule-1", "rule-3"]);
    expect(out.conflict).toBeNull();
  });

  it("does not let a rule rescue a record that failed an earlier gate", () => {
    // The order in the spec is site → date → worker → line → rules. A rule naming a
    // classification cannot put an External record back on the operational screen.
    const out = classifyAction(input({ site: "External" }), [lineRule], {
      attendance: everyonePresent,
    });
    expect(out.classification).toBe("excluded");
  });

  it("survives a rule whose regex does not compile", () => {
    const broken: ClassificationRuleV2 = {
      ...lineRule,
      id: "rule-bad",
      match_mode: "regex",
      match_value: "([unclosed",
    };
    expect(() =>
      classifyAction(input(), [broken], { attendance: everyonePresent }),
    ).not.toThrow();
    const out = classifyAction(input(), [broken], { attendance: everyonePresent });
    expect(out.matched_rule_ids).toEqual([]);
  });
});

describe("the case this was written for", () => {
  it("does not present Line 4 / Rafael Tosta / 06-09-2026 as settled when he is recorded away", () => {
    const out = classifyAction(input(), NO_RULES, { attendance: everyoneAway });
    expect(out.classification).toBe("needs_review");
    expect(out.actionDay).toBe("2026-09-06");
    expect(out.checks).toMatchObject({ site: "ok", action_date: "ok", worker: "failed" });
  });

  it("still names the day correctly when the attendance table simply has no answer", () => {
    const out = classifyAction(input(), NO_RULES, { attendance: noAttendance });
    expect(out.actionDay).toBe("2026-09-06");
    expect(out.checks.worker).toBe("unknown");
  });
});
