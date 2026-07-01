# Standardize Work Order Status Badges with `<StatusBadge>`

Scope: only swap the WO status badge rendering. No other UI, logic, query, or styling change. AuditLogsPage entity-type badges (`work_order`, `downtime`, etc.) stay untouched — they're entity types, not statuses, and the file contains no WO status renders.

## Files to change

### 1. `src/pages/dashboard/EngineerDashboard.tsx`
Add: `import { StatusBadge } from "@/components/ui/StatusBadge";`

Replace the three WO status `<Badge>` renderings (currently driven by `statusConfig[wo.status]` / `woStatusConfig`) with `<StatusBadge status={wo.status} />`:

- **~line 593–650** (card view): the `<Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>` next to `PriorityBadge` → `<StatusBadge status={wo.status} />`. Remove the now-unused `const cfg = statusConfig[wo.status] || statusConfig.open;` if no longer referenced in that block.
- **~line 929** (active WO table row): same `<Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>` → `<StatusBadge status={wo.status} />`. Remove the unused `cfg` local.
- **~line 1037** (completed/history table row): `<Badge variant="outline">{wo.status}</Badge>` → `<StatusBadge status={wo.status} />`.

Leave the `statusConfig` import in place only if still used elsewhere in the file (e.g. `priorityChipClass`); otherwise drop it. Do not touch any other badge, filter, query, or layout.

### 2. `src/components/EngineerDashboardView.tsx`
Add the `StatusBadge` import and replace the single `<Badge variant="outline">{o.status.toUpperCase()}</Badge>` in the table cell with `<StatusBadge status={o.status} />`. Remove the now-unused `Badge` import if nothing else uses it.

### 3. WorkOrderCard / WorkOrderList components
None exist in `src/components/` (verified via `rg`). Nothing to change.

### 4. `src/pages/dashboard/AuditLogsPage.tsx`
Verified: only renders `entity_type` and `action` badges (entity types, not WO statuses). No change per the user's rule.

## Out of scope (explicit)
- `OperatorDashboard.tsx`, `WorkOrdersPage.tsx`, `WorkOrderDetail.tsx`, `ControlCenterPage.tsx` — not listed in the request. Leave their existing `woStatusConfig`-based rendering untouched.
- `MachineSelector.tsx`, `RecurrenceBadge.tsx` — not WO status badges.
- No changes to `woStatusConfig.ts`, no changes to colors of unknown statuses (they fall back to neutral gray automatically via `StatusBadge`).

## Verification
- `tsgo` typecheck.
- Visual: open Engineer Dashboard, confirm WO status pills render with the new unified palette (open=blue, in_progress=amber, completed/closed/finished=green) and all other UI is unchanged.
