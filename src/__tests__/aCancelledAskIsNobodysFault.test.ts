import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Block 103, as written and as pasted.
 *
 * The behaviour was run on a local Postgres with every migration loaded (19/10):
 * cancel took the board row off, reopening put it back once, and a cancelled ask
 * stopped counting in "x of y worked". What is pinned here is that the paste carries
 * that same SQL, and the three changes in it.
 */
const root = resolve(__dirname, "../..");
const migration = readFileSync(resolve(root, "supabase/migrations/20261019090000_a_cancelled_ask_is_nobodys_fault.sql"), "utf8");
const paste = readFileSync(resolve(root, "docs/apply-passo-3/APLICAR-103-pedido-cancelado.sql"), "utf8");
const all = readFileSync(resolve(root, "docs/apply-passo-3/APPLY-ALL-IN-ORDER.sql"), "utf8");

describe("block 103", () => {
  it("is the migration, byte for byte, in its own paste and in the package", () => {
    expect(paste).toContain(migration);
    expect(all).toContain(paste);
  });

  it("puts accepted people back on the board when a cancelled ask is reopened", () => {
    expect(migration).toMatch(/elsif old\.status = 'cancelled' and new\.status is distinct from 'cancelled'/);
    expect(migration).toMatch(/perform public\.overtime_board_apply\(new\.id, r\.employee_id, true\)/);
  });

  it("leaves cancelled asks out of the 60-day reliability", () => {
    expect(migration).toMatch(/where r\.decision = 'accepted' and q\.status <> 'cancelled'/);
  });

  it("drops the direct-insert policy and creates nothing in its place", () => {
    expect(migration).toContain('drop policy if exists "overtime_responses_own" on public.overtime_responses;');
    expect(migration).not.toMatch(/create policy "overtime_responses_own"/);
  });
});
