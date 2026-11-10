import { describe, it, expect, vi } from "vitest";
import { saveSettlement } from "./saveSettlement";

/**
 * 10/11 19:49: the TimeMoto import tried to rename an employee to the name in the file, and
 * that name already belonged to another record (60 inactive ones are not in the roster the
 * import checks against). The rename and the alias went in one PATCH, so the 23505 threw
 * away the alias too, and the next import asked about the same person again.
 */
const clash = { code: "23505", message: 'duplicate key value violates unique constraint "employees_name_unique_idx"' };

describe("saveSettlement", () => {
  it("keeps the alias when the new name is already somebody else's", async () => {
    const update = vi.fn()
      .mockResolvedValueOnce({ error: clash })
      .mockResolvedValueOnce({ error: null });
    const r = await saveSettlement({ employeeId: "e1", sheet_aliases: "Jo Silva", full_name: "Jo Silva" }, update);
    expect(update).toHaveBeenNthCalledWith(1, "e1", { sheet_aliases: "Jo Silva", full_name: "Jo Silva" });
    expect(update).toHaveBeenNthCalledWith(2, "e1", { sheet_aliases: "Jo Silva" });
    expect(r).toEqual({ ok: true, renamed: false, nameTaken: true });
  });

  it("renames when nobody has the name", async () => {
    const update = vi.fn().mockResolvedValue({ error: null });
    const r = await saveSettlement({ employeeId: "e1", sheet_aliases: "a", full_name: "Jo Silva" }, update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: true, renamed: true, nameTaken: false });
  });

  it("does not retry other errors, and does not retry an alias-only save", async () => {
    const update = vi.fn().mockResolvedValue({ error: { code: "42501", message: "denied" } });
    expect(await saveSettlement({ employeeId: "e1", sheet_aliases: "a", full_name: "B C" }, update))
      .toEqual({ ok: false, renamed: false, nameTaken: false, message: "denied" });
    update.mockClear().mockResolvedValue({ error: clash });
    expect((await saveSettlement({ employeeId: "e1", sheet_aliases: "a" }, update)).ok).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
