import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRecord,
  classify,
  mapStatus,
  resolveLine,
  type ClassificationRule,
  type ScAction,
} from "../_shared/safetyculture/normalize.ts";

const LINES = ["C1", "C10", "Line 3", "B2"];

const action = (over: Partial<ScAction> = {}): ScAction => ({
  id: "abc-123",
  title: "Missing spec check - C1",
  description: null,
  status: "in progress",
  priority: "high",
  created_at: "2026-09-06T08:00:00Z",
  modified_at: "2026-09-06T09:00:00Z",
  due_at: null,
  assignee: "Ana",
  labels: [],
  site: null,
  asset: null,
  template: null,
  custom_fields: {},
  ...over,
});

const RULES: ClassificationRule[] = [
  {
    match_field: "label",
    match_value: "Labels",
    match_mode: "equals",
    category: "Labels",
    label: "Label",
    priority: 10,
  },
  {
    match_field: "title",
    match_value: "missing spec",
    match_mode: "contains",
    category: "Labels",
    error_type: "Missing spec",
    label: "Label",
    priority: 90,
  },
];

Deno.test("a line is only matched on a token boundary", () => {
  assertEquals(resolveLine(action({ title: "Problem on C10 today" }), LINES), "C10");
  assertEquals(resolveLine(action({ title: "Problem on C1 today" }), LINES), "C1");
  // "AC1" is not line C1.
  assertEquals(resolveLine(action({ title: "AC1 unit noisy" }), LINES), null);
});

Deno.test("structured fields are read before the title", () => {
  // An explicit line field wins over anything written in the title.
  const a = action({
    custom_fields: { line: "B2" },
    title: "Missing spec check - C1",
  });
  assertEquals(resolveLine(a, LINES), "B2");

  // The site, though, is where the work happened and not always the line, so a
  // line named in the title is trusted ahead of it.
  const b = action({ site: "B2", title: "Missing spec check - C1" });
  assertEquals(resolveLine(b, LINES), "C1");
});

Deno.test("a rule can name the line a shorthand refers to", () => {
  const rules = [{
    match_field: "title" as const,
    match_value: "(^|[^a-z0-9])L4([^0-9]|$)",
    match_mode: "regex" as const,
    line_name: "C1",
    priority: 10,
  }];
  assertEquals(resolveLine(action({ title: "Missing checks (L4)" }), LINES, rules), "C1");
});

Deno.test("a structured label beats the title rule and nothing is guessed", () => {
  const withLabel = classify(action({ labels: ["Labels"] }), RULES);
  assertEquals(withLabel.category, "Labels");
  assertEquals(withLabel.error_type, "Missing spec"); // title rule still fills the gap

  const unknown = classify(action({ title: "Something else entirely" }), RULES);
  assertEquals(unknown.matched, false);
  assertEquals(unknown.category, null);
  assertEquals(unknown.error_type, null);
});

Deno.test("status maps onto the record lifecycle", () => {
  assertEquals(mapStatus("Completed").status, "complete");
  assertEquals(mapStatus("in progress").status, "in_progress");
  assertEquals(mapStatus(null).status, "todo");
});

Deno.test("an action nobody can attribute is flagged, not invented", () => {
  const { draft, problems } = buildRecord(action({ title: "Broken tap" }), {
    lineNames: LINES,
    rules: RULES,
    leaderFor: () => ({ id: "leader-1", name: "Rui" }),
    now: "2026-09-06T10:00:00Z",
  });
  assertEquals(draft.line, null);
  assertEquals(draft.leader_id, null);
  assertEquals(draft.needs_classification, true);
  assertEquals(problems.includes("line_not_identified"), true);
});

Deno.test("a complete action carries its leader and external link", () => {
  const { draft, problems } = buildRecord(action(), {
    lineNames: LINES,
    rules: RULES,
    leaderFor: (line) => (line === "C1" ? { id: "leader-1", name: "Rui" } : null),
    now: "2026-09-06T10:00:00Z",
  });
  assertEquals(problems, []);
  assertEquals(draft.line, "C1");
  assertEquals(draft.leader_name, "Rui");
  assertEquals(draft.error_type, "Missing spec");
  assertEquals(draft.status, "in_progress");
  assertEquals(draft.external_id, "abc-123");
  assertEquals(draft.external_url, "https://app.safetyculture.com/tasks/actions/abc-123");
  assertEquals(draft.needs_classification, false);
});
