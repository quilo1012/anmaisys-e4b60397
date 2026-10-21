import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * F-3 regression. intouch-webhook used to log EVERY request — including those that
 * failed the secret check — into intouch_webhook_logs with attacker-controlled headers
 * and payload. An unauthenticated caller could flood the table and inject arbitrary
 * content into admin-viewed logs, and the secret was compared with `===` (not constant
 * time).
 *
 * This is a source check (same spirit as everyEdgeFunctionChecksItsCaller): it reads the
 * function and asserts the shape that makes the hole impossible — the secret is verified,
 * in constant time, BEFORE the body is read and BEFORE anything is written to the logs.
 */

const FN = resolve(
  __dirname,
  "../..",
  "supabase/functions/intouch-webhook/index.ts",
);

describe("intouch-webhook authenticates before logging", () => {
  const src = existsSync(FN) ? readFileSync(FN, "utf8") : "";

  it("the function exists", () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it("uses a constant-time secret comparison, not ===", () => {
    expect(src).toMatch(/timingSafeEqual\s*\(/);
    // the old, timing-leaky compare must not come back
    expect(src).not.toMatch(/sig\s*===\s*WEBHOOK_SECRET/);
  });

  it("checks the secret before reading the body", () => {
    const gate = src.search(/timingSafeEqual\s*\(\s*sig/);
    const bodyRead = src.indexOf("await req.text()");
    expect(gate).toBeGreaterThan(-1);
    expect(bodyRead).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(bodyRead);
  });

  it("returns 401 on a bad secret before writing to intouch_webhook_logs", () => {
    const gateReturn = src.indexOf('"invalid_signature"');
    const logInsert = src.search(/intouch_webhook_logs"\)\s*\.insert/);
    expect(gateReturn).toBeGreaterThan(-1);
    expect(logInsert).toBeGreaterThan(-1);
    // the 401 return must appear before the only log insert
    expect(gateReturn).toBeLessThan(logInsert);
    // and there must be exactly one insert into the logs table (no second,
    // unauthenticated path)
    const inserts = src.match(/intouch_webhook_logs"\)\s*\.insert/g) ?? [];
    expect(inserts.length).toBe(1);
  });

  it("caps the request body size", () => {
    expect(src).toMatch(/MAX_BODY_BYTES/);
    expect(src).toMatch(/413/);
  });
});
