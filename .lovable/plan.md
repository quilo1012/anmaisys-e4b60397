

# Targeted CMMS Updates — Plan

## 1. Machine Form: Plain Text Inputs for Type, Location, Line

**Current**: `Machine Type` and `Location` use `ComboboxInput` (autocomplete combobox). `Line` uses a fixed `Select` dropdown with hardcoded values ("Line 1", "Line 2", "Line 3").

**Change**: Replace all three with plain `<Input>` fields. No dropdowns, no forced selection. Users type freely.

**Files**:
- `src/pages/dashboard/MachinesPage.tsx` — Replace `ComboboxInput` for Machine Type and Location with `<Input>`. Replace `<Select>` for Line with `<Input>`.

## 2. Engineer WO Flow: Simplify to Accept+Start → Inline Checklist → Finish

**Current**: The flow already has "Accept + Start" but it opens a **separate checklist dialog** before executing. FINISH also opens a separate post-checklist dialog. Static fallback checklists exist when no dynamic ones are defined.

**Changes**:
- **Remove static fallback checklists** (`STATIC_PRE_CHECKLIST`, `STATIC_POST_CHECKLIST`) — if a problem has no checklist items, no checklist is shown
- **Remove the pre-service checklist dialog gate** on Accept+Start — clicking "Accept + Start" opens PIN, validates, then immediately sets WO to `IN_PROGRESS`. No separate dialog step.
- **Render checklist inline** inside the WO card (both mobile and desktop) when WO is `in_progress` — load dynamic items for the WO's problem, show checkboxes grouped by type, with visual alerts for incomplete required items
- **Block FINISH** button if any required checklist items are incomplete (disable button + show warning)
- **FINISH flow**: PIN → signature dialog → done (no separate post-checklist dialog)

**Files**:
- `src/pages/dashboard/EngineerDashboard.tsx` — Major refactor of checklist flow: remove dialog-based checklists, add inline checklist rendering in WO cards, simplify Accept+Start to PIN-only, block Finish on incomplete required items

## 3. Dynamic Checklist: Remove Static Defaults

**Current**: `useChecklistsByProblemName` fetches dynamic items; if none exist, code falls back to static arrays.

**Change**: Remove fallback. If no checklist items exist for a problem, show nothing. The existing admin UI in `ProblemsPage.tsx` already supports add/delete of checklist items per problem — no changes needed there.

**Files**:
- `src/pages/dashboard/EngineerDashboard.tsx` — Remove `STATIC_PRE_CHECKLIST` and `STATIC_POST_CHECKLIST` constants and all fallback logic

## 4. Audit: Already Implemented

The current system already logs `engineer_id`, `engineer_name`, `timestamp`, `work_order_id` via `work_order_logs` and `audit_logs`. No changes needed.

## 5. UX/Mobile: Preserved

The existing mobile card layout with h-14 buttons, camera inputs, and responsive design is preserved. The inline checklist will use the same large-touch styling.

---

## Files Modified

| File | Change |
|------|--------|
| `src/pages/dashboard/MachinesPage.tsx` | Replace ComboboxInput and Select for Type/Location/Line with plain `<Input>` |
| `src/pages/dashboard/EngineerDashboard.tsx` | Remove static checklists, remove checklist dialogs, add inline checklist in WO cards, simplify Accept+Start to PIN-only, block Finish on incomplete items |

