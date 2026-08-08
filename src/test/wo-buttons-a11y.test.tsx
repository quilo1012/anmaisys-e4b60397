/**
 * Accessibility regression tests for the critical Maintenance Order flow buttons.
 *
 * Guards against regressions of:
 *  - Hit area (WCAG 2.5.5): h-11 + min-w-11 utility classes (≥ 44×44px)
 *  - Accessible name (WCAG 4.1.2): aria-label on every action button
 *  - Decorative icons hidden from AT: aria-hidden on lucide icons
 *  - ARIA correctness via jest-axe
 *
 * The button markup mirrors EngineerDashboard.tsx (lines ~808-841) and
 * OperatorDashboard.tsx (line ~571). If those change, update this file.
 *
 * NOTE on contrast: axe's color-contrast rule requires a real layout engine
 * with applied CSS. jsdom does not load Tailwind, so we disable that rule
 * here and assert on the class names instead.
 *
 * O que esta guarda protege mudou de forma, mas não de intenção. Guardava contra
 * `text-green-700` e `text-yellow-700` — cores de um só valor, que não viram com o
 * tema e por isso desapareciam no escuro. A correcção da altura foi escrever o par à
 * mão, `text-green-600 dark:text-green-400`.
 *
 * Esse par é agora um token: `text-success-strong` e `text-warning-strong` trazem os
 * dois valores dentro de si (10.6:1 e 10.5:1 sobre o fundo escuro, 5.4:1 e 5.3:1 sobre
 * o claro). Não são o defeito que a guarda perseguia — são a sua correcção dita uma
 * vez em vez de duas.
 *
 * Por isso a guarda passa a ser sobre a causa e não sobre os sintomas: nenhuma classe
 * da paleta crua do Tailwind entra nestes botões, porque nenhuma delas vira com o tema.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  Activity,
  Play,
  PlayCircle,
  Pause,
  Package,
  PenTool,
} from "lucide-react";

expect.extend(toHaveNoViolations);

function WOActionButtons() {
  return (
    <div className="flex gap-2 flex-wrap">
      <Button size="sm" className="h-11 min-w-11 px-3 bg-success hover:bg-success/90 text-success-foreground" aria-label="Accept maintenance order">
        <CheckCircle className="h-4 w-4 mr-1.5" aria-hidden="true" /> Accept
      </Button>
      <Button size="sm" className="h-11 min-w-11 px-3 bg-purple-600 hover:bg-purple-700 text-white dark:text-white" aria-label="Mark arrived and start">
        <Activity className="h-4 w-4 mr-1.5" aria-hidden="true" /> Arrived & Start
      </Button>
      <Button size="sm" className="h-11 min-w-11 px-3 bg-warning hover:bg-warning/90 text-warning-foreground" aria-label="Start work">
        <Play className="h-4 w-4 mr-1.5" aria-hidden="true" /> Start Work
      </Button>
      <Button size="sm" variant="outline" className="h-11 min-w-11 px-3 border-success text-foreground hover:bg-success/10" aria-label="Resume maintenance order">
        <PlayCircle className="h-4 w-4 mr-1.5 text-success-strong" aria-hidden="true" /> Resume
      </Button>
      <Button size="sm" variant="outline" className="h-11 min-w-11 px-3 border-warning text-foreground hover:bg-warning/10" aria-label="Pause maintenance order">
        <Pause className="h-4 w-4 mr-1.5 text-warning-strong" aria-hidden="true" /> Pause
      </Button>
      <Button size="sm" variant="outline" className="h-11 min-w-11 px-3" aria-label="Register parts used">
        <Package className="h-4 w-4 mr-1.5" aria-hidden="true" /> Parts
      </Button>
      <Button size="sm" variant="secondary" className="h-11 min-w-11 px-3" aria-label="Finish maintenance order">
        <PenTool className="h-4 w-4 mr-1.5" aria-hidden="true" /> Finish
      </Button>
      <Button size="sm" variant="default" className="h-11 min-w-11 px-3" aria-label="Close maintenance order">
        <CheckCircle className="h-4 w-4 mr-1.5" aria-hidden="true" /> Close
      </Button>
    </div>
  );
}

const CRITICAL_LABELS = [
  "Accept maintenance order",
  "Mark arrived and start",
  "Start work",
  "Resume maintenance order",
  "Pause maintenance order",
  "Register parts used",
  "Finish maintenance order",
  "Close maintenance order",
];

describe("WO flow critical buttons — accessibility", () => {
  it("renders every critical action with an accessible name", () => {
    const { container } = render(<WOActionButtons />);
    for (const label of CRITICAL_LABELS) {
      const btn = container.querySelector(`button[aria-label="${label}"]`);
      expect(btn, `missing button for "${label}"`).not.toBeNull();
    }
  });

  it("meets the 44×44 hit area (WCAG 2.5.5) — h-11 + min-w-11", () => {
    const { container } = render(<WOActionButtons />);
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(CRITICAL_LABELS.length);
    buttons.forEach((btn) => {
      expect(btn.className, `${btn.getAttribute("aria-label")} missing h-11`).toContain("h-11");
      expect(btn.className, `${btn.getAttribute("aria-label")} missing min-w-11`).toContain("min-w-11");
    });
  });

  it("marks lucide icons as decorative (aria-hidden)", () => {
    const { container } = render(<WOActionButtons />);
    const icons = container.querySelectorAll("button svg");
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((svg) => {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("does NOT use dark-mode-unreadable text colors on outline buttons", () => {
    const { container } = render(<WOActionButtons />);
    const html = container.innerHTML;
    // Uma cor da paleta crua é um valor só: seja qual for o degrau escolhido, ou falha
    // no claro ou falha no escuro. É essa a origem do defeito, não um degrau em
    // particular, por isso a guarda apanha a família inteira.
    expect(html).not.toMatch(
      /\btext-(slate|gray|zinc|neutral|emerald|green|teal|amber|yellow|orange|red|rose|blue|sky|indigo|cyan|violet|purple)-\d{2,3}\b/,
    );
  });

  it("has no axe violations (ARIA / name / role)", async () => {
    const { container } = render(<WOActionButtons />);
    const results = await axe(container, {
      // jsdom has no real CSS — color-contrast can't be evaluated here.
      // Contrast is asserted structurally by the regression test above.
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
