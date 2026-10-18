import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `APLICAR-86-codigo-no-link.sql` exists because production answered
 * `rpc/signup_invite_code` with 404 on 18/10/2026, so the login screen's QR and its
 * Create account button carried no invite code. It is a shortcut to one block, not a
 * second version of it: the block must be the package's own text, and nothing else in
 * the file may create, grant or drop anything.
 */
const dir = resolve(__dirname, "../..", "docs/apply-passo-3");
const all = readFileSync(resolve(dir, "APPLY-ALL-IN-ORDER.sql"), "utf8");
const paste = readFileSync(resolve(dir, "APLICAR-86-codigo-no-link.sql"), "utf8");

const block86 = all
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .find((b) => /^-- =+\n-- BLOCO 86\n/.test(b))!;

describe("the login QR paste", () => {
  it("carries BLOCO 86 byte for byte", () => {
    expect(block86).toBeTruthy();
    expect(paste).toContain(block86.trimEnd());
  });

  it("adds nothing but a schema reload and a yes/no check that never prints the code", () => {
    const rest = paste.replace(block86.trimEnd(), "");
    const statements = rest
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("--"))
      .join("\n");
    expect(statements).toBe(
      "notify pgrst, 'reload schema';\n" +
      "select public.signup_invite_code() is not null as login_screen_gets_a_code;",
    );
  });

  it("is the function the login screen calls", () => {
    const hook = readFileSync(resolve(__dirname, "../hooks/useSignupInvite.ts"), "utf8");
    expect(hook).toContain('"signup_invite_code"');
    expect(block86).toMatch(/grant execute on function public\.signup_invite_code\(\) to anon, authenticated;/);
  });
});
