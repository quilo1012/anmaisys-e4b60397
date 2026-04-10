

# Fix 7 Production Bugs

## Root Cause

After thorough investigation, I found that **most fixes already exist in the codebase but have not been published to production**. The published site at `anmaisys.lovable.app` is running an older version. Frontend changes require clicking "Publish" > "Update" to go live.

Here is the status of each bug and what still needs code changes:

| Bug | Status in Codebase | Needs Code Fix? |
|-----|-------------------|-----------------|
| 1. Duplicate MTTR | Fixed — line 121 shows "SLA Compliance" with ShieldCheck icon | No — just publish |
| 2. Seed Demo Data | Fixed — button fully removed from ManagerDashboard | No — just publish |
| 5. Top Engineers "Unknown" | Fixed — `useEngineerScores.ts` joins both `profiles` and `engineers` tables | No — just publish |
| 6. Audit Logs empty | Code calls `logAuditEvent` in all required places, but **0 records in DB** | Yes — see below |
| 7. Requested By auto-fill | Fixed — Input is read-only with `bg-muted` styling, uses `profile?.name` | No — just publish |
| 8. Stale WO badge | Fixed — orange "Stale WO" badge in EngineerDashboard for >72h WOs | No — just publish |
| 9. Daniel as Admin | Fixed — DB shows `role: admin` for `daniel.quilo@appliednutrition.uk` | No |

## Remaining Code Fix: Login `dashMap` missing `manager` role

**File:** `src/pages/Login.tsx` line 35-39

The `dashMap` after login doesn't include the `manager` role, so managers fall to the default path. This needs adding:

```typescript
const dashMap: Record<string, string> = {
  admin: "/dashboard/manager",
  manager: "/dashboard/manager",  // ← ADD THIS
  engineer: "/dashboard/engineer",
  operator: "/dashboard/operator"
};
```

## BUG 6 Investigation: Audit Logs Still Empty

The `log_audit_event` database function is `SECURITY DEFINER` (bypasses RLS), and the code calls it correctly via `supabase.rpc()`. The `audit_logs` table has **no INSERT RLS policy**, but since the function is SECURITY DEFINER, that shouldn't matter.

The most likely cause: the code with `logAuditEvent` calls was never published, so production never executes them. After publishing, new logins and WO actions should start generating audit records.

However, as a safety measure, I will also add an INSERT policy for authenticated users so that if any direct inserts are attempted, they won't be silently blocked.

## Implementation

1. Add `manager` to Login dashMap
2. Add INSERT RLS policy on `audit_logs` for authenticated users (belt-and-suspenders)
3. After implementation, user must click **Publish > Update** to deploy all fixes to production

