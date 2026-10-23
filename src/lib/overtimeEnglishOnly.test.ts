import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The overtime screens are English whatever the browser's language is. A date
 * formatted with `undefined` as the locale follows the browser, so a phone set to
 * Portuguese showed "sexta-feira, 23 de outubro" inside an English alert.
 */
describe("overtime screens never format dates in the browser's language", () => {
  const files = [
    "src/components/workforce/OvertimeRequestsPanel.tsx",
    "src/pages/dashboard/MyOvertimePage.tsx",
  ];
  for (const f of files) {
    it(f, () => {
      expect(readFileSync(f, "utf8")).not.toMatch(/toLocale(Date|Time)?String\(\s*undefined/);
    });
  }
});
