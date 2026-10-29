import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `VERIFY-send-push-publicado.sql` tells a stale `send-push` from a current one by a single
 * answer: the database's key plus an empty body gets 401 from the old build and 400 from
 * this one. That reading is only true while this code keeps three properties, and this test
 * holds them:
 *
 *  - the scheduler key is checked before any user token is asked for, so a 401 means the
 *    key was refused and nothing else;
 *  - the body is validated before anything is written or sent, and `title` is required,
 *    so the probe's `{}` sends no notification to anybody;
 *  - the probe calls the production project with the vault secret the bell trigger uses.
 *
 * 29/10/2026: production `send-push` was a build from before 21/10 and refused the
 * database with 401, while every bell row looked delivered. See AGENTS.md, "A merge does not
 * publish the server functions".
 */
const root = resolve(__dirname, "../..");
const fn = readFileSync(resolve(root, "supabase/functions/send-push/index.ts"), "utf8");
const verify = readFileSync(resolve(root, "docs/apply-passo-3/VERIFY-send-push-publicado.sql"), "utf8");
const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
const bell = readFileSync(resolve(root, "supabase/migrations/20261021200000_the_bell_rings_the_phone.sql"), "utf8");

describe("the probe that says whether the published send-push is current", () => {
  it("the scheduler key is read before a user token is required", () => {
    const key = fn.indexOf('req.headers.get("x-cron-secret")');
    const bearer = fn.indexOf('authHeader.startsWith("Bearer ")');
    expect(key).toBeGreaterThan(-1);
    expect(bearer).toBeGreaterThan(-1);
    expect(key).toBeLessThan(bearer);
    // The bearer check only runs for a caller the key did not admit.
    expect(fn).toMatch(/if \(!isService\) \{[\s\S]*?authHeader\.startsWith\("Bearer "\)/);
  });

  it("an empty body is refused with 400 before anything is written or sent", () => {
    expect(fn).toMatch(/title: z\.string\(\)\.min\(1\)/);
    const parse = fn.indexOf("PushPayloadSchema.safeParse(rawBody)");
    const firstWrite = fn.indexOf('from("notifications").insert');
    const firstSend = fn.indexOf(".sendNotification(");
    expect(parse).toBeGreaterThan(-1);
    expect(parse).toBeLessThan(firstWrite);
    expect(parse).toBeLessThan(firstSend);
    expect(fn).toMatch(/error: "invalid payload"[\s\S]{0,200}status: 400/);
  });

  it("the probe reads 400 as current and 401 as stale", () => {
    expect(verify).toMatch(/when 400 then 'ok/);
    expect(verify).toMatch(/when 401 then 'DESATUALIZADO/);
    expect(verify).toMatch(/body := '\{\}'::jsonb/);
  });

  it("the probe calls production, with the secret the bell trigger sends", () => {
    const ref = config.match(/^\s*project_id\s*=\s*"([^"]+)"/m)?.[1];
    expect(ref).toBeTruthy();
    expect(verify).toContain(`https://${ref}.supabase.co/functions/v1/send-push`);
    expect(bell).toMatch(/name = 'CRON_SECRET'/);
    expect(verify).toMatch(/name = 'CRON_SECRET'/);
    expect(bell).toMatch(/'x-cron-secret'/);
    expect(verify).toMatch(/'x-cron-secret'/);
  });
});
