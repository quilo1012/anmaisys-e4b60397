import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_ACTIONS } from "@/lib/permissions";

const MIGRATION = "supabase/migrations/20260821090000_action_guard_work_orders.sql";

function guardedActions(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  return [...sql.matchAll(/enforce_action\('([^']+)'\)/g)].map((m) => m[1]);
}

describe("guarda de ações em work_orders", () => {
  it("protege as cinco ações de work orders", () => {
    expect(new Set(guardedActions())).toEqual(
      new Set(["wo.create", "wo.update", "wo.delete", "wo.close", "wo.force"]),
    );
  });

  it("não nomeia nenhuma ação que o MATRIX desconheça", () => {
    const desconhecidas = guardedActions().filter(
      (a) => !(ALL_ACTIONS as string[]).includes(a),
    );
    expect(desconhecidas).toEqual([]);
  });
});
