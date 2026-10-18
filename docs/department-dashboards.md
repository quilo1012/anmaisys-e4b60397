# Department dashboards

One dashboard per department, at `/dashboard/departments/<key>`. Each one is assembled from the
hooks and rules of the screens it summarises, and each **section** checks the action of the
screen it comes from. The page action (`dashboard.production`, `dashboard.maintenance`) only
decides who can open the page. It grants no data: the database's RLS still decides every row.

Building blocks: `src/components/dashboards/DashboardParts.tsx` (Panel, BarList, AlertList,
QuickActions, NotYours) and `TrendColumns.tsx`. KPI tiles are the existing `KpiCard`.

## Live

### Production — `/dashboard/departments/production`

| Section | Source | Gate |
|---|---|---|
| Staffing (due in, working, away, not placed, overtime, training) | `tallyBoard` (`src/lib/boardTally.ts`), the Headcount board's own count, which the board now reads too | `headcount.view` |
| Day vs night, by line/area, trend, absence breakdown | the same board rows; trend from `useBoardTrend` | `headcount.view` |
| Overtime (places filled/wanted, still to fill, awaiting decision, worked, cancelled, by shift) | `overtimeCoverage` (`src/lib/overtimeCoverage.ts`) over the overtime asks | `overtime.manage` |
| Output against plan | `useReportSummary` (RAG Weekly plan/actual, the Reports page's figure) | `rag.view` |
| Lines stopped | `useStoppedLinesCount` | `wo.view` |

### Maintenance — `/dashboard/departments/maintenance`

| Section | Source | Gate |
|---|---|---|
| Now: not finished, not accepted, in progress, over 72h, lines stopped | Problem Analysis's active rows and status buckets; "over 72h" is the orders list's Stale rule | `wo.view` |
| Preventive due/overdue | `usePmSchedules` + `pmStatus` | `pm.view` |
| Period: raised, corrective/preventive, repair hours, downtime, MTTR | `computeKpis`, `useMaintenanceKpis` | `wo.view` |
| Finished today / this week / in period | count by `finished_at` (`useWoFinishedCount`) | `wo.view` |
| Problems by hours and by count, by line, by priority, by engineer | `groupByProblem`/`sortGroups`, `src/lib/maintenanceDashboard.ts` | `wo.view` |

Cards link to the orders list on what they counted. The list now reads `?status=` (including
`active` and `stale`), `?range=` and `?type=` (`src/lib/woListLink.ts`).

## Not calculable yet

These are gaps in the data, not hidden zeros.

- **Planned headcount per line.** Areas have no required headcount. The matrix is a list of
  people, not a requirement, and which matrix applies (standard or changeover) is chosen
  by a person and never inferred. "Planned" here means *due in by the rota*. Per-line
  shortages need a `required` figure per area and shift. The smallest fix is one integer
  column on `headcount_areas`.
- **Late arrivals.** `daily_allocations.arrived_late_at` exists but is barely filled. The
  dashboard does not count it until it is used.
- **Work-order due date / SLA.** There is none, so "overdue" means in progress for more than
  72 hours (Stale).
- **Preventive maintenance.** `pm_schedules` is empty in production. The panel says so
  instead of showing "nothing due".
- **Department-scoped supervisors.** Roles are global: there is no "supervisor of Line 3"
  assignment. A dashboard cannot narrow by department until that assignment exists.

## Planned departments

| Department | Existing screens | Dashboard would show | Blocked on |
|---|---|---|---|
| Quality | `/dashboard/quality`, quality actions | open actions by severity/label, awaiting validation, closed in period, by line | nothing: `quality_actions` supports it |
| Warehouse | `/dashboard/warehouse` (wait pattern, service requests), Stock | open service requests, wait time, low stock | the warehouse already has a role landing page; the question is whether to extend that page or build a separate one |
| HR / Workforce | People, Attendance, Leave, Finance Close | active staff by crew, missing logins/badges, pending leave, attendance exceptions | `employees` is readable only with `workforce.view` (admin). This stays an admin dashboard unless that changes |
| Finance | Finance Close, Overtime balances | overtime hours/balances in the pay period, close status | pay rates are column-revoked by design, so overtime **cost** cannot be shown, only hours |

To add a department, create a page under `/dashboard/departments/<key>`, add a
`dashboard.<key>` action (in `permissions.ts`, `permissions.test.ts` and the Dashboards group),
add the route, and put the nav row at the head of the department's sidebar group.
