import { test, expect, type Page } from "@playwright/test";

/**
 * O ecrã de entrada, como admin e employee o vêem. Nada chega à rede: o Supabase é
 * respondido aqui, com dois postos de linha para o desenho com QR.
 */
async function open(page: Page) {
  await page.route(/supabase\.co/, (r) => {
    const u = r.request().url();
    const json = (d: unknown) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (u.includes("list_tablet_accounts_public")) {
      return json([
        { id: "t1", label: "Line 3", line_ids: [], line_names: ["Line 3"], favicon_url: null },
        { id: "t2", label: "Line 4", line_ids: [], line_names: ["Line 4"], favicon_url: null },
      ]);
    }
    if (u.includes("signup_invite_code")) return json("AN-2026");
    return json(null);
  });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 20000 });
}

/** Contraste WCAG entre a cor do texto de um elemento e o branco do papel. */
async function contrastOnPaper(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const [r, g, b] = getComputedStyle(document.querySelector(sel)!).color.match(/\d+/g)!.map(Number);
    const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return 1.05 / (L + 0.05);
  }, selector);
}

test("o título não salta enquanto se escreve o email", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  // A entrada da coluna desliza 8px; mede-se depois de ela assentar.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const before = (await page.getByRole("heading", { name: "Sign in" }).boundingBox())!.y;
  // Com postos, o QR está à vista; um email troca-o pelo link. Centrada, a coluna
  // encolhia e o título descia 128px a meio da escrita.
  await page.fill("#identifier", "ana@appliednutrition.uk");
  await expect(page.getByText("Work account. What you can open follows your role.")).toBeVisible();
  const after = (await page.getByRole("heading", { name: "Sign in" }).boundingBox())!.y;
  expect(after).toBe(before);
});

test("uma password curta é dita na caixa do formulário, legível no papel", async ({ page }) => {
  await open(page);
  await page.fill("#identifier", "ana@appliednutrition.uk");
  await page.fill("#password", "abc");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#login-error")).toHaveText("Passwords here are at least 6 characters.");
  // O <html> traz sempre `.dark`; o erro usava o vermelho do tema escuro, ~2.6:1.
  expect(await contrastOnPaper(page, "#login-error")).toBeGreaterThanOrEqual(4.5);
});

test("um número de crachá é reconhecido e dito", async ({ page }) => {
  await open(page);
  await page.fill("#identifier", "E045");
  await expect(page.getByText("Employee E045")).toBeVisible();
});
