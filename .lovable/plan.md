# Unify access control under the Permissions Matrix

Goal: make `can(role, action)` the single source of truth applied at runtime for every route and every sidebar item, while guaranteeing no role loses access it has today and admin can never lock itself out.

## Guiding rules for the mapping

For each route we pick one Action from `ALL_ACTIONS` and, when the route's current `allowedRoles` is broader than the Action's MATRIX row, we widen the MATRIX row to the union `MATRIX[action] ∪ allowedRoles` (minus `admin`, always implicit). No MATRIX row is ever narrowed. `co_engineer` inherits `engineer` at the gate layer, so we don't need to add it to MATRIX rows where `engineer` is present.

Legend for the "MATRIX change" column: `=` no change, `+X` add role X to that MATRIX row.

## 1. Route → Action mapping (every route in `App.tsx`)

| Route | Current `allowedRoles` | Action | Current MATRIX row | MATRIX change to preserve access |
|---|---|---|---|---|
| `/dashboard/operator` | admin, manager, operator, engineer, maintenance_manager | `dashboard.operator` | admin, operator | **+manager, +engineer, +maintenance_manager** |
| `/dashboard/operator/my-production` | operator | `production.target.view` | admin, manager, supervisor, maintenance_manager, planner, operator | = (operator already in) |
| `/dashboard/operator/performance` | operator | `production.performance.view` | admin, manager, supervisor, maintenance_manager, planner | **+operator** |
| `/dashboard/warehouse` | warehouse, admin | *(no action — see Risks §1)* | — | keep `allowedRoles` fallback |
| `/dashboard/engineer` | engineer, co_engineer, admin, manager, supervisor, maintenance_manager, planner | `dashboard.engineer` | admin, engineer, co_engineer | **+manager, +supervisor, +maintenance_manager, +planner** |
| `/dashboard/manager` | admin, manager, supervisor, maintenance_manager, planner, viewer | `dashboard.manager` | admin, manager, supervisor, maintenance_manager, planner, viewer | = |
| `/dashboard/analytics` | admin, manager, supervisor | `reports.analytics` | admin, manager, supervisor | = |
| `/dashboard/financial` | admin | `reports.financial` | admin | = |
| `/dashboard/work-orders` | admin, manager, supervisor, maintenance_manager, planner | `wo.view` | ALL + warehouse | = |
| `/dashboard/machines` | admin, manager, supervisor, maintenance_manager, planner | `machines.view` | ALL | = |
| `/dashboard/problems` | admin, manager, supervisor, maintenance_manager, planner | `problems.view` | ALL | = |
| `/dashboard/control-center` | admin, manager, supervisor, maintenance_manager, planner | `controlcenter.view` | admin, manager, supervisor, maintenance_manager | **+planner** |
| `/dashboard/machines/:name/history` | admin, manager, supervisor, maintenance_manager, planner | `machines.view` | ALL | = |
| `/dashboard/audit-logs` | admin | `audit.view` | admin, manager, supervisor | = (narrower `allowedRoles`, but with new rule the gate becomes `can(admin,audit.view)`; **manager & supervisor GAIN access via matrix** — see Risks §2) |
| `/dashboard/executive` | admin | `reports.executive` | admin | = |
| `/dashboard/downtime` | admin, manager, supervisor, maintenance_manager, planner | `downtime.view` | ALL | = |
| `/dashboard/preventive` | admin, manager, supervisor, engineer, co_engineer, maintenance_manager, planner | `pm.view` | admin, manager, supervisor, maintenance_manager, engineer, co_engineer | **+planner** |
| `/dashboard/reliability` | admin, manager, supervisor, maintenance_manager, planner | `reports.analytics` | admin, manager, supervisor | **+maintenance_manager, +planner** (or introduce `reliability.view`, see Risks §3) |
| `/dashboard/wo/:id` | operator, engineer, co_engineer, admin, manager, supervisor, maintenance_manager, planner | `wo.view` | ALL + warehouse | = |
| `/dashboard/stock` | engineer, co_engineer, admin, manager, supervisor, maintenance_manager, planner | `stock.view` | admin, manager, supervisor, maintenance_manager, planner, engineer, co_engineer | = |
| `/users/manage` | admin, manager | `users.manage` | admin, manager | = |
| `/dashboard/users` | admin | `users.manage` | admin, manager | = (manager gains via matrix — see Risks §2) |
| `/dashboard/permissions` | admin | `permissions.manage` | admin | = |
| `/dashboard/settings` | admin | `system.settings` | admin | = |
| `/dashboard/suppliers` | admin, manager, supervisor, maintenance_manager, planner | `stock.manage` | admin, manager, supervisor | **+maintenance_manager, +planner** (or introduce `suppliers.view` — Risks §3) |
| `/dashboard/planner` | admin, manager, planner | `planner.manage` | admin, manager, planner | = |
| `/dashboard/sku-products` | admin, manager | `sku.manage` | admin, manager, planner | = (planner gains via matrix — see Risks §2) |
| `/dashboard/production-performance` | admin, manager | `production.performance.view` | admin, manager, supervisor, maintenance_manager, planner | = (supervisor/mm/planner gain — Risks §2) |
| `/dashboard/smart-target` | admin, manager | `smarttarget.view` | admin, manager, supervisor, maintenance_manager, planner | = (others gain — Risks §2) |
| `/dashboard/weekly-report` | admin, manager | `rag.view` | admin, manager, supervisor, maintenance_manager, planner | = (others gain — Risks §2) |
| `/dashboard/sku-efficiency` | admin, manager | `sku.view` | admin, manager, supervisor, maintenance_manager, planner, operator | = (others gain — Risks §2) |
| `/dashboard/forecast` | admin, manager | `production.performance.view` | admin, manager, supervisor, maintenance_manager, planner | = (others gain — Risks §2) |
| `/dashboard/quality` | admin, manager | `quality.view` | admin, manager, supervisor, engineer, co_engineer | = (others gain — Risks §2) |
| `/dashboard/shift-history` | admin, manager | `production.manage` | admin, manager, supervisor, maintenance_manager, planner, operator | = (others gain — Risks §2) |
| `/dashboard/rag-weekly` | admin, manager, supervisor, maintenance_manager, planner | `rag.view` | admin, manager, supervisor, maintenance_manager, planner | = |
| `/dashboard/line-production` | admin, manager, supervisor, engineer, co_engineer, maintenance_manager, planner | `production.manage` | admin, manager, supervisor, maintenance_manager, planner, operator | **+engineer** |
| `/dashboard/line-display` | admin, manager, supervisor, operator, engineer, co_engineer, maintenance_manager, planner | `production.view` | ALL | = |
| `/dashboard/intouch-settings` | admin | `intouch.manage` | admin, maintenance_manager | = (mm gains — Risks §2) |
| `/dashboard/intouch-machines` | admin | `intouch.manage` | admin, maintenance_manager | = |
| `/dashboard/intouch-stop-codes` | admin | `intouch.manage` | admin, maintenance_manager | = |
| `/dashboard/pm-intelligence` | admin, manager, supervisor, maintenance_manager, planner | `pm.view` | admin, manager, supervisor, maintenance_manager, engineer, co_engineer | **+planner** (engineer/co_engineer already implicit) |
| `/dashboard/operator-preview` | admin, manager, supervisor, maintenance_manager, planner | *(preview — see Risks §4)* | — | keep `allowedRoles` fallback |
| `/dashboard/engineer-preview` | admin, manager, supervisor, maintenance_manager, planner | *(preview — see Risks §4)* | — | keep `allowedRoles` fallback |
| `/dashboard/messages` | operator, manager, supervisor, maintenance_manager, planner, admin (already has `requiredAction="chat.dm"`) | `chat.dm` | *(empty today)* | **set to `[admin, manager, supervisor, maintenance_manager, planner, operator]`** so this route stops being effectively blocked once we honor `requiredAction` exclusively |
| `/`, `*` (SessionRedirect) | — | — | — | no gate |
| `/login`, `/.lovable/oauth/consent` | public | — | — | no gate |

