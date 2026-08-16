-- Verifica se as sete migrações do scorecard v2 (14/08 → 19/08) chegaram à base.
--
-- Porque existe: nada no repositório aplica migrações. Não há passo de Supabase no
-- .github/workflows/ci.yml e não há `supabase db push`. Um ficheiro em
-- supabase/migrations é texto até alguém o correr. Este guião distingue "não existe"
-- de "cache de schema velha" — o PGRST205/PGRST202 do PostgREST não distingue.
--
-- Corre no SQL Editor. Só lê; não altera nada.

SELECT
  obj,
  kind,
  CASE WHEN present THEN 'PRESENTE' ELSE 'AUSENTE' END AS estado,
  origem
FROM (
  VALUES
    -- 20260814090000_the_week_is_red_when_the_check_is_missed.sql
    ('leader_scorecard_thresholds',        'tabela',  to_regclass('public.leader_scorecard_thresholds') IS NOT NULL,        '0814 (a 0815 larga-a de propósito)'),
    ('leader_weekly_scorecard',            'tabela',  to_regclass('public.leader_weekly_scorecard') IS NOT NULL,            '0814, reescrita pela 0815'),
    ('v_leader_weekly_scorecard',          'view',    to_regclass('public.v_leader_weekly_scorecard') IS NOT NULL,          '0814 → 0815 → 0818'),
    -- 20260815120000_a_label_can_carry_its_own_points.sql
    ('quality_options.points',             'coluna',  EXISTS (SELECT 1 FROM information_schema.columns
                                                              WHERE table_schema='public' AND table_name='quality_options'
                                                                AND column_name='points'),                                  '0815 12:00'),
    -- 20260815140000_health_and_safety_is_the_second_gate.sql
    ('leader_line_assignment',             'tabela',  to_regclass('public.leader_line_assignment') IS NOT NULL,             '0815 14:00'),
    ('leader_scorecard_threshold',         'tabela',  to_regclass('public.leader_scorecard_threshold') IS NOT NULL,         '0815 14:00 (singular)'),
    ('v_leader_weekly_scorecard_periods',  'view',    to_regclass('public.v_leader_weekly_scorecard_periods') IS NOT NULL,  '0815 14:00'),
    -- 20260816090000_the_screen_asks_the_database.sql
    ('scorecard_volume_source',            'enum',    EXISTS (SELECT 1 FROM pg_type WHERE typname='scorecard_volume_source'), '0816'),
    ('leader_weekly_scorecard.volume_source','coluna',EXISTS (SELECT 1 FROM information_schema.columns
                                                              WHERE table_schema='public' AND table_name='leader_weekly_scorecard'
                                                                AND column_name='volume_source'),                           '0816'),
    ('scorecard_derived_volume',           'função',  to_regproc('public.scorecard_derived_volume') IS NOT NULL,            '0816'),
    ('scorecard_week_board',               'função',  to_regproc('public.scorecard_week_board') IS NOT NULL,                '0816, substituída pela 0819'),
    -- 20260817090000_safety_shares_the_log_but_not_the_score.sql
    ('quality_actions.domain',             'coluna',  EXISTS (SELECT 1 FROM information_schema.columns
                                                              WHERE table_schema='public' AND table_name='quality_actions'
                                                                AND column_name='domain'),                                  '0817'),
    ('quality_actions.safety_kind',        'coluna',  EXISTS (SELECT 1 FROM information_schema.columns
                                                              WHERE table_schema='public' AND table_name='quality_actions'
                                                                AND column_name='safety_kind'),                             '0817'),
    -- 20260817093000_the_week_counts_its_own_safety.sql
    -- Escrita mais tarde do que as outras sete. NÃO está em docs/pending-migrations-apply.sql
    -- — quem colar esse ficheiro fica com as colunas domain/safety_kind e sem a função que
    -- as conta. Aplicar esta à parte, entre a de 0817 09:00 e a de 0818.
    ('scorecard_safety_counts',            'função',  to_regproc('public.scorecard_safety_counts') IS NOT NULL,             '0817 09:30 — fora do pending-migrations-apply.sql'),
    -- Controlos: têm de dar PRESENTE. Se derem AUSENTE, o problema não é o scorecard.
    ('leader_score_weights',               'tabela',  to_regclass('public.leader_score_weights') IS NOT NULL,               'CONTROLO — 30/07, deve existir'),
    ('leader_self_scorecard',              'função',  to_regproc('public.leader_self_scorecard') IS NOT NULL,               'CONTROLO — 11/08, deve existir'),
    ('downtime_corrections',               'tabela',  to_regclass('public.downtime_corrections') IS NOT NULL,               'CONTROLO — 13/08, deve existir')
) AS t(obj, kind, present, origem);

-- A fronteira medida a partir do PostgREST em 16/08/2026: tudo até 13/08 está na base,
-- nada a partir de 14/08 está. Os três CONTROLOS acima são o que fixa essa fronteira —
-- se algum deles disser AUSENTE, esta leitura está errada e o diagnóstico recomeça.
