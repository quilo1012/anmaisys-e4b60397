-- Make the Production Planner save non-destructive to operator data.
--
-- The planner currently DELETEs all production_items for a session and
-- re-INSERTs them, which wipes operator-entered actual_qty and cascades away
-- production_blender_entries. Switching the planner to an upsert on
-- (session_id, sku_id) requires a unique index to conflict on.

-- Collapse any pre-existing duplicates on (session_id, sku_id), keeping the
-- richest row (highest actual, then newest). Defensive: normally none exist.
DELETE FROM public.production_items p
USING (
  SELECT id,
    row_number() OVER (
      PARTITION BY session_id, sku_id
      ORDER BY actual_qty DESC, updated_at DESC, created_at DESC
    ) AS rn
  FROM public.production_items
  WHERE sku_id IS NOT NULL
) d
WHERE p.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS production_items_session_sku_uidx
  ON public.production_items (session_id, sku_id)
  WHERE sku_id IS NOT NULL;
