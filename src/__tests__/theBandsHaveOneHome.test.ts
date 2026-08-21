import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The RAG bands are decided in SQL, once, and this is that decision held in place.
 *
 * `RagChip` already says it in a comment — "este ficheiro NAO decide bandas: se algum
 * dia aparecer aqui uma comparacao numerica, a regra passou a ter duas definicoes" —
 * and `leaderScore.ts` refuses, for the same reason, to derive its own Amber. Neither
 * refusal is enforced by anything, so both survive only as long as someone reads them
 * first. A plausible-sounding request — "port the RAG logic to TypeScript so it can be
 * unit-tested" — reads as new work rather than as a fork of a shipped rule, and would
 * pass review twice before anyone noticed the app and the database disagreeing about
 * whether a leader's week was Green.
 *
 * The three things below are what such a port would quietly change, so they are the
 * three things asserted:
 *
 *   - Above the green ceiling is Amber, not Green. Overproduction is inventory nobody
 *     asked for, and a port written from a mock that stops at ">= 100 is Green" drops
 *     that branch without ever stating it was dropped.
 *   - Quality Red is the FIRST branch of the overall gate. The migration that
 *     introduced it says nothing added later may be placed above it: no volume figure,
 *     however good, may lift a week where a CCP, starter or volume/weight check went
 *     uncompleted.
 *   - Health & Safety is INSIDE the overall verdict, not beside it. An H&S Red is the
 *     second gate and an H&S Amber carries the week to Amber on its own.
 *
 * If this test fails, do not edit the expectation to match the code. The bands and the
 * gate order are a food-safety rule before they are a number, and the thresholds are
 * versioned in `leader_scorecard_threshold` so that changing one re-scores history on
 * purpose rather than by accident.
 */

const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");

/** The newest migration that actually defines `name`, not one that merely ALTERs it. */
function newestDefinitionOf(name: string): string {
  const defining = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`).test(
        readFileSync(resolve(MIGRATIONS, f), "utf8"),
      ),
    );
  expect(defining.length).toBeGreaterThan(0);
  return readFileSync(resolve(MIGRATIONS, defining[defining.length - 1]), "utf8");
}

/** The `SELECT CASE ... END` a band function is, with nothing around it. */
function bodyOf(sql: string, name: string): string {
  const match = sql.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`),
  );
  expect(match, `no body found for ${name}`).not.toBeNull();
  return match![1];
}

describe("the RAG bands have one home", () => {
  it("bands volume in the spreadsheet's order, with overproduction Amber and no data NULL", () => {
    const body = bodyOf(newestDefinitionOf("scorecard_volume_rag"), "scorecard_volume_rag");

    // Absent is absent. A missing plan must never band as a zero.
    expect(body).toMatch(/WHEN\s+_pct\s+IS\s+NULL\s+THEN\s+NULL/);

    const order = ["_amber_min", "_green_min", "_green_max"].map((t) => body.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(Math.min(...order)).toBeGreaterThan(-1);

    expect(body).toMatch(/WHEN\s+_pct\s+<\s+_amber_min\s+THEN\s+'Red'/);
    expect(body).toMatch(/WHEN\s+_pct\s+<\s+_green_min\s+THEN\s+'Amber'/);
    expect(body).toMatch(/WHEN\s+_pct\s+<=\s+_green_max\s+THEN\s+'Green'/);

    // The branch a "&gt;= 100 is Green" port deletes: past the ceiling is Amber.
    expect(body).toMatch(/ELSE\s+'Amber'/);
    expect(body).not.toMatch(/ELSE\s+'Green'/);
  });

  it("puts the quality gate above every other branch of the overall verdict", () => {
    const body = bodyOf(newestDefinitionOf("scorecard_overall_rag"), "scorecard_overall_rag");

    const quality = body.search(/WHEN\s+_quality_rag\s*=\s*'Red'\s+THEN\s+'Red'/);
    const hsRed = body.search(/WHEN\s+_hs_rag\s*=\s*'Red'\s+THEN\s+'Red'/);
    const hsAmber = body.search(/WHEN\s+_hs_rag\s*=\s*'Amber'\s+THEN\s+'Amber'/);
    const volume = body.search(/ELSE\s+_volume_rag/);

    // Every one of them present...
    expect([quality, hsRed, hsAmber, volume].every((i) => i > -1)).toBe(true);
    // ...and in this order, which is the rule, not a formatting preference.
    expect(quality).toBeLessThan(hsRed);
    expect(hsRed).toBeLessThan(hsAmber);
    expect(hsAmber).toBeLessThan(volume);
  });

  it("keeps the seeded bands at 97 / 100 / 105 percent of plan", () => {
    const seed = readFileSync(
      resolve(MIGRATIONS, "20260815140000_health_and_safety_is_the_second_gate.sql"),
      "utf8",
    );
    expect(seed).toMatch(/\('THR_VolAmberMin',\s*0\.970,/);
    expect(seed).toMatch(/\('THR_VolGreenMin',\s*1\.000,/);
    expect(seed).toMatch(/\('THR_VolGreenMax',\s*1\.050,/);
  });

  it("has no TypeScript anywhere that decides a band for itself", () => {
    // RagChip owns the presentation map — which colour a verdict is painted. It is the
    // one file allowed to name the verdicts, and it names them without comparing them.
    const ALLOWED = "src/components/scorecard/RagChip.tsx";

    const walk = (dir: string): string[] =>
      readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) => {
        const path = `${dir}/${e.name}`;
        if (e.isDirectory()) return walk(path);
        return /\.tsx?$/.test(e.name) ? [path] : [];
      });

    const offenders = walk("src")
      .filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("__tests__") && f !== ALLOWED)
      .filter((f) =>
        // Comments explain the rule and must not read as the rule being re-implemented.
        readFileSync(resolve(root, f), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1")
          .match(/["'](Red|Amber|Green)["']/),
      );

    expect(offenders).toEqual([]);
  });
});
