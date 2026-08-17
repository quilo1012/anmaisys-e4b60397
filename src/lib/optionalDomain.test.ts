import { describe, expect, it, vi } from "vitest";
import { selectOptionalDomain } from "@/lib/optionalDomain";

/**
 * The regression this exists for.
 *
 * On 16/08 commit 7739b8b2 added `domain` to four `quality_actions` selects, so that
 * `actionPoints()` would stop pricing a safety row like a quality one. The column
 * arrives with migration 20260817090000, which had not run. PostgREST rejects an entire
 * query for one unknown column, so all four screens lost the whole quality log rather
 * than one field — the leader scorecard reported "No quality action was raised against
 * this leader in this period" over four open ones, at Quality 100%.
 *
 * The right reading is not a patch: `domain` exists only to tell `actionPoints` to score
 * a safety action at zero, and a base with no `domain` column has no safety actions —
 * 20260817090000 is the same migration that creates them. Undefined therefore means
 * "quality", which is what every row in such a base is.
 */

const MISSING = { code: "42703", message: 'column "domain" does not exist' };
const COLS = "id, severity, recorded_at, domain";

describe("selectOptionalDomain", () => {
  it("asks for domain first, and hands the rows straight back when it is there", async () => {
    const run = vi.fn().mockResolvedValue({ data: [{ id: "a" }], error: null });
    const out = await selectOptionalDomain(COLS, run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(COLS);
    expect(out).toEqual({ data: [{ id: "a" }], error: null });
  });

  it("retries without domain when the column is not there yet", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ data: null, error: MISSING })
      .mockResolvedValueOnce({ data: [{ id: "a" }], error: null });

    const out = await selectOptionalDomain(COLS, run);

    expect(run).toHaveBeenNthCalledWith(1, COLS);
    expect(run).toHaveBeenNthCalledWith(2, "id, severity, recorded_at");
    expect(out).toEqual({ data: [{ id: "a" }], error: null });
  });

  it("strips domain wherever it sits in the list, not only at the end", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ data: null, error: MISSING })
      .mockResolvedValueOnce({ data: [], error: null });

    await selectOptionalDomain("id, domain, severity", run);

    expect(run).toHaveBeenNthCalledWith(2, "id, severity");
  });

  /**
   * The line that keeps this honest. An RLS refusal and a dead connection must not be
   * quietly retried into an empty list — reporting "the migration has not run" to
   * somebody whose policy refused them sends them to the wrong place, and a screen that
   * treats every failure as "no rows" is the bug this helper exists to fix.
   */
  it("leaves every other failure alone, and does not retry", async () => {
    const denied = { code: "42501", message: "permission denied for table quality_actions" };
    const run = vi.fn().mockResolvedValue({ data: null, error: denied });

    const out = await selectOptionalDomain(COLS, run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ data: null, error: denied });
  });

  it("passes the retry's own failure back rather than swallowing it", async () => {
    const dead = { code: "08006", message: "connection failure" };
    const run = vi.fn()
      .mockResolvedValueOnce({ data: null, error: MISSING })
      .mockResolvedValueOnce({ data: null, error: dead });

    expect(await selectOptionalDomain(COLS, run)).toEqual({ data: null, error: dead });
  });

  it("does not retry a list that never asked for domain — there is nothing to strip", async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: MISSING });

    await selectOptionalDomain("id, severity", run);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not retry a domain-free list written without spaces either", async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: MISSING });

    await selectOptionalDomain("id,severity", run);

    // Re-running the identical query would be a wasted round trip against a base that
    // has already said no — and the retry only ever makes sense if there was a `domain`
    // to take out.
    expect(run).toHaveBeenCalledTimes(1);
  });
});
