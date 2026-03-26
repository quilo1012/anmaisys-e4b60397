

# Phase 3: Enterprise CMMS Features

This plan adds the 5 genuinely new features that don't exist yet. Everything else in the prompt (WO pipeline, alerts, checklist, photos, signature, SLA, stock, sidebar, print, CSV, filters, LINE column) is already implemented and working.

---

## 1. Engineer Ranking with Live Scoring

**Database migration:**
- Create `engineer_scores` table: `id`, `engineer_id` (uuid), `score` (integer, default 0), `updated_at`
- Create a database function `update_engineer_score()` triggered on `work_orders` UPDATE that:
  - `+10` when status changes to `received` within 5 min of creation
  - `+20` when status changes to `finished` within SLA target time
  - `-15` when response time exceeds SLA target
  - `-30` when total repair time exceeds 2 hours
- RLS: engineers see own score, admins see all

**Analytics page** (`AnalyticsPage.tsx`):
- Add "Engineer Ranking" card with a sorted list showing: position, name, score, trend indicator
- Replace the existing engineer performance cards with a combined ranking + metrics view

**Control Center** (`ControlCenterPage.tsx`):
- Add a "Top 5 Engineers" sidebar/panel showing rank, name, score

---

## 2. Failure Heatmap

**Analytics page** (`AnalyticsPage.tsx`):
- New chart section: "Failure Heatmap"
- Grid layout: rows = Lines, columns = Machines
- Each cell colored by WO count for that machine: green (0-2), yellow (3-5), red (6+)
- Built with a simple HTML grid + Tailwind background colors (no external heatmap library needed)
- Data computed from existing `allWOs` already fetched

---

## 3. Internal WO Chat

**Database migration:**
- Create `wo_messages` table: `id` (uuid), `work_order_id` (uuid), `user_id` (uuid), `user_name` (text), `message` (text), `image_url` (text nullable), `created_at`
- RLS: authenticated users can insert (own user_id), select where they have access to the WO (operator owns it, engineer assigned, or admin)
- Enable realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE public.wo_messages;`

**WorkOrderDetail page** (`WorkOrderDetail.tsx`):
- Add a chat panel at the bottom of the WO detail
- Messages displayed chronologically with sender name, timestamp
- Input field for text + optional image upload (reuse `wo-photos` bucket)
- Realtime subscription for new messages
- New hook: `src/hooks/useWOMessages.ts`

---

## 4. Enhanced Control Center

**Control Center** (`ControlCenterPage.tsx`):
- Add per-line downtime counter: sum of active WO durations (time since `created_at` for open/in_progress WOs) displayed per line section
- Add Top 5 Engineer ranking panel (from `engineer_scores` table or computed from WO data)
- Add "Fullscreen" toggle button that uses the Fullscreen API (`document.documentElement.requestFullscreen()`) to hide browser chrome — ideal for TV display
- Open WOs with status "open" should have `animate-pulse` on their machine card (already implemented)

---

## 5. Professional PDF Report

**Implementation:** Edge function `generate-report` that uses Deno's built-in capabilities
- Actually, since we can't run Python in edge functions, we'll build a client-side PDF generation using the existing `jspdf` approach or a simple print-to-PDF workflow
- Add a "Download PDF Report" button to the Work Orders page
- The PDF includes:
  - Company logo header + report period
  - WO summary table (LINE, MACHINE, PROBLEM, STATUS, timestamps)
  - Performance KPIs: total WOs, avg response, avg MTTR, downtime
  - Engineer ranking table
  - Footer with generation timestamp
- Use `jspdf` + `jspdf-autotable` libraries for clean table rendering

---

## Files Summary

| File | Action |
|------|--------|
| Migration SQL | `engineer_scores` table + trigger, `wo_messages` table + realtime |
| `src/pages/dashboard/AnalyticsPage.tsx` | Add ranking section + failure heatmap |
| `src/pages/dashboard/ControlCenterPage.tsx` | Add downtime counters, top 5 ranking, fullscreen toggle |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Add chat panel |
| `src/hooks/useWOMessages.ts` | NEW — CRUD + realtime for WO chat |
| `src/pages/dashboard/WorkOrdersPage.tsx` | Add PDF download button |
| `src/lib/generatePdfReport.ts` | NEW — client-side PDF generation |
| `package.json` | Add `jspdf` + `jspdf-autotable` |

## Implementation Sequence
1. Database migration (engineer_scores + wo_messages tables)
2. Engineer ranking in Analytics
3. Failure heatmap in Analytics
4. Enhanced Control Center (counters + ranking + fullscreen)
5. WO chat system
6. PDF report generation

