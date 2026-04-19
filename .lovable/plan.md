

User wants to apply the audit fixes. The plan was already approved implicitly by them saying "make the fixes now". I'll re-present a concise final plan covering all audit findings ready for implementation.

# Apply Post-Sprint Audit Fixes

## 🔴 Critical — Server-side PDF gating

Create new edge function `generate-wo-pdf-auth`:
- Validates JWT, checks `has_role(uid, 'admin'|'manager')` → 403 otherwise
- Logs `pdf.generated` to `audit_logs` via `log_audit_event` RPC
- Returns `{ ok: true }` so client can proceed with rendering

Update `src/lib/generatePdfReport.ts` and any PDF/print buttons in `WorkOrderDetail.tsx` and `AnalyticsPage.tsx` to call this function first; abort with toast on 403.

## 🟠 High — `wo_pauses` RLS hardening (migration)

Drop the 3 permissive policies and replace:
- **SELECT**: admin/manager OR engineer locked to the WO OR operator who created the WO
- **INSERT**: admin/manager OR the engineer currently `locked_engineer_id` of the WO
- **UPDATE**: same rule as INSERT (so only the locking engineer can resume their own pause)

## 🟠 High — `v_wo_metrics` GRANT (migration)

`GRANT SELECT ON public.v_wo_metrics TO authenticated;`
Confirm view runs with `security_invoker = true` to inherit `work_orders` RLS.

## 🟠 High — Defense-in-depth role guard on FinancialDashboard

`src/pages/dashboard/FinancialDashboard.tsx`: add `useRole()` early-return Access Denied screen for non-admin/manager, before any data hooks fire.

## 🟠 High — Metrics consolidation (single source of truth)

**`AnalyticsPage.tsx`** — remove inline `differenceInMinutes(finished_at, started_at)` math; use `useAllWoMetrics({ from, to })` for `avgResponse`, `avgMTTR`, downtime aggregations.

**`WorkOrderDetail.tsx`** — replace local attendance/production-impact card calculations with values from `useWoMetrics(workOrderId)`. Keep `WoTimeline` and cost breakdown unchanged.

## 🟡 Medium — Cleanup

- Add SQL `COMMENT ON TABLE public.downtime IS 'DEPRECATED — use downtime_events. Kept for historical data.'`
- Remove leftover dev `console.log` introduced during Etapas 1-3 (sweep `src/`)

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/<new>.sql` | wo_pauses RLS rewrite + v_wo_metrics grant + downtime deprecation comment |
| `supabase/functions/generate-wo-pdf-auth/index.ts` | NEW — role-gated PDF auth + audit log |
| `src/lib/generatePdfReport.ts` | Call edge function before rendering; abort on 403 |
| `src/pages/dashboard/FinancialDashboard.tsx` | Add useRole() early-return guard |
| `src/pages/dashboard/AnalyticsPage.tsx` | Swap to `useAllWoMetrics`; remove inline duration math |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Swap timing cards to `useWoMetrics` |

## Verification Checklist

- [ ] Engineer/operator hits PDF endpoint directly → 403 + audit log entry
- [ ] Manager/admin prints WO PDF → success + audit log entry
- [ ] Engineer A pauses WO locked to A → success; Engineer B pause attempt → blocked
- [ ] Operator queries `wo_pauses` directly → only own WO pauses visible
- [ ] Operator visiting `/dashboard/financial` → "Access Denied" (no data hooks fire)
- [ ] Analytics avg metrics match Manager Dashboard for same period
- [ ] WO Detail timing cards match `v_wo_metrics` row exactly
- [ ] No console errors on any dashboard load

