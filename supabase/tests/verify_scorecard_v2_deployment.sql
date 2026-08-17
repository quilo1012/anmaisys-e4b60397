-- Verifica se as NOVE migrações do scorecard v2 (14/08 → 20/08) chegaram à base.
--
-- Eram sete. Cobria até ao bloco 05 e uma coluna do 06, e dava "PRESENTE em tudo" com o
-- 05b, o resto do 06, o 07 e o 08 por aplicar — o que é pior do que não verificar, porque
-- a linha toda verde é lida como prova. Os blocos verificados são agora os nove de
-- docs/apply/, incluindo o 05b, que nem no pending-migrations-apply.sql estava.
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
    -- A coluna existir na TABELA não prova que o ecrã a consegue ler de volta: se a
    -- view não a expuser, o rascunho carrega-a nula e cada gravação apaga o carimbo
    -- derivado/manual. Foi exactamente esse o defeito, e o verificador dava tudo
    -- PRESENTE enquanto ele acontecia. Por isso a view é verificada à parte.
    ('v_leader_weekly_scorecard.volume_source','coluna',EXISTS (SELECT 1 FROM information_schema.columns
                                                              WHERE table_schema='public' AND table_name='v_leader_weekly_scorecard'
                                                                AND column_name='volume_source'),                           '0818'),
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
    -- 20260817120000_safety_has_its_own_labels.sql — o bloco 05b.
    -- Escapou ao pending-migrations-apply.sql tal como a 0817 09:30, e este verificador
    -- também não a via: dava PRESENTE em tudo enquanto gravar um rótulo de segurança
    -- rebentava com quality_options_kind_check. Não basta a coluna existir — o que a
    -- app precisa é que o kind 'safety_label' seja ACEITE, por isso é o constraint que
    -- se verifica, não uma coluna.
    ('quality_options: kind safety_label', 'constraint', EXISTS (SELECT 1 FROM pg_constraint
                                                              WHERE conname='quality_options_kind_check'
                                                                AND conrelid='public.quality_options'::regclass
                                                                AND pg_get_constraintdef(oid) LIKE '%safety_label%'),      '0817 12:00 — o bloco 05b'),
    -- 20260818090000_a_gate_is_a_ceiling_not_a_weight.sql — o bloco 06.
    -- O score 0-100 de duas camadas. A view já era verificada acima pela sua coluna
    -- volume_source; o que faltava era a função que decide a nota e o tipo que ela
    -- devolve — sem eles a view existe e o score não.
    ('scorecard_score_evaluate',           'função',  to_regproc('public.scorecard_score_evaluate') IS NOT NULL,            '0818 — o bloco 06'),
    ('scorecard_score_eval',               'tipo',    EXISTS (SELECT 1 FROM pg_type WHERE typname='scorecard_score_eval'
                                                                AND typnamespace='public'::regnamespace),  '0818 — o bloco 06'),
    ('trg_scorecard_version_weights',      'trigger', EXISTS (SELECT 1 FROM pg_trigger
                                                              WHERE tgname='trg_scorecard_version_weights'
                                                                AND tgrelid='public.leader_score_weights'::regclass
                                                                AND NOT tgisinternal),                                      '0818 — o bloco 06'),
    -- 20260819090000_the_score_crosses_the_board_rpc.sql — o bloco 07.
    -- scorecard_week_board já é verificada acima, mas a versão do 0816 também responde
    -- a esse teste: a função existir não prova que o score atravessa o quadro. São as
    -- quatro colunas novas que distinguem a do 07 da do 03.
    ('scorecard_week_board: score_final',  'coluna',  EXISTS (SELECT 1 FROM information_schema.routines r
                                                              JOIN information_schema.parameters pa
                                                                ON pa.specific_schema=r.specific_schema
                                                               AND pa.specific_name=r.specific_name
                                                              WHERE r.routine_schema='public'
                                                                AND r.routine_name='scorecard_week_board'
                                                                AND pa.parameter_name='score_final'
                                                                AND pa.parameter_mode='OUT'),            '0819 — o bloco 07'),
    ('scorecard_week_board: cap_reason',   'coluna',  EXISTS (SELECT 1 FROM information_schema.routines r
                                                              JOIN information_schema.parameters pa
                                                                ON pa.specific_schema=r.specific_schema
                                                               AND pa.specific_name=r.specific_name
                                                              WHERE r.routine_schema='public'
                                                                AND r.routine_name='scorecard_week_board'
                                                                AND pa.parameter_name='cap_reason'
                                                                AND pa.parameter_mode='OUT'),            '0819 — o bloco 07'),
    -- 20260820090000_filling_a_week_is_not_approving_it.sql — o bloco 08.
    ('scorecard_require_capa_before_approval','função',to_regproc('public.scorecard_require_capa_before_approval') IS NOT NULL,'0820 — o bloco 08'),
    ('trg_scorecard_require_capa',         'trigger', EXISTS (SELECT 1 FROM pg_trigger
                                                              WHERE tgname='trg_scorecard_require_capa'
                                                                AND tgrelid='public.leader_weekly_scorecard'::regclass
                                                                AND NOT tgisinternal),                                      '0820 — o bloco 08'),
    ('RLS: Management fills weekly scorecard','policy',EXISTS (SELECT 1 FROM pg_policies
                                                              WHERE schemaname='public'
                                                                AND tablename='leader_weekly_scorecard'
                                                                AND policyname='Management fills weekly scorecard'),        '0820 — o bloco 08'),
    -- Controlos: têm de dar PRESENTE. Se derem AUSENTE, o problema não é o scorecard.
    ('leader_score_weights',               'tabela',  to_regclass('public.leader_score_weights') IS NOT NULL,               'CONTROLO — 30/07, deve existir'),
    ('leader_self_scorecard',              'função',  to_regproc('public.leader_self_scorecard') IS NOT NULL,               'CONTROLO — 11/08, deve existir'),
    ('downtime_corrections',               'tabela',  to_regclass('public.downtime_corrections') IS NOT NULL,               'CONTROLO — 13/08, deve existir')
) AS t(obj, kind, present, origem);

-- A fronteira medida a partir do PostgREST em 16/08/2026: tudo até 13/08 está na base,
-- nada a partir de 14/08 está. Os três CONTROLOS acima são o que fixa essa fronteira —
-- se algum deles disser AUSENTE, esta leitura está errada e o diagnóstico recomeça.
