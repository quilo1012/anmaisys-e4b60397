

# Phase 10: Executive Dashboard, Print A4 Optimization, Timeline Closed

## 1. Executive Dashboard (Director Mode)

New page `/dashboard/executive` — a high-level strategic view for decision-makers with only the most critical KPIs on a single clean screen.

**New file: `src/pages/dashboard/ExecutiveDashboard.tsx`**
- Large KPI cards in a 2x3 grid:
  - Total Open WOs | Avg Response Time | Avg MTTR | SLA Compliance % | Total Downtime Today | Machines at Risk (health < 40)
- Mini chart: WOs per day (last 7 days) bar chart
- Top 3 most impacted lines (by downtime)
- Top 3 most recurring problems
- Top 3 engineers (by score)
- Clean, no-clutter layout designed for projection/TV
- Fullscreen toggle button (same pattern as Control Center)
- Auto-refresh via existing realtime subscriptions

**Routing:** Add route `/dashboard/executive` in `App.tsx`, admin-only.
**Navigation:** Add "Executive" nav item in `DashboardLayout.tsx` with a `Briefcase` icon.

## 2. Print Optimization — Single A4 Page

The current print layout has too much spacing and content to fit on one A4 page. Changes to `WorkOrderDetail.tsx` and `index.css`:

**WorkOrderDetail.tsx — print-specific layout:**
- Reduce the print header to a compact single line (logo + WO number + date)
- Combine "Problem Description" and "Observations" into a single compact block for print
- Use a compact 2-column grid for personnel info (Requested By, Operator, Engineer, Signed By) instead of separate cards
- Reduce metrics (Response, Travel, Repair, Total) to a single-row inline layout
- Condense the Timeline to a horizontal single-line format for print (Created → Received → ... → Closed with times)
- Hide Photos and Chat sections in print
- Reduce signature block spacing
- Add `print:hidden` to Cost Breakdown, Photos, and Chat sections

**index.css — tighter print styles:**
- Reduce `@page` margin from 15mm to 8mm
- Add `font-size: 8pt` for print body
- Reduce card padding in print
- Remove card borders/shadows in print for density
- Force `page-break-inside: avoid` on key sections

## 3. Timeline — Show Closed Timestamp

**WorkOrderDetail.tsx line 216:** The "Closed" timeline item currently only shows for `closed` or `completed` status. Fix:
- Always show `closed_at` when it exists, regardless of status
- Show `completed_at` as "Completed" separately if it exists
- For `force_closed`, show `completed_at` with the Force Closed label (already done)

This ensures the timeline always displays when the WO was closed/completed.

---

## Files Modified

| File | Change |
|------|--------|
| `src/pages/dashboard/ExecutiveDashboard.tsx` | NEW — Executive/Director dashboard |
| `src/App.tsx` | Add `/dashboard/executive` route |
| `src/components/DashboardLayout.tsx` | Add "Executive" nav item |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Print-optimized compact layout, timeline closed fix |
| `src/index.css` | Tighter print CSS for A4 fit |

## Sequence
1. Executive Dashboard (new page + route + nav)
2. Print A4 optimization (CSS + layout)
3. Timeline closed timestamp fix

