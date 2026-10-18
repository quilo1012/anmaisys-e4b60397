import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";

// Exercise the deployed logger's actual enum/schema, without invoking Deno or writing audit rows.
const source = readFileSync("supabase/functions/log-audit-event/index.ts", "utf8");
const contract = source.slice(source.indexOf("const ALLOWED_ACTIONS"), source.indexOf("const SUPABASE_URL"))
  .replace(/ as const/g, "");
const schema = new Function("z", `${contract}; return BodySchema;`)(z) as z.ZodType;

describe("user management audit contract", () => {
  for (const action of ["user_created", "user_login_activated", "user_role_changed", "user_deleted", "pin_changed"]) {
    it(`accepts the existing ${action} event`, () => {
      expect(schema.safeParse({ action, entity_type: action === "pin_changed" ? "engineer" : "user", entity_id: "test-user", details: {} }).success).toBe(true);
    });
  }
  it("still rejects unknown actions and caller-supplied actor identity", () => {
    expect(schema.safeParse({ action: "untrusted_action", entity_type: "user" }).success).toBe(false);
    expect(schema.safeParse({ action: "user_login_activated", entity_type: "user", user_id: "forged" }).success).toBe(false);
  });
});