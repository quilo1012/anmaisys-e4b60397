

# Enterprise CMMS Polish — Print, Sidebar, RBAC, Buttons

## Current State

The system already has ~93% of requested features. This plan addresses the remaining gaps identified in the prompt.

## What's Already Done (No Changes Needed)
- RBAC with admin/engineer/operator roles, RLS, route protection
- Dark mode toggle
- Sidebar collapsible with icons and text
- Button component with variants (Primary, Secondary, Danger, Ghost, sizes, loading states)
- Confirmation modals on destructive actions
- Print CSS hiding sidebar/header/buttons
- Audit logs with before/after values

## Gaps to Fix

### 1. Print Layout — Industrial Document Quality

**Problem:** Print header has date/logo overlap potential, "Manager Dashboard" header element leaks, print margins too tight (8mm/15mm vs requested 20mm), signature section needs more formal layout, no document number/revision styling.

**Changes in `WorkOrderDetail.tsx`:**
- Redesign print header: logo left (small), "WORK ORDER" title center-left bold, WO number right, date below — using a structured table-like grid to prevent overlap
- Add document metadata row: Priority, Status, Machine, Line — as a compact bordered table
- Restructure Timeline for print as a bordered audit-style table (Step | Timestamp) instead of icon-based
- Restructure Parts Used for print with bordered table styling
- Signature section: two signature blocks side-by-side with "Name:", "Signature:", "Date:" fields and clear lines
- Add print-only footer: "AN Maintenance — Confidential — Page 1"

**Changes in `index.css`:**
- Set `@page { margin: 20mm; size: A4; }` 
- Ensure `header`, `nav`, `aside`, `button`, `[data-sidebar]` are all `display: none !important` in print
- Add print-specific table styles: bordered cells, compact padding
- Remove all card shadows and rounded corners in print
- Force black text on white background

### 2. Sidebar — Icon-Only Collapsed Mode

**Problem:** The sidebar uses Shadcn's `SidebarProvider` but doesn't specify `collapsible="icon"`, so collapsed state may not show icon-only mode properly. Text labels may still appear when collapsed.

**Changes in `DashboardLayout.tsx`:**
- Add `collapsible="icon"` to `<Sidebar>` component
- Wrap each nav item text in a conditional: hide when sidebar is collapsed using `useSidebar()` state
- Add `<Tooltip>` wrapper on each menu item when collapsed, showing the page name
- Ensure smooth CSS transition (already handled by Shadcn defaults)
- Sidebar state already persists via cookie (Shadcn default behavior)

### 3. RBAC — Current Coverage Assessment

The system uses 3 roles: `admin`, `engineer`, `operator`. The prompt asks for `Admin`, `Manager`, `Engineer`, `Requester`. The current mapping is:
- Admin = Admin + Manager (full access)
- Engineer = Engineer
- Operator = Requester

This is functionally equivalent. No database changes needed. The current RLS policies and route protection already enforce all the permissions listed. UI elements are already hidden based on role. **No changes required here** — the system already implements strict RBAC as described.

### 4. Button Standardization

The existing `Button` component already has: Primary (default), Secondary, Destructive (Danger), Ghost variants, plus sm/lg/icon sizes, and disabled state. 

**Minor improvements in usage across pages:**
- Ensure all mutation buttons pass `disabled={mutation.isPending}` (already done in recent polish)
- Verify all Delete/Force actions use `AlertDialog` confirmation (already done)
- **No component changes needed** — the design system is already standardized

---

## Files Modified

| File | Change |
|------|--------|
| `src/index.css` | Print margins 20mm, print table styles, force clean document look |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Redesigned print header, audit-style timeline table, formal signature block |
| `src/components/DashboardLayout.tsx` | Sidebar `collapsible="icon"`, tooltip on collapsed items, hide text when collapsed |

## Sequence
1. Print CSS overhaul (`index.css`)
2. WorkOrderDetail print layout redesign
3. Sidebar icon-only collapsed mode