### Consolidated MATRIX diff (defaults, admin implicit)

```text
dashboard.operator            + manager, engineer, maintenance_manager
dashboard.engineer            + manager, supervisor, maintenance_manager, planner
controlcenter.view            + planner
pm.view                       + planner
reports.analytics             + maintenance_manager, planner       (only if we reuse it for /reliability; otherwise add new reliability.view — see Risks §3)
stock.manage                  + maintenance_manager, planner       (only if we reuse it for /suppliers; otherwise add new suppliers.view)
production.performance.view   + operator                           (only for /operator/performance)
production.manage             + engineer                           (for /line-production)
chat.dm                       = [admin, manager, supervisor, maintenance_manager, planner, operator]  (was empty)
```

No other row changes. `warehouse` is not added to any new action — the warehouse route keeps the `allowedRoles` fallback.

## 2. `ProtectedRoute` change

New gate order (`src/components/ProtectedRoute.tsx`, replacing the current `allowedRoles && !allowedRoles.includes(...) || requiredAction && !can(...)` block):

```text
1. effectiveRole = role === "co_engineer" ? "engineer" : role
2. if effectiveRole === "admin" → allow                     // admin bypass, no self-lockout
3. if requiredAction is set → allow iff can(effectiveRole, requiredAction)
                              (ignore allowedRoles entirely — no AND lockout)
4. else if allowedRoles is set → allow iff allowedRoles.includes(effectiveRole)
5. else → allow
```

The existing loading / auth-error / deactivated / no-session branches stay untouched.

