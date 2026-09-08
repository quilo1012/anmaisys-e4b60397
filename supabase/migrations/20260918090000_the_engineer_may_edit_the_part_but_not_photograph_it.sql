-- The engineer may edit the part, but not photograph it.
--
-- `part-photos` was written on 26/08 with the stated intent of mirroring
-- `public.products` exactly: "view = anyone who can read products, upload/replace =
-- anyone who can write products". It mirrored the role list products had THAT DAY,
-- by hand. Products has since moved to the Permissions matrix — `has_action(uid,
-- 'stock.view' | 'stock.manage', <baseline>)` — and the bucket did not follow, so the
-- two answers drifted apart in both directions:
--
--   role                     products write   part-photos upload
--   engineer                 yes (override)   NO
--   supervisor               no  (override)   yes
--
-- Measured on this database on 08/09/2026 at 14:05 UTC, for
-- maintenance@appliednutrition.uk (role `engineer`, the account that reported it), as
-- `authenticated` carrying its own JWT, inside a transaction that was rolled back:
--
--   products visible ............. 170
--   has_action('stock.manage') ... true      -- the Edit dialog saves
--   INSERT storage.objects ....... REFUSED   -- the photo does not
--
-- Which is the screen the person saw: a part they had just edited, and "Upload failed
-- — new row violates row-level security policy" on its photograph.
--
-- `20260908142852` (committed 14:28 UTC the same day, while this was being measured)
-- answers the same report by adding `engineer`, `co_engineer` and `warehouse` to the
-- hand-written list. That closes the one door that was knocked on and leaves the
-- mechanism intact — it is now the THIRD copy of "who may touch Stock", and it grants
-- upload to `warehouse` and `co_engineer`, whom the matrix denies `stock.manage`. It
-- had not reached the database as of 15:02 UTC; the policies in force were still the
-- 26/08 five-role version. This migration supersedes it: a later stamp, so a replay in
-- filename order ends here.
--
-- So the three policies stop carrying a copy of the list and ask the matrix the same
-- question products asks, with the same baselines, verbatim from `products select by
-- matrix` and `products insert/update by matrix`. The extra `production_office_admin`
-- branch is not generosity: `office_admin all` on products is an unconditional FOR ALL
-- policy that ignores the matrix, so the bucket has to carry it too or the mirror is
-- broken on the other side.
--
-- `part_photos_delete` is left exactly as it is — admin or production_office_admin
-- already mirrors "Admins can delete products" plus `office_admin all`.
--
-- Applied to the database by hand on 08/09/2026 at 14:07 UTC and verified role by role
-- with a real INSERT, rolled back: engineer true (was false), admin true, operator
-- false, quality_supervisor false.

DROP POLICY IF EXISTS "part_photos_read" ON storage.objects;
CREATE POLICY "part_photos_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'part-photos' AND (
    public.has_action(
      auth.uid(),
      'stock.view',
      ARRAY['admin','manager','supervisor','maintenance_manager','planner','engineer','co_engineer','warehouse','production_office_admin']::app_role[]
    )
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);

DROP POLICY IF EXISTS "part_photos_insert" ON storage.objects;
CREATE POLICY "part_photos_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_action(
      auth.uid(),
      'stock.manage',
      ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]
    )
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);

DROP POLICY IF EXISTS "part_photos_update" ON storage.objects;
CREATE POLICY "part_photos_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'part-photos' AND (
    public.has_action(
      auth.uid(),
      'stock.manage',
      ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]
    )
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_action(
      auth.uid(),
      'stock.manage',
      ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]
    )
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);
