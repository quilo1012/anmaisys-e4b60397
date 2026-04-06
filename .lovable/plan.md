

# Fix: Engineer Work Order Flow End-to-End

## Problems Identified

### 1. Photo upload indicators lost on refresh
`photosUploaded` is a `useState<Record<...>>` (line 172) that tracks which WOs have before/after photos uploaded. On page refresh, this state resets to `{}`, so buttons show "Before"/"After" even if photos were already uploaded. The app already has `useWOPhotos` hook but never uses it in the Engineer Dashboard.

### 2. `currentEngineer` is null after refresh
`currentEngineer` is local state (line 163), set only when a PIN dialog completes. After refresh, it's `null`. This means:
- Checklist toggles send `completedBy: null` (line 74-75)
- The InlineChecklist can't attribute who checked items
- For in-progress WOs, the engineer identity should be recoverable from the WO's `engineer_id` + `engineer_name`

### 3. Parts Used — RLS blocks admin/manager users
The `parts_used` INSERT policy requires `engineer_id = auth.uid() AND has_role(auth.uid(), 'engineer')`. Managers (admin role) who are explicitly allowed to perform all engineer actions cannot insert parts. The `engineer_id` FK also references `profiles(id)`, so it must be the logged-in user's ID, not the `engineers` table engineer — this is consistent with RLS but incompatible with the PIN-identity model for non-engineer logins.

### 4. Parts Used — `engineer_id` should allow admin role
The INSERT policy needs to also allow admins, matching the memory that "managers have all engineer permissions."

## Changes

### `src/pages/dashboard/EngineerDashboard.tsx`

**A. Replace photo state with DB-backed status**
- For each in-progress WO, fetch photos via `useWOPhotos` to determine if before/after photos exist
- Create a small wrapper component `PhotoStatusButton` that calls `useWOPhotos(woId)` and checks if a photo of the given type exists
- Remove the `photosUploaded` local state and `setPhotosUploaded` calls from `handlePhotoUpload`
- After upload, invalidate the `wo_photos` query (already done by the hook)

**B. Restore `currentEngineer` from WO data on mount**
- When the dashboard loads and finds an `in_progress` WO with `engineer_id` and `engineer_name`, auto-set `currentEngineer` from that data so checklist interactions have a valid identity
- Store `currentEngineer` in `sessionStorage` as well, so it survives refresh within the same session
- On mount, try to restore from sessionStorage first; if not available, derive from the first in-progress WO's engineer fields

**C. Invalidate `wo_photos` on upload success**
- Already handled by `useUploadWOPhoto` — no change needed

### `src/hooks/useStock.ts` — No change needed in code
The `engineer_id` is set to `user!.id` which is correct for RLS (`engineer_id = auth.uid()`).

### Database migration — Fix parts_used INSERT RLS
- Update the INSERT policy to also allow admin role:
```sql
DROP POLICY "Engineers can insert parts used" ON public.parts_used;
CREATE POLICY "Engineers and admins can insert parts used"
  ON public.parts_used FOR INSERT
  WITH CHECK (
    engineer_id = auth.uid() AND (
      has_role(auth.uid(), 'engineer') OR has_role(auth.uid(), 'admin')
    )
  );
```

## Files modified

| File | Change |
|------|--------|
| `src/pages/dashboard/EngineerDashboard.tsx` | Replace local photo state with DB query; restore currentEngineer from sessionStorage / WO data |
| Database migration | Update parts_used INSERT RLS to include admin role |

## What this preserves
- PIN-based identity for Accept+Start and Finish actions (unchanged)
- All screen UI and layout (unchanged)
- Checklist behavior and blocking logic (unchanged)
- Print/PDF output (unchanged)

