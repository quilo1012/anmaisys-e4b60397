import { defineConfig } from "@playwright/test";

/**
 * Browser checks for the things jsdom cannot answer.
 *
 * The unit suite renders every screen, but jsdom performs no layout and loads no
 * Tailwind: it can tell you a button carries `min-h-11`, never that the button is
 * 44 pixels tall or that the page fits the width of a phone. These run in a real
 * Chromium at real viewport sizes and measure.
 *
 * They never reach the internet: every request to Supabase is intercepted in the
 * spec, so no fixture can touch the production database.
 */
/**
 * A porta, e porque é que ela se pode mudar.
 *
 * `reuseExistingServer` aproveita o que já estiver na porta — o que é exactamente o que
 * se quer quando o dev server é o nosso. Quando não é, a suite corre contra OUTRO clone
 * e passa: aconteceu a 20/09, com quatro testes verdes contra o `main` enquanto o ramo
 * que eles deviam estar a medir não tinha sido servido a ninguém. Neste repositório há
 * meia dúzia de worktrees ao mesmo tempo, por isso a porta 8080 raramente é de quem a
 * está a usar.
 *
 * `PW_PORT=9111 npx playwright test` levanta um servidor só nosso, a partir do
 * worktree onde o comando é dado.
 */
const PORT = process.env.PW_PORT ?? "8080";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // CI and local runs use the browser `playwright install` downloads. Sandboxes
    // whose system libraries that build needs are absent can point PW_CHROME_PATH
    // at any compatible chromium/headless_shell instead.
    launchOptions: process.env.PW_CHROME_PATH ? { executablePath: process.env.PW_CHROME_PATH } : {},
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Numa porta escolhida à mão o servidor é nosso de propósito: aproveitar um que já
    // lá esteja seria outra vez medir o clone de outra pessoa.
    reuseExistingServer: !process.env.PW_PORT,
    timeout: 120_000,
  },
});
