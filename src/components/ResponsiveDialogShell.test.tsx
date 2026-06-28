import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ResponsiveDialogBody,
  dialogContentResponsive,
  dialogTitleResponsive,
  dialogFooterResponsive,
  dialogControlResponsive,
  dialogPrimaryActionResponsive,
} from "./ResponsiveDialogShell";

/**
 * These tokens drive the Open Order / Request Maintenance dialog layout.
 * Locking them in prevents accidental regressions on mobile / tablet / desktop.
 */
describe("Responsive dialog tokens (Open Order / Maintenance)", () => {
  it("dialog content fills small screens but caps on tablet+", () => {
    expect(dialogContentResponsive).toContain("w-[95vw]");
    expect(dialogContentResponsive).toContain("max-w-lg");
    expect(dialogContentResponsive).toContain("lg:max-w-xl");
    expect(dialogContentResponsive).toContain("max-h-[90vh]");
    expect(dialogContentResponsive).toContain("overflow-y-auto");
  });

  it("paddings scale by breakpoint (mobile / tablet / desktop)", () => {
    expect(dialogContentResponsive).toMatch(/\bp-4\b/);
    expect(dialogContentResponsive).toMatch(/sm:p-6/);
    expect(dialogContentResponsive).toMatch(/lg:p-8/);
  });

  it("title scales from lg → xl → 2xl", () => {
    expect(dialogTitleResponsive).toContain("text-lg");
    expect(dialogTitleResponsive).toContain("sm:text-xl");
    expect(dialogTitleResponsive).toContain("lg:text-2xl");
  });

  it("footer stacks on mobile and aligns row on tablet+", () => {
    expect(dialogFooterResponsive).toContain("flex-col-reverse");
    expect(dialogFooterResponsive).toContain("sm:flex-row");
  });

  it("form controls and primary action keep touch-friendly heights", () => {
    expect(dialogControlResponsive).toMatch(/h-11/);
    expect(dialogControlResponsive).toMatch(/sm:h-12/);
    expect(dialogPrimaryActionResponsive).toContain("w-full");
    expect(dialogPrimaryActionResponsive).toContain("sm:w-auto");
  });

  it("ResponsiveDialogBody renders children with responsive spacing", () => {
    render(
      <ResponsiveDialogBody data-testid="body">
        <span>child</span>
      </ResponsiveDialogBody>
    );
    const body = screen.getByTestId("body");
    expect(body.className).toContain("space-y-3");
    expect(body.className).toContain("sm:space-y-4");
    expect(body.className).toContain("lg:space-y-5");
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});

// Mimic checks at common viewport widths used by mobile (375), tablet (768),
// and desktop (1280). We assert the *Tailwind* breakpoint contract rather
// than computed layout (jsdom does not apply CSS).
describe.each([
  { label: "mobile",  width: 375,  expect: "w-[95vw]" },
  { label: "tablet",  width: 768,  expect: "sm:p-6" },
  { label: "desktop", width: 1280, expect: "lg:max-w-xl" },
])("Open Order dialog @ $label ($width px)", ({ expect: token }) => {
  it(`includes ${token} in dialog content class`, () => {
    expect(dialogContentResponsive.split(/\s+/)).toContain(token);
  });
});
