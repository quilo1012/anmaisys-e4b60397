

# CMMS Engineer Flow Optimization

## Summary
Three major changes: (1) merge ACCEPT+ARRIVED+START into a single "Accept + Start" action, (2) create dynamic checklists per problem, (3) Machine Type already uses ComboboxInput (no change needed there).

## What Already Exists
- Machine Type field already uses `ComboboxInput` with free-text + autocomplete — **no change needed**
- PIN verification for all engineer actions
- Pre/post-service static checklists
- Mobile-first engineer cards with h-14 buttons
- Full audit trail via `work_order_logs` and `audit_logs`

## Changes

### 1. Merge ACCEPT + START into Single Action
**Goal**: Reduce 3 PIN prompts (ACCEPT→ARRIVED→START) to 1.

**EngineerDashboard.tsx changes**:
- Replace the three separate buttons (ACCEPT, ARRIVED, START) for `open` WOs with a single **"Accept + Start"** button
- On click: require PIN → show pre-service checklist → on complete, call a new combined mutation that sets status directly to `in_progress` with `received_at`, `arrived_at`, `started_at` all set to now()
- For WOs already in `received` or `arrived` status (edge case), show a single **"Start"** button that also does PIN → sets to `in_progress`
- Keep FINISH flow unchanged (PIN → post-checklist → signature)

**useWorkOrders.ts changes**:
- Add `useAcceptAndStartWorkOrder()` mutation that updates the WO to `in_progress` in one step, setting `engineer_id`, `engineer_name`, `received_at`, `arrived_at`, `started_at`
- Logs 3 entries to `work_order_logs`: "received", "arrived", "started"

### 2. Dynamic Checklists per Problem
**Database migration**:
- New table `checklists`: `id`, `problem_description_id` (FK → problem_descriptions), `type` (text: Health/Safety/Machine), `description` (text), `is_required` (boolean, default true), `created_at`
- New table `checklist_responses`: `id`, `work_order_id`, `checklist_id`, `completed` (boolean), `completed_by` (uuid, references engineers), `completed_at` (timestamptz)
- RLS: authenticated can SELECT checklists; admins can ALL. Authenticated can SELECT/INSERT/UPDATE checklist_responses.

**New hook** `src/hooks/useChecklists.ts`:
- `useChecklistsByProblem(problemName)` — fetch checklist items matching the WO's problem description
- `useChecklistResponses(woId)` — fetch responses for a WO
- `useSaveChecklistResponse()` — upsert a response
- CRUD hooks for admin management

**EngineerDashboard.tsx changes**:
- Replace static `PRE_SERVICE_CHECKLIST` / `POST_SERVICE_CHECKLIST` with dynamic items loaded from DB based on the WO's `description` (problem name)
- If no custom checklist exists for a problem, fall back to the existing static items
- Group items by `type` (Health, Safety, Machine) with visual headers
- Required items block FINISH
- Inline checklist within the WO card for mobile

**ProblemsPage.tsx changes**:
- Add a "Checklists" section when editing a problem
- Allow admins to add/remove checklist items with type and required flag

### 3. UX Improvements
- Mobile: "Accept + Start" button uses full width, green accent, bold text
- Desktop table: single "Accept + Start" button replaces three separate buttons
- Show checklist completion progress badge on WO cards (e.g., "3/5 ✓")

## Files Modified

| File | Change |
|------|--------|
| DB Migration | Create `checklists` and `checklist_responses` tables with RLS |
| `src/hooks/useChecklists.ts` | NEW — hooks for dynamic checklists |
| `src/hooks/useWorkOrders.ts` | Add `useAcceptAndStartWorkOrder()` combined mutation |
| `src/pages/dashboard/EngineerDashboard.tsx` | Merge buttons, dynamic checklists, UX improvements |
| `src/pages/dashboard/ProblemsPage.tsx` | Add checklist management UI for admins |

## Sequence
1. Database migration (checklists + checklist_responses tables)
2. useChecklists hook
3. useAcceptAndStartWorkOrder mutation
4. EngineerDashboard UI update (merged flow + dynamic checklists)
5. ProblemsPage admin checklist management

