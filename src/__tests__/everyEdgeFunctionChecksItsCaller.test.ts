import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * 41 edge functions, 9844 lines, and nothing in the repository checked that any of them
 * asks who is calling.
 *
 * They matter more than a screen does. Most hold SUPABASE_SERVICE_ROLE_KEY, which
 * bypasses RLS entirely — every policy the audit spent days on stops applying the moment
 * one of these runs. `clear-system` deletes every work order; `delete-user` removes an
 * account; `reset-operator-password` sets one.
 *
 * THE THING THAT MAKES THIS WORTH A TEST, and the reason the config file cannot be
 * trusted to answer it: `verify_jwt = true` — the default, and what 31 of the 41 run
 * under — is satisfied by the ANON KEY, which ships inside the published JavaScript
 * bundle. It rejects a request with no token at all and nothing else. It is not a
 * permission check and it never was.
 *
 * So the only real gate is the one inside each function, and on 27/08/2026 all 41 have
 * one. Four different shapes, all legitimate:
 *
 *   auth.getUser()          clear-system, seed-demo, reset-operator-password …
 *   auth.getClaims(token)   delete-engineer, create-engineer, update-engineer …
 *   a shared secret         intouch-poll (CRON_SECRET), wallboard-lines (WALLBOARD_KEY)
 *   the caller's own token   mcp — publishable key + Authorization, so RLS still applies
 *
 * This is that survey, frozen. It does not judge whether a function checks the right
 * ROLE — `delete-engineer` wanting admin-or-manager is a decision, not a rule — only
 * that it looks at the caller at all before using a key that answers to nobody.
 *
 * A new function with none of these fails here on the day it is added, which is the
 * only day anyone will be reading it.
 */

const FUNCTIONS_DIR = resolve(__dirname, "../..", "supabase/functions");
const CONFIG = resolve(__dirname, "../..", "supabase/config.toml");

/** Any of the four ways a function in this project establishes who is calling. */
const VALIDA_O_CHAMADOR = [
  /auth\.getUser\s*\(/,          // resolves the token against the auth server
  /auth\.getClaims\s*\(/,        // verifies the JWT signature locally
  /getToken\s*\(\s*\)/,          // mcp: acts as the caller, so RLS still decides
  /isAuthenticated\s*\(\s*\)/,
  /CRON_SECRET|CRON_TRIGGER_TOKEN|CRON_POLL_KEY/,  // machine callers
  /WALLBOARD_KEY/,               // the TV, which cannot hold a session
  /INTOUCH_WEBHOOK_SECRET|x-webhook-secret/,       // the vendor posting in
];

/**
 * The one function that cannot check a caller, because checking one is what it does.
 *
 * `tablet-signin` IS the sign-in: a tablet arrives holding no session and asks for one.
 * Requiring it to identify the caller first would be circular. It is named here rather
 * than pattern-matched, and the test below holds it to what a sign-in endpoint owes
 * instead — a rate limit and an answer that does not reveal whether the account exists.
 */
const AUTENTICA_EM_VEZ_DE_VERIFICAR = ["tablet-signin"];

function funcoes(): string[] {
  if (!existsSync(FUNCTIONS_DIR)) return [];
  return readdirSync(FUNCTIONS_DIR)
    .filter((d) => existsSync(join(FUNCTIONS_DIR, d, "index.ts")))
    .sort();
}

describe("every edge function", () => {
  const todas = funcoes();

  it("is found by the test at all", () => {
    // Without this, deleting the directory turns the sweep below into a pass.
    expect(todas.length).toBeGreaterThan(30);
    expect(todas).toContain("clear-system");
  });

  it("establishes who is calling before doing anything", () => {
    const sem = todas
      .filter((f) => !AUTENTICA_EM_VEZ_DE_VERIFICAR.includes(f))
      .filter((f) => {
        const src = readFileSync(join(FUNCTIONS_DIR, f, "index.ts"), "utf8");
        return !VALIDA_O_CHAMADOR.some((re) => re.test(src));
      });
    expect(sem).toEqual([]);
  });

  it("holds the sign-in endpoint to what a sign-in owes instead", () => {
    // The exemption above is only defensible if it comes with this. An endpoint that
    // takes a password and cannot identify its caller is the one place brute force and
    // account enumeration actually land.
    for (const f of AUTENTICA_EM_VEZ_DE_VERIFICAR) {
      if (!todas.includes(f)) continue;
      const src = readFileSync(join(FUNCTIONS_DIR, f, "index.ts"), "utf8");
      expect(src, `${f} must rate-limit`).toMatch(/429|rateLimit|checkRateLimit/i);
      expect(src, `${f} must not reveal whether the account exists`).toMatch(/Invalid credentials/);
      // And it must not carry a fallback password: a shared default is the same hole
      // one layer down.
      expect(src, `${f} must not ship a default password`).not.toMatch(
        /password\s*=\s*["'][A-Za-z0-9!@#$%^&*]{4,}["']/,
      );
    }
  });

  it("never opens up when its shared secret is unset", () => {
    // The failure mode a secret-based gate has and a token-based one does not: an unset
    // env var reads as "" and `presented === SECRET` compares "" to "". Both functions
    // that use one refuse outright instead, and say so. If a third is added, it copies
    // whichever it read last.
    for (const f of ["intouch-poll", "wallboard-lines"]) {
      if (!todas.includes(f)) continue;
      const src = readFileSync(join(FUNCTIONS_DIR, f, "index.ts"), "utf8");
      expect(src, `${f} must refuse when its secret is missing`).toMatch(
        /refusing all requests|server_misconfigured|not configured/i,
      );
    }
  });

  it("does not treat verify_jwt as a permission check", () => {
    // Documentation as much as assertion. Anyone reading config.toml sees ten functions
    // marked `verify_jwt = false` and reasonably concludes the other 31 are protected.
    // They are not — the anon key satisfies it, and it is in the published bundle.
    const cfg = existsSync(CONFIG) ? readFileSync(CONFIG, "utf8") : "";
    const publicas = [...cfg.matchAll(/\[functions\.([a-z0-9-]+)\][\s\S]{0,80}?verify_jwt = false/g)]
      .map((m) => m[1]);
    for (const f of publicas) {
      if (!todas.includes(f)) continue;
      const src = readFileSync(join(FUNCTIONS_DIR, f, "index.ts"), "utf8");
      expect(
        VALIDA_O_CHAMADOR.some((re) => re.test(src)),
        `${f} has verify_jwt = false and must check the caller itself`,
      ).toBe(true);
    }
  });
});
