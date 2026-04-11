

# Disable Browser Auto-Fill Globally

## Approach

Rather than editing every form individually, apply anti-autofill at two central points plus CSS:

### 1. Global Input component — `src/components/ui/input.tsx`
Add `autoComplete="off"` as a default prop on the base `<input>` element. Individual components can still override it.

### 2. All `<form>` elements — add `autoComplete="off"`
Files with `<form>` tags to update:
- `src/pages/Login.tsx`
- `src/pages/users/ManageUsers.tsx` (2 forms)
- `src/pages/dashboard/WorkOrdersPage.tsx`
- `src/pages/dashboard/OperatorDashboard.tsx`
- `src/pages/dashboard/StockPage.tsx` (2 forms)
- `src/components/PartsUsedDialog.tsx`

### 3. CSS anti-autofill styling — `src/index.css`
Add webkit autofill override to prevent yellow/blue background:
```css
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus,
input:-webkit-autofill:active,
textarea:-webkit-autofill,
select:-webkit-autofill {
  -webkit-box-shadow: 0 0 0 1000px white inset !important;
  -webkit-text-fill-color: inherit !important;
  transition: background-color 9999s ease-in-out 0s;
}
```

### 4. Login page special handling
The Login page email/password fields should use `autoComplete="new-password"` to aggressively block Chrome's autofill on credential fields.

## Files to modify

| File | Change |
|------|--------|
| `src/components/ui/input.tsx` | Add `autoComplete="off"` default on `<input>` |
| `src/index.css` | Add webkit autofill CSS reset |
| `src/pages/Login.tsx` | `autoComplete="off"` on form, `autoComplete="new-password"` on inputs |
| `src/pages/users/ManageUsers.tsx` | `autoComplete="off"` on both forms |
| `src/pages/dashboard/WorkOrdersPage.tsx` | `autoComplete="off"` on form |
| `src/pages/dashboard/OperatorDashboard.tsx` | `autoComplete="off"` on form |
| `src/pages/dashboard/StockPage.tsx` | `autoComplete="off"` on both forms |
| `src/components/PartsUsedDialog.tsx` | `autoComplete="off"` on form |

No database changes needed.

