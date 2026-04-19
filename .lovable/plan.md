

User wants component-level role guards in the three role-specific dashboards as defense-in-depth. The routes are already gated by `<ProtectedRoute>` in App.tsx, but adding inline checks prevents leaks if anyone imports the component directly or if ProtectedRoute is bypassed.

Looking at existing patterns:
- `FinancialDashboard.tsx` already got an early-return guard in the previous fix using `useRole()`
- `ProtectedRoute` uses `<Navigate to="/login" replace />` for unauthenticated users
- User explicitly asks to redirect to `/login` if role mismatch (not show "Access Denied")

Allowed roles per dashboard (from App.tsx routes):
- `OperatorDashboard` → `["operator"]`
- `EngineerDashboard` → `["engineer"]`
- `ManagerDashboard` → `["admin", "manager"]`

# Add Role Guards to Role-Specific Dashboards

## Goal
Defense-in-depth: each dashboard component verifies the user's role itself and redirects to `/login` on mismatch, even if `ProtectedRoute` is bypassed.

## Pattern (applied to each file)

At the top of the component, after `useAuth()`:

```tsx
const { role, loading } = useAuth();

if (loading) return <PageLoader />;          // wait for role to resolve
if (!ALLOWED.includes(role)) {
  return <Navigate to="/login" replace />;
}
```

Place BEFORE any data-fetching hooks so unauthorized roles never trigger queries.

## Files Changed

| File | Allowed roles |
|------|---------------|
| `src/pages/dashboard/OperatorDashboard.tsx` | `operator` |
| `src/pages/dashboard/EngineerDashboard.tsx` | `engineer` |
| `src/pages/dashboard/ManagerDashboard.tsx` | `admin`, `manager` |

Import `Navigate` from `react-router-dom` and `useAuth` from `@/contexts/AuthContext` where missing.

## Verification

- [ ] Operator visits `/dashboard/manager` directly → redirected to `/login`
- [ ] Engineer visits `/dashboard/operator` directly → redirected to `/login`
- [ ] Manager visits `/dashboard/engineer` directly → redirected to `/login`
- [ ] Each role visits its own dashboard → loads normally
- [ ] No data-fetching hooks fire for unauthorized roles (check React Query devtools)

