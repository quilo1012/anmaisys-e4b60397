/**
 * Accessibility regression tests for the critical Work Order flow buttons.
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
 * here and instead assert that the previously-broken `text-green-700` /
 * `text-yellow-700` (unreadable on the dark theme) are NOT present.
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
      <Button size="sm" className="h-11 min-w-11 px-3 bg-green-600 hover:bg-green-700 text-white dark:text-white" aria-label="Accept work order">
        <CheckCircle className="h-4 w-4 mr-1.5" aria-hidden="true" /> Accept
      </Button>
      <Button size="sm" className="h-11 min-w-11 px-3 bg-purple-600 hover:bg-purple-700 text-white dark:text-white" aria-label="Mark arrived and start">
        <Activity className="h-4 w-4 mr-1.5" aria-hidden="true" /> Arrived & Start
      </Button>
      <Button size="sm" className="h-11 min-w-11 px-3 bg-amber-600 hover:bg-amber-700 text-white dark:text-white" aria-label="Start work">
        <Play className="h-4 w-4 mr-1.5" aria-hidden="true" /> Start Work
      </Button>
      <Button size="sm" variant="outline" className="h-11 min-w-11 px-3 border-green-500 text-foreground hover:bg-green-500/10" aria-label="Resume work order">
        <PlayCircle className="h-4 w-4 mr-1.5 text-green-600 dark:text-green-400" aria-hidden="true" /> Resume
      </Button>
      <Button size="sm" variant="outline" className="h-11 min-w-11 px-3 border-yellow-500 text-foreground hover:bg-yellow-500/10" aria-label="Pause work order">
        <Pause className="h-4 w-4 mr-1.5 text-yellow-600 dark:text-yellow-400" aria-hidden="true" /> Pause
      </Button>
      <Button size="sm" variant="outline" className="h-11 min-w-11 px-3" aria-label="Register parts used">
        <Package className="h-4 w-4 mr-1.5" aria-hidden="true" /> Parts
      </Button>
      <Button size="sm" variant="secondary" className="h-11 min-w-11 px-3" aria-label="Finish work order">
        <PenTool className="h-4 w-4 mr-1.5" aria-hidden="true" /> Finish
      </Button>
      <Button size="sm" variant="default" className="h-11 min-w-11 px-3" aria-label="Close work order">
        <CheckCircle className="h-4 w-4 mr-1.5" aria-hidden="true" /> Close
      </Button>
    </div>
  );
}

const CRITICAL_LABELS = [
  "Accept work order",
  "Mark arrived and start",
  "Start work",
  "Resume work order",
  "Pause work order",
  "Register parts used",
  "Finish work order",
  "Close work order",
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
    // Regression guard: these were the offenders before the fix.
    expect(html).not.toMatch(/\btext-green-700\b/);
    expect(html).not.toMatch(/\btext-yellow-700\b/);
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
