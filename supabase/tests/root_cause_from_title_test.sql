-- O título nomeia outra área → o líder não é cobrado.
-- Corre numa transacção e desfaz tudo. Usa o rótulo "Label" (4 pontos).
BEGIN;

CREATE TEMP TABLE _rc_case (title text, want_area text, want_points int) ON COMMIT DROP;
INSERT INTO _rc_case VALUES
  ('TEST Wrong label (Office)',     'Office', 0),
  ('TEST Wrong label (L2)',         NULL,     4),
  ('TEST Wrong label (L2/Lab)',     'Lab',    0),
  ('TEST Wrong label version',      NULL,     4);  -- "label" não é "Lab"

CREATE TEMP TABLE _rc_got ON COMMIT DROP AS SELECT * FROM public.quality_actions WHERE false;

WITH ins AS (
  INSERT INTO public.quality_actions (title, labels, domain, line, leader_name, shift)
  SELECT c.title, ARRAY['Label'], 'quality', 'Line 2', 'TEST LEADER', 'DAY' FROM _rc_case c
  RETURNING *
)
INSERT INTO _rc_got SELECT * FROM ins;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.*, g.root_cause_area AS got_area, g.points_at_creation AS got_points
      FROM _rc_case c JOIN _rc_got g USING (title)
  LOOP
    IF r.got_area IS DISTINCT FROM r.want_area OR r.got_points IS DISTINCT FROM r.want_points THEN
      RAISE EXCEPTION 'FAIL %: area % (want %), points % (want %)',
        r.title, r.got_area, r.want_area, r.got_points, r.want_points;
    END IF;
  END LOOP;

  -- Limpar a causa devolve os pontos e não é re-derivada no save seguinte.
  UPDATE public.quality_actions SET root_cause_area = NULL WHERE title = 'TEST Wrong label (Office)' AND leader_name = 'TEST LEADER';
  UPDATE public.quality_actions SET severity = severity WHERE title = 'TEST Wrong label (Office)' AND leader_name = 'TEST LEADER';
  IF (SELECT points_at_creation FROM public.quality_actions WHERE title = 'TEST Wrong label (Office)' AND leader_name = 'TEST LEADER') <> 4 THEN
    RAISE EXCEPTION 'FAIL: clearing the root cause did not put the points back';
  END IF;
  RAISE NOTICE 'root_cause_from_title: all cases pass';
END $$;

ROLLBACK;
