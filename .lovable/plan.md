

# Plan: Fix Console Errors and RLS Issues

## Issues Found

### 1. Downtime `FormFields` ref warning
**Root cause**: `FormFields` is defined as a nested function component inside the render. React tries to pass a ref to it from the Dialog, causing "Function components cannot be given refs" warning. Additionally, defining a component inside render causes it to remount on every state change, losing focus in form inputs.

**Fix** (`src/pages/dashboard/DowntimePage.tsx`):
- Convert `FormFields` from a nested component to inline JSX (just extract the JSX directly into both Dialog bodies), OR move it outside the component as a proper component with props
- Best approach: replace `<FormFields />` in both dialogs with the inline JSX content directly to avoid the ref issue and re-mount problem

### 2. Missing `DialogDescription` accessibility warning
**Root cause**: Both Create and Edit Downtime dialogs have `DialogContent` without a `DialogDescription`, which Radix UI warns about for accessibility.

**Fix** (`src/pages/dashboard/DowntimePage.tsx`):
- Add `import { DialogDescription }` 
- Add `<DialogDescription>` inside each `DialogHeader` with appropriate text (can use `className="sr-only"` to keep it visually hidden)

### 3. Downtime RLS — Engineers can only view, not create/update/delete
**Root cause**: Looking at the RLS policies, engineers only have SELECT access to the downtime table. If engineers need to register/edit/resolve downtime, they need INSERT/UPDATE/DELETE policies.

**Fix** (DB migration):
- Add RLS policies for engineers to INSERT, UPDATE, and DELETE downtime records

## Files Changed
| File | Change |
|------|--------|
| `src/pages/dashboard/DowntimePage.tsx` | Inline FormFields JSX, add DialogDescription |
| Migration SQL | Add engineer INSERT/UPDATE/DELETE policies for downtime |

