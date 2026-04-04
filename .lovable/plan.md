

# Fix: Work Order Print/PDF — Remove Remaining App UI Leaks

## Problem

The DashboardLayout's `<header>` element (line 168) contains the dashboard title ("Manager Dashboard" / "Engineer Dashboard"), icons, clock, and notification panel. The CSS print rules hide `header` by tag but the selector may conflict with the print-only document header inside `#wo-print-content`. Additionally, the `<main>` wrapper and flex container may still show layout artifacts.

Key issues:
1. The app `<header>` with "Manager Dashboard" title, clock, dark mode button may still appear in print if CSS specificity fails
2. The `[class*="flex"]` rule on line 188-189 forces `display: block` on ALL flex elements globally, then re-enables only inside `.print-content` — this could break the print document header's flex layout
3. The `PenTool` icon in the "Signed By" personnel card (line 250) renders in print
4. No explicit hiding of the page URL that browsers add by default

## Changes

### `src/index.css` — Tighten print CSS

- Add explicit selectors to hide the DashboardLayout app header: `.h-14.border-b` (the header bar)
- Remove the overly broad `[class*="flex"]` → `display: block` rule that breaks print layouts; instead, only force `display: block` on specific app-level wrappers
- Add `@page` margin note — URL hiding is browser-controlled, but we can suppress via header/footer

### `src/pages/dashboard/WorkOrderDetail.tsx` — Minor cleanup

- Remove the `PenTool` icon from the print-visible "Signed By" card (line 250) — icons shouldn't appear in print document
- Add `print:hidden` to the Signed By icon specifically
- Ensure the print document header flex layout works by using explicit print classes

### `src/components/DashboardLayout.tsx` — Add print:hidden to app header

- Add `print:hidden` class to the `<header className="h-14 ...">` element so it's explicitly hidden in print regardless of CSS specificity

## Files modified

| File | Change |
|------|--------|
| `src/components/DashboardLayout.tsx` | Add `print:hidden` to app header bar |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Hide PenTool icon in print; ensure clean print output |
| `src/index.css` | Fix overly broad flex→block rule; add robust app UI hiding for print |

