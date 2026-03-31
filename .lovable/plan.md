

# CMMS Industrial Hardening — Gap Analysis & Implementation Plan

## What's Already Built (No Changes Needed)
- RBAC (admin/engineer/operator), RLS, route protection
- WO lifecycle: open → received → arrived → in_progress → finished → closed
- Pre/post-service checklists blocking FINISH
- Realtime alerts with industrial siren, stops on RECEIVED
- Mobile engineer UI (h-14 buttons, camera, signature)
- Control Center visual map with drag-and-drop
- Analytics with KPIs, MTTR, MTBF, ranking, downtime charts
- Audit logs with before/after, PIN-protected clear
- Machine tracking: type, location, code, health score, movement log
- Stock management with auto-deduction and zero-block
- Pause/Resume on WOs
- Print layout (A4, 20mm margins, audit-ready)
- Operator form already hardcodes priority="medium" (no field shown)
- WO table already shows LINE → MACHINE column order
- Demo mode (clear WOs with admin PIN)

## Actual Gaps to Implement

### 1. Dark Industrial Theme (Default)
Currently the app defaults to light theme. The user explicitly wants dark industrial as default.

**Changes:**
- `src/index.css`: Add `dark` class to `:root` or `<html>` element
- `index.html`: Add `class="dark"` to `<html>` tag
- Fine-tune dark theme accent color (keep #1978E5 primary, use amber accent for industrial feel)

### 2. Engineer PIN for Actions (ACCEPT/ARRIVED/START/FINISH)
Currently engineers perform actions without PIN verification. Each engineer needs a unique 4-6 digit PIN stored in their profile.

**Database:**
- Add `pin` column (text, nullable) to `profiles` table
- PIN stored as bcrypt hash via a new `verify_engineer_pin` edge function

**New Edge Function:** `supabase/functions/verify-engineer-pin/index.ts`
- Accepts `{ user_id, pin }`, verifies hash, returns `{ valid: boolean }`

**UI Changes:**
- Create `src/components/PinDialog.tsx` — reusable modal with OTP input (4-6 digits), calls verify edge function, resolves promise on success
- `EngineerDashboard.tsx`: Wrap ACCEPT, ARRIVED, START, FINISH handlers with PinDialog confirmation
- `ManageUsers.tsx`: Add PIN field when creating/editing engineers

### 3. Remove Failure Heatmap from Analytics
**Changes:**
- `AnalyticsPage.tsx`: Remove the entire "Failure Heatmap" card section (~lines 389-423) and related `heatmapData`/`getHeatColor` computation

### 4. Control Center — Table Mode
Add a toggle to switch between Visual Map and Table Mode showing realtime WO data.

**Changes in `ControlCenterPage.tsx`:**
- Add `viewMode` state ("visual" | "table")
- Add toggle button (List/Monitor icons)
- Table Mode renders a `<Table>` with columns: Line, Machine, Status, Problem, Engineer, Downtime, Created
- Uses same `workOrders` data already fetched

### 5. Operator Form — Add LINE Field
Operator currently selects Machine but not Line. Adding Line as a filter that narrows machine selection.

**Changes in `OperatorDashboard.tsx`:**
- Add `line` state
- Add Line dropdown (populated from `machines` distinct lines)
- Filter machine dropdown based on selected line
- Show Line column in "My Work Orders" table

### 6. WO Smart Suggestions
When creating a WO, show machine history (common problems, recent WOs).

**Changes in `OperatorDashboard.tsx`:**
- When machine is selected, query recent WOs for that machine
- Show small info card: "Common problems for this machine", "Last WO: X days ago"

---

## Files Modified

| File | Change |
|------|--------|
| **DB Migration** | Add `pin` (text, nullable) to `profiles` |
| `supabase/functions/verify-engineer-pin/index.ts` | NEW — verify engineer PIN hash |
| `src/components/PinDialog.tsx` | NEW — reusable PIN confirmation modal |
| `index.html` | Add `class="dark"` to `<html>` |
| `src/index.css` | Adjust dark theme colors for industrial aesthetic |
| `src/pages/dashboard/EngineerDashboard.tsx` | PIN verification on all status actions |
| `src/pages/dashboard/AnalyticsPage.tsx` | Remove Failure Heatmap section |
| `src/pages/dashboard/ControlCenterPage.tsx` | Add Table Mode toggle and table view |
| `src/pages/dashboard/OperatorDashboard.tsx` | Add LINE filter, smart machine suggestions |
| `src/pages/users/ManageUsers.tsx` | Add PIN field for engineer creation/editing |

## Sequence
1. Database migration (engineer PIN column)
2. Engineer PIN edge function + PinDialog component
3. Dark industrial theme
4. Engineer Dashboard PIN integration
5. Remove Failure Heatmap
6. Control Center Table Mode
7. Operator form enhancements (LINE + suggestions)