Every route in `App.tsx` from the table above gets a `requiredAction={...}` prop added; `allowedRoles` stays as a safety net (used only for the routes that intentionally don't have an action: `warehouse`, `operator-preview`, `engineer-preview`).

## 3. Sidebar (`navItems` in `DashboardLayout.tsx`)

- Add an `action: Action` field to every entry (`action` is already optional on the type). Use the same mapping as the routes table.
- Change the `filteredItems` filter (line 383) from `roles.includes(role)` to:
  - `if (role === "admin") show`
  - `else if item.action → can(effectiveRole, item.action)`
  - `else → item.roles.includes(effectiveRole)` (fallback for `Warehouse` / previews if we ever add them)
- Keep `roles` on each item as a UX hint / fallback; nothing else needs to change (grouping, ordering, icons stay).
- Subscribe to `subscribePermissionOverrides` in `DashboardLayout` (same pattern as `ProtectedRoute`) so toggling permissions in the Matrix updates the sidebar live.

Sidebar item → action assignments (only the ones not obvious from §1):

```text
Dashboard (operator)    dashboard.operator
My Production           production.target.view
Dashboard (engineer)    dashboard.engineer
My Tasks / History      dashboard.engineer
Dashboard (manager)     dashboard.manager
Control Center          controlcenter.view
Work Orders             wo.view
Downtime & Reliability  downtime.view
PM Intelligence         pm.view
Machines                machines.view
Problems                problems.view
Stock                   stock.view
Planner                 planner.manage
Production Control      production.manage
RAG Weekly              rag.view
Performance             production.performance.view
Quality Actions         quality.view
SKU Products            sku.manage
SKU Efficiency          sku.view
Forecast                production.performance.view
Smart Target            smarttarget.view
Analytics               reports.analytics
Financial               reports.financial
Executive               reports.executive
Weekly Report           rag.view
Messages                chat.dm            (already there)
Users                   users.manage
Audit Logs              audit.view
Permissions             permissions.manage
Settings                system.settings
Operator Preview        (no action — fallback to roles)
Engineer Preview        (no action — fallback to roles)
```

## 4. Risks & special cases

1. **`/dashboard/warehouse`** — the whole point of the `warehouse` role is a locked-down page; there's no matching Action and warehouse is deliberately excluded from most MATRIX rows. Decision: keep this route on `allowedRoles=["warehouse","admin"]` with **no `requiredAction`**. It won't be governed by the Matrix — that's intentional and documented in the route.
2. **Roles that GAIN access via the matrix** (rows where MATRIX today is broader than the route's `allowedRoles`): `/dashboard/audit-logs`, `/dashboard/users`, `/dashboard/sku-products`, `/dashboard/production-performance`, `/dashboard/smart-target`, `/dashboard/weekly-report`, `/dashboard/sku-efficiency`, `/dashboard/forecast`, `/dashboard/quality`, `/dashboard/shift-history`, `/dashboard/intouch-settings`. The requirement is access-**preserving**, not access-**freezing** — no one loses access, and the matrix now becomes the single knob the admin can tighten. If you'd rather keep any of these locked to the current `allowedRoles`, tell me which and I'll **narrow the MATRIX row** in the same change (safe: admin still bypasses). Two clean options per row:
   - **Option A (recommended):** accept the widened default, admin narrows in the UI as needed.
   - **Option B:** narrow the MATRIX row to exactly the route's current `allowedRoles` in the same PR.
3. **Routes with no perfect action** — `/dashboard/reliability` and `/dashboard/suppliers` don't have a dedicated action today. Two options:
   - **A.** Reuse `reports.analytics` / `stock.manage` and widen those rows as shown in the diff.
   - **B.** Add two new actions `reliability.view` and `suppliers.view`, seed each with the current `allowedRoles`, and register them in `ACTION_GROUPS` / `ACTION_DESCRIPTIONS`. Cleaner long-term, one extra migration-free code change. I'll default to **B** unless you prefer A.
4. **Preview routes** (`/dashboard/operator-preview`, `/dashboard/engineer-preview`) — intentionally admin-role-shaped diagnostics for non-operator/non-engineer roles. Keep on `allowedRoles` only, no action, no matrix entry.
5. **`chat.dm` row is empty today** — `/dashboard/messages` currently allow-lists the roles inline. Once we honor `requiredAction`, an empty row would lock everyone (except admin via bypass). Seed the row to the exact current inline list so behavior is preserved.
6. **`co_engineer` inheritance** — done at gate level (`effectiveRole` mapping), so no MATRIX rows need `co_engineer` added anywhere. Existing MATRIX rows that list `co_engineer` explicitly stay as-is (harmless).
7. **Overrides table (`role_permission_overrides`)** — no schema change. `can()` already consults overrides; both the new `ProtectedRoute` and the new sidebar filter go through it, so admin edits in the Permissions Matrix take effect live for both.
8. **Live update on override change** — `ProtectedRoute` already subscribes; `DashboardLayout` needs the same subscription so the sidebar re-filters without a reload.
9. **No RLS / no data-layer change** — this plan touches only route/sidebar presentation gating. Server-side authorization (RLS, edge functions) is untouched.

## Deliverable when you approve

Two files edited (`src/lib/permissions.ts` for the MATRIX widenings + optional new actions; `src/components/ProtectedRoute.tsx` for the new gate order), `src/App.tsx` gets `requiredAction` added to every gated route, `src/components/DashboardLayout.tsx` gets `action` on each `navItem` + the new filter + override subscription. No migrations, no query changes.

Please confirm:
- **(a)** Option A or B for Risks §2 (widened defaults vs. narrow MATRIX to match today).
- **(b)** Option A or B for Risks §3 (reuse actions vs. add `reliability.view` / `suppliers.view`).
