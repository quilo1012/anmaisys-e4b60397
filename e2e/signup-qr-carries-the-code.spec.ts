import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * From the login screen's QR to a filled Invite code field, the way a phone does it.
 *
 * On 18/10/2026 production answered `rpc/signup_invite_code` with 404 (BLOCO 86 not
 * pasted), so the QR carried `/signup` only and the field arrived empty. These tests
 * stub Supabase both ways: with the function, and as production is today.
 *
 * The code below is a fixture made of the characters that break hand-made links
 * (space, slash, plus, ampersand). The app never invents one; it only carries what
 * `signup_invite_code` returns.
 *
 * Nothing here reaches the network.
 */

const CODE = "AN 7/K+X&";
const TABLET = { id: "t1", label: "Line 3", line_ids: [], line_names: ["Line 3"], favicon_url: null };

interface Stub {
  /** What signup_invite_code answers; undefined = 404, as production on 18/10. */
  inviteCode?: string | null;
  /** What check_invite_code answers for CODE. */
  codeIsValid?: boolean;
  calls: { url: string; body: unknown }[];
}

async function stubSupabase(page: Page, stub: Stub) {
  await page.route(/supabase\.co/, async (route: Route) => {
    const req = route.request();
    const url = req.url();
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { body = req.postData(); }
    stub.calls.push({ url, body });
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

    if (url.includes("/rpc/signup_invite_code")) {
      return stub.inviteCode === undefined
        ? json({ code: "PGRST202", message: "Could not find the function public.signup_invite_code without parameters in the schema cache" }, 404)
        : json(stub.inviteCode);
    }
    if (url.includes("/rpc/check_invite_code")) {
      return json((body as { code?: string })?.code === CODE ? stub.codeIsValid ?? true : false);
    }
    if (url.includes("/rpc/list_tablet_accounts_public")) return json([TABLET]);
    if (url.includes("/functions/v1/employee-signin")) {
      return json({ error: "fixture: stop here" }, 400);
    }
    if (url.includes("/rpc/")) return json(null);
    return json([]);
  });
}

async function decodeQr(page: Page): Promise<string> {
  const img = page.getByRole("img", { name: "QR code to the registration page" });
  await expect(img).toBeVisible();
  const png = await img.screenshot({ type: "png" });
  return page.evaluate(async (b64) => {
    const { Html5Qrcode } = await import("/node_modules/.vite/deps/html5-qrcode.js").catch(
      () => import("html5-qrcode" as string),
    );
    const host = document.createElement("div");
    host.id = "qr-reader-test";
    host.style.display = "none";
    document.body.appendChild(host);
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    return new Html5Qrcode("qr-reader-test", { verbose: false })
      .scanFile(new File([blob], "qr.png", { type: "image/png" }), false);
  }, png.toString("base64"));
}

test.describe("the login screen's QR", () => {
  test.use({ viewport: { width: 1005, height: 600 } }); // the line tablet

  test("carries the invite code, encoded, and the button does too", async ({ page }) => {
    const stub: Stub = { inviteCode: CODE, calls: [] };
    await stubSupabase(page, stub);
    await page.goto("/login");

    const decoded = await decodeQr(page);
    const url = new URL(decoded);
    expect(url.pathname).toBe("/signup");
    expect(url.searchParams.get("code")).toBe(CODE);
    expect(decoded).toContain(`code=${encodeURIComponent(CODE)}`);
    await test.info().attach("login-qr.png", { body: await page.screenshot(), contentType: "image/png" });

    const href = await page.getByRole("link", { name: /create account/i }).getAttribute("href");
    expect(new URLSearchParams(href!.split("?")[1]).get("code")).toBe(CODE);
  });

  test("as production is today (no signup_invite_code), carries no code and invents none", async ({ page }) => {
    const stub: Stub = { inviteCode: undefined, calls: [] };
    await stubSupabase(page, stub);
    await page.goto("/login");
    const decoded = await decodeQr(page);
    expect(new URL(decoded).search).toBe("");
    await page.goto(new URL(decoded).pathname);
    await expect(page.locator("#su-code-b")).toHaveValue("");
  });

  test("a closed or expired sign-up (null) carries no code either", async ({ page }) => {
    await stubSupabase(page, { inviteCode: null, calls: [] });
    await page.goto("/login");
    expect(new URL(await decodeQr(page)).search).toBe("");
  });
});

test.describe("the page the QR opens, on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  const link = `/signup?code=${encodeURIComponent(CODE)}`;

  test("fills the field, keeps it across both doors, a reload and a trip to Sign in", async ({ page }) => {
    await stubSupabase(page, { inviteCode: CODE, calls: [] });
    await page.goto(link);

    await expect(page.locator("#su-code-b")).toHaveValue(CODE);
    await page.getByRole("button", { name: "Email" }).click();
    await expect(page.locator("#su-code")).toHaveValue(CODE);
    await page.getByRole("button", { name: "Employee ID" }).click();
    await expect(page.locator("#su-code-b")).toHaveValue(CODE);
    await test.info().attach("signup-phone.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    await page.reload();
    await expect(page.locator("#su-code-b")).toHaveValue(CODE);

    // The address loses the code; the tab keeps it.
    await page.goto("/signup");
    await expect(page.locator("#su-code-b")).toHaveValue(CODE);
  });

  test("sends exactly that code to the backend from the Employee ID door", async ({ page }) => {
    const stub: Stub = { inviteCode: CODE, calls: [] };
    await stubSupabase(page, stub);
    await page.goto(link);
    await page.locator("#su-ref").fill("E045");
    await page.locator("#su-pass-b").fill("fixture-password-123");
    await page.locator("form button[type=submit]").click();
    await expect.poll(() => stub.calls.find((c) => c.url.includes("employee-signin"))?.body)
      .toMatchObject({ mode: "register", employee_ref: "E045", invite_code: CODE });
  });

  test("says at once when the code from the QR is no longer valid", async ({ page }) => {
    await stubSupabase(page, { inviteCode: CODE, codeIsValid: false, calls: [] });
    await page.goto(link);
    await expect(page.getByRole("alert")).toContainText("isn't valid any more");
  });

  test("still takes a code typed by hand, and checks that one", async ({ page }) => {
    const stub: Stub = { inviteCode: undefined, calls: [] };
    await stubSupabase(page, stub);
    await page.goto("/signup");
    await page.getByRole("button", { name: "Email" }).click();
    await expect(page.locator("#su-code")).toHaveValue("");
    await page.locator("#su-name").fill("Fixture Person");
    await page.locator("#su-email").fill("fixture@example.invalid");
    await page.locator("#su-pass").fill("fixture-password-123");
    await page.locator("#su-code").fill("TYPED-1");
    await page.locator("form button[type=submit]").click();
    await expect.poll(() => stub.calls.find((c) => c.url.includes("check_invite_code"))?.body)
      .toEqual({ code: "TYPED-1" });
  });
});
