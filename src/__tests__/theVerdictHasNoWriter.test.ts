import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The Validation block came off the quality detail dialog, and with it the only screen
 * that could write a verdict. This is that removal, held in place.
 *
 * Two halves that have to stay in step, because separately each one is defensible and
 * together they are a deadlock — which is exactly the state this branch was in before
 * the migration below was written:
 *
 *   - The screen no longer offers Validated / Rejected, nor Approve closure.
 *   - The database no longer refuses a validation for want of an attachment. That
 *     refusal ("Attach the evidence before validating this action.") was written when
 *     the dialog had a Photos block with an upload beside it. The Photos block went to
 *     SafetyCulture; the trigger did not go with it, so for a while the only remaining
 *     verdict path was one the database would always reject.
 *
 * Restoring either half alone re-creates that. If a verdict picker comes back, it needs
 * a way to attach evidence before the gate can come back with it — and if the gate is
 * what you want first, put the upload back on the screen in the same change.
 *
 * Read this too, before rebuilding either: with no writer, `rejected` is unreachable,
 * and `rejected` was the only way to say a deviation was not the leader's doing. Every
 * logged action charges its leader in full. That is a deliberate decision, taken with
 * the numbers in front of it, not an oversight this test is papering over.
 */

const root = resolve(__dirname, "../..");
const PAGE = "src/pages/dashboard/QualityActionsPage.tsx";
const MIGRATIONS = resolve(root, "supabase/migrations");

/** Comments describe what was removed and must not count as the thing coming back. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^\s*--.*$/gm, "");
}

describe("the verdict has no writer", () => {
  const page = code(readFileSync(resolve(root, PAGE), "utf8"));

  it("offers no verdict or closure control on the quality actions page", () => {
    expect(page).not.toMatch(/Approve closure/);
    expect(page).not.toMatch(/onValidation|onClosure|setValidation|setClosure/);
  });

  it("writes neither validation_status nor closed_at from that page", () => {
    // The page still READS both — the table badge, the filters and the export all do.
    // What it must not do is update them.
    expect(page).not.toMatch(/update\(\s*\{[^}]*validation_status/);
    expect(page).not.toMatch(/update\(\s*\{[^}]*closed_at/);
  });

  it("has the newest definition of enforce_quality_validation free of the evidence gate", () => {
    const defining = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        /CREATE OR REPLACE FUNCTION public\.enforce_quality_validation/.test(
          readFileSync(resolve(MIGRATIONS, f), "utf8"),
        ),
      );
    expect(defining.length).toBeGreaterThan(0);

    // Stripped, because the migration that removes the gate quotes the message it is
    // removing — a header that explains itself must not read as the gate coming back.
    const newest = code(readFileSync(resolve(MIGRATIONS, defining[defining.length - 1]), "utf8"));
    expect(newest).not.toMatch(/Attach the evidence before validating/);
    expect(newest).not.toMatch(/array_length\(new\.attachments/);
  });
});
