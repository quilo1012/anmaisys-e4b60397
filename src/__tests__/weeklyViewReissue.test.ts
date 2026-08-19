import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 20260826090000 re-issues `v_leader_weekly_scorecard` whole — 220 lines of it — to add
 * one lateral join and change three expressions.
 *
 * A re-issue that size is only trustworthy if the untouched part can be shown to be
 * untouched. A single character altered by accident in the volume band, the H&S
 * evaluation or the threshold pivot would change what every leader's week is worth, it
 * would apply cleanly, and nothing would report it. The migration's header claims the
 * body was generated from the previous definition rather than retyped; this is that
 * claim, checked.
 *
 * It does not re-derive the transformation, which would be circular. It asserts the
 * weaker and more useful thing: every line of the definition in force still appears,
 * verbatim, in the new one — except the three that were deliberately replaced.
 */

const root = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(root, "supabase/migrations", f), "utf8");

/** The view body, from CREATE to the final `AS sc;`. */
function viewBody(sql: string): string {
  const start = sql.indexOf("CREATE OR REPLACE VIEW public.v_leader_weekly_scorecard\n");
  const marker = "t.cap_gate, t.cap_not_done, t.cap_hs_amber) AS sc;";
  const end = sql.indexOf(marker) + marker.length;
  if (start === -1 || end < marker.length) throw new Error("view body not found");
  return sql.slice(start, end);
}

const OLD = viewBody(read("20260818090000_a_gate_is_a_ceiling_not_a_weight.sql"));
const NEW = viewBody(read("20260826090000_the_weekly_row_learns_about_the_actions.sql"));

/**
 * The three lines the re-issue deliberately replaces. Anything else that stops matching
 * is drift, and drift here is silent.
 */
const REPLACED = [
  "  public.scorecard_overall_rag(v.volume_rag, q.quality_rag, (h.eval).rag) AS overall_rag,",
  "  sc.score_final,",
  "  sc.cap_reason,",
  "  (sc.cap_reason IS NOT NULL) AS cap_applied,",
];

describe("the weekly view re-issue changes only what it says it changes", () => {
  it("keeps every other line of the definition in force, verbatim", () => {
    const newLines = new Set(NEW.split("\n"));
    const missing = OLD.split("\n")
      .filter((l) => l.trim() !== "")
      .filter((l) => !REPLACED.includes(l))
      .filter((l) => !newLines.has(l));
    expect(missing).toEqual([]);
  });

  it("actually removed the four lines it claims to replace", () => {
    // Otherwise the list above could be padded to silence a real difference.
    for (const line of REPLACED) {
      expect(OLD.split("\n")).toContain(line);
      expect(NEW.split("\n")).not.toContain(line);
    }
  });
});

describe("the gate it adds", () => {
  it("forces Red rather than banding it, because a gate is not an argument", () => {
    expect(NEW).toMatch(/CASE WHEN g\.gated THEN 'Red'/);
  });

  it("lowers the score and never raises it", () => {
    expect(NEW).toMatch(/LEAST\(sc\.score_final, t\.cap_gate\)/);
    expect(NEW).not.toMatch(/GREATEST\(sc\.score_final/);
  });

  it("voids a rejected action and nothing else", () => {
    const lateral = NEW.slice(NEW.indexOf("count(*) > 0 AS gated"), NEW.indexOf(") g"));
    expect(lateral).toMatch(/validation_status IS DISTINCT FROM 'rejected'/);
    // Not closure, and not attribution: the gate records that the event occurred.
    expect(lateral).not.toMatch(/closed_at/);
    expect(lateral).not.toMatch(/counts_against_leader/);
  });

  it("matches the leader by id and falls back to the name, so a null id cannot skip it", () => {
    const lateral = NEW.slice(NEW.indexOf("count(*) > 0 AS gated"), NEW.indexOf(") g"));
    expect(lateral).toMatch(/a\.leader_id = s\.leader_id/);
    expect(lateral).toMatch(/a\.leader_id IS NULL/);
    expect(lateral).toMatch(/lower\(btrim\(a\.leader_name\)\) = lower\(btrim\(ll\.name\)\)/);
  });

  it("names the event in rag_driver, which is what makes a clean line's Red readable", () => {
    expect(NEW).toMatch(/Seguranca alimentar: ' \|\| g\.reason/);
  });
});

describe("it refuses to apply out of order", () => {
  const sql = read("20260826090000_the_weekly_row_learns_about_the_actions.sql");

  it("requires quality_options.is_gate, without which it would gate on nothing", () => {
    expect(sql).toMatch(/column_name = 'is_gate'/);
    expect(sql).toMatch(/RAISE EXCEPTION/);
  });

  it("requires leader_id to point at line_leaders, or the join fails OPEN", () => {
    // The subtle one. Until 20260825090000, quality_actions.leader_id referenced
    // auth.users — and line leaders have no accounts. An action carrying one of those
    // ids matches neither `a.leader_id = s.leader_id` nor the `IS NULL` fallback, so it
    // escapes the gate silently and the week closes green with a failed CCP in it.
    expect(sql).toMatch(/confrelid = 'public\.line_leaders'::regclass/);
  });
});
