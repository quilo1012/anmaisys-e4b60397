import { describe, it, expect, vi } from "vitest";
import { writeOptionalDomain } from "./writeOptionalDomain";

const MISSING = { code: "PGRST204", message: "Could not find the 'domain' column of 'quality_actions' in the schema cache" };
const RLS = { code: "42501", message: "new row violates row-level security policy" };

const quality = { description: "Label peeling", domain: "quality", safety_kind: null, line: "Line 3" };
const safety = { description: "Near miss at the filler", domain: "safety", safety_kind: "near_miss", line: "Line 3" };

/**
 * `buildQualityActionPayload` sends `domain` and `safety_kind` on every insert and
 * every update. Neither column exists until 20260817090000 runs, and PostgREST
 * rejects the whole write for one unknown column — so nobody could log or edit a
 * quality action at all.
 *
 * The read paths already forgive this (`selectOptions`, `selectOptionalDomain`). The
 * write path could not simply copy them, because dropping the columns is only
 * harmless for one of the two kinds of row.
 */
describe("writeOptionalDomain", () => {
  it("does nothing when the write succeeds", async () => {
    const run = vi.fn().mockResolvedValue({ data: [{ id: "1" }], error: null });
    const res = await writeOptionalDomain(quality, run);
    expect(res.error).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("hands back any error that is not a missing column", async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: RLS });
    const res = await writeOptionalDomain(quality, run);
    expect(res.error).toBe(RLS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("saves a quality action without the columns the base does not have", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ data: null, error: MISSING })
      .mockResolvedValueOnce({ data: [{ id: "1" }], error: null });
    const res = await writeOptionalDomain(quality, run);
    expect(res.error).toBeNull();
    expect(run).toHaveBeenCalledTimes(2);

    const retried = run.mock.calls[1][0];
    expect(retried).not.toHaveProperty("domain");
    expect(retried).not.toHaveProperty("safety_kind");
    // Nothing else may be lost on the way.
    expect(retried).toMatchObject({ description: "Label peeling", line: "Line 3" });
  });

  it("REFUSES to save a safety action as if it were a quality one", async () => {
    // The whole reason this is not a copy of the read-side helper. A safety row saved
    // without `domain` is a quality row, and actionPoints() charges the leader for it
    // — a near miss reported would cost points, which is the exact inversion the
    // safety design exists to prevent. Losing the save is recoverable; a silently
    // mis-filed occurrence is not.
    const run = vi.fn().mockResolvedValue({ data: null, error: MISSING });
    const res = await writeOptionalDomain(safety, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(res.error).toBeTruthy();
    expect(String((res.error as { message: string }).message)).toMatch(/safety/i);
  });

  it("tells the person what is missing rather than showing them the raw error", async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: MISSING });
    const res = await writeOptionalDomain(safety, run);
    const msg = String((res.error as { message: string }).message);
    expect(msg).toMatch(/20260817090000/);
    expect(msg).not.toMatch(/schema cache/);
  });

  it("forgives a missing column once, not twice", async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: MISSING });
    const res = await writeOptionalDomain(quality, run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(res.error).toBe(MISSING);
  });

  it("treats a row with no domain at all as quality", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ data: null, error: MISSING })
      .mockResolvedValueOnce({ data: [{ id: "1" }], error: null });
    const res = await writeOptionalDomain({ description: "Old row" }, run);
    expect(res.error).toBeNull();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
