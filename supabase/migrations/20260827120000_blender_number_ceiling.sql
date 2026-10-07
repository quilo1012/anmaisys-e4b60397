-- The blend number is a running count, and 99 was a wall it reaches on its own.
--
-- `blender_number` is not the machine. It is the blend's number within its batch,
-- and it climbs for as long as the batch runs: CRE250 on batch A26213 went 30 → 35
-- across two days, and batch B26188 reached 69 in five. A batch running a fortnight
-- walks through 99 with nobody mistyping anything, and the operator on shift that
-- night would have met
--   new row for relation "production_blender_entries" violates check constraint
--   "production_blender_entries_blender_number_check"
-- for doing the job correctly. That message was already filed twice as an API_ERROR
-- against Line 4 on 26/08, from a batch code landing in the blender box.
--
-- 999 is three digits of headroom against a smallint that holds 32767, and it still
-- catches a five-digit batch code — the mistake that actually happens. The ceiling
-- is mirrored in src/lib/blenderLabel.ts, which now refuses out-of-range figures on
-- the screen so this constraint stops being a user-facing error message.
ALTER TABLE public.production_blender_entries
  DROP CONSTRAINT IF EXISTS production_blender_entries_blender_number_check;

ALTER TABLE public.production_blender_entries
  ADD CONSTRAINT production_blender_entries_blender_number_check
  CHECK (blender_number >= 1 AND blender_number <= 999);
