

# Phase 8: Predictive Intelligence, Health Score, and V7 Features

Everything from sections 1-6 of your prompt (WO pipeline, checklists, alerts, mobile, chat, print, audit, stock, analytics, control center, financial dashboard, rankings) is **already built and working**. This plan covers the genuinely new V7 features.

---

## What's Already Done (No Changes Needed)

- WO pipeline: OPEN → RECEIVED → ARRIVED → IN_PROGRESS → FINISHED → CLOSED
- Pre/post-service checklists (blocks FINISH if incomplete)
- Industrial siren sound + realtime alerts for engineers/managers
- Mobile responsive engineer cards with large action buttons
- Control Center with TV Mode (fullscreen, compact grid)
- Analytics: heatmap, ranking, KPIs, downtime charts
- Financial Dashboard with cost tracking and stock valuation
- Chat system per WO, photo upload, digital signature
- Print CSS (sidebar hidden), PDF reports with financial summary
- Audit logs with clear button, configurable admin PIN
- CSV export, user management, problem descriptions

---

## New Features to Implement

### 1. Machine Health Score (0–100)

**Database:** Add `health_score` integer column to `machines` table (default 100). Create a database function `recalculate_health_scores()` that runs on WO status change:
- Starts at 100
- -5 per WO in last 30 days
- -10 per WO where repair_time > 120 min
- -15 for recurrent problems (≥3 same problem in 30 days)
- Floor at 0

**UI:** Display as a colored badge on Control Center machine cards and Machine History page. Green ≥70, Yellow ≥40, Red <40.

### 2. Recurrence Detection & Predictive Alerts

**Client-side hook** `usePredictiveAlerts`: scans WO history for patterns:
- Same machine + same problem ≥ 3 times in 30 days → generates a "predictive alert"
- Returns list of `{ machine, problem, count, lastOccurrence, suggestedAction }`

**UI:** Purple alert banner at top of Engineer Dashboard and Control Center. Purple dot on machine map (new status: 🟣 predictive). No new DB tables needed — purely computed from existing WO data.

### 3. Risk Level per Problem

**Database:** The `problem_descriptions.severity` column already exists (was hidden from UI in Phase 4). Repurpose it as `risk_level` or add a new column. Values: LOW, MEDIUM, HIGH, CRITICAL.

**UI:** Add risk level selector to ProblemsPage management form. Show risk badges on WO cards. For HIGH/CRITICAL: display warning icon and block message on Engineer Dashboard.

### 4. WO Numbering: WO-YYYY-000XXX

Replace the current `AN-0001` format with `WO-2026-000001`. Uses existing `wo_number` field + `created_at` year. Pure display change — helper function `formatWONumber(wo_number, created_at)`.

### 5. Engineer Workload Balancing

When a new WO alert fires, show a "Suggested Engineer" badge indicating which online engineer has the fewest active WOs. Computed client-side from `useOnlineEngineers` + active WO counts. No DB changes.

### 6. Focus Mode for Engineers

Toggle button on Engineer Dashboard. When active, hides all WOs except the next actionable one (oldest open or in-progress). Shows only the single WO card with the next required action highlighted. Simple state toggle — no DB changes.

---

## Technical Details

| File | Change |
|------|--------|
| Migration SQL | Add `health_score` to `machines`, trigger to recalculate on WO changes |
| `src/hooks/usePredictiveAlerts.ts` | NEW — recurrence detection from WO history |
| `src/hooks/useMachines.ts` | Include health_score in query |
| `src/pages/dashboard/ControlCenterPage.tsx` | Purple status, health score badges, predictive banner |
| `src/pages/dashboard/EngineerDashboard.tsx` | Predictive alerts banner, Focus Mode toggle, workload suggestion |
| `src/pages/dashboard/MachineHistoryPage.tsx` | Health Score display |
| `src/pages/dashboard/AnalyticsPage.tsx` | Recurrent problems section |
| `src/pages/dashboard/ProblemsPage.tsx` | Risk level field |
| `src/lib/woFormat.ts` | NEW — `formatWONumber()` helper |
| All WO display files | Use new WO number format |

## Implementation Sequence

1. Database migration (health_score column + trigger)
2. WO numbering format change
3. Risk level on problems
4. Health Score display on Control Center + Machine History
5. Recurrence detection hook + predictive alerts
6. Focus Mode + workload balancing
7. Testing across mobile and desktop

