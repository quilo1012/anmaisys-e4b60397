-- Prova das regras de pontuação (20260823090000 + 20260824090000).
-- Correr no SQL editor do projecto PMSYSTEM (ybtrzqzliepknpzqdajx).
--
-- Só SELECTs. Correr ANTES e DEPOIS.
--
-- PRÉ-REQUISITO: 20260822090000 e 20260822093000 já aplicadas. Se não estiverem,
-- parar aqui — ver VERIFY-frozen-points.sql. A ordem não é preferência: a
-- 20260823090000 faz CREATE OR REPLACE de action_points_at, que a 20260822090000
-- também cria. Aplicadas ao contrário, a versão da 22 aterra por último e a regra do
-- MAX desaparece sem erro nenhum.

-- ── BLOCO 1: a ordem foi respeitada? ─────────────────────────────────────
-- A pergunta que nenhuma das outras responde. GREATEST = a regra nova está viva.
-- Se der false depois de aplicares tudo, foi aplicado fora de ordem: reaplicar
-- SÓ a 20260823090000 corrige.
SELECT position('GREATEST(_charge' IN pg_get_functiondef(p.oid)) > 0 AS regra_max_viva,
       position('IF _charge > 0 THEN RETURN _charge' IN pg_get_functiondef(p.oid)) > 0
         AS regra_antiga_ainda_la
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'action_points_at';


-- ── BLOCO 2: o tecto das etiquetas ───────────────────────────────────────
-- ESPERADO: 0 linhas, antes E depois. A migração não semeia CAP_LabelPoints de
-- propósito — ausente significa sem tecto, e é assim que deve aterrar. Uma linha
-- aqui significa que alguém já decidiu um tecto; nesse caso, confirmar que é o
-- valor que essa pessoa queria.
SELECT name, value, valid_from, valid_to, note
  FROM public.leader_scorecard_threshold
 WHERE name = 'CAP_LabelPoints'
 ORDER BY valid_from;


-- ── BLOCO 3: os gates ────────────────────────────────────────────────────
-- ANTES: erro 42703, a coluna não existe. DEPOIS: exactamente 4 linhas true.
SELECT value, kind, points, is_gate
  FROM public.quality_options
 WHERE kind = 'label' AND is_gate = true
 ORDER BY value;

-- A lista completa, para confrontares com o que esperas. Se "Fail CCP" aparecer
-- aqui com is_gate = false, a grafia na migração não bateu — mas nesse caso ela
-- teria levantado excepção e não teria aplicado. Isto é a confirmação visual.
SELECT value, points, is_gate
  FROM public.quality_options
 WHERE kind = 'label'
 ORDER BY is_gate DESC, value;


-- ── BLOCO 4: quantos líderes passam a ser limitados ──────────────────────
-- O número que ninguém pediu e que vais querer ver antes de alguém abrir o ecrã.
-- Quantas acções, por líder e por mês, carregam uma etiqueta de gate. Cada linha
-- aqui é um período que passa a fechar em <= 49.
--
-- Não é uma previsão do score — é a contagem dos períodos afectados. Um líder
-- com uma linha aqui vai perguntar porquê, e é melhor a pergunta chegar depois de
-- alguém já ter olhado para esta tabela.
SELECT date_trunc('month', a.recorded_at)::date AS mes,
       a.leader_name,
       count(*)                                  AS accoes_com_gate,
       string_agg(DISTINCT o.value, ', ')        AS etiquetas
  FROM public.quality_actions a
  JOIN public.quality_options o
    ON o.kind = 'label' AND o.is_gate = true AND o.value = ANY(a.labels)
 WHERE a.validation_status IS DISTINCT FROM 'rejected'
 GROUP BY 1, 2
 ORDER BY 1 DESC, 2;


-- ── BLOCO 5: o tamanho da decisão que fica em aberto ─────────────────────
-- Quantas acções o congelamento guarda com um valor que a regra ANTIGA calculou
-- e que a regra nova teria calculado mais alto. São as que a regra "a etiqueta
-- substitui" rebaixou em silêncio.
--
-- Não se corrigem sozinhas, de propósito: estão congeladas, e re-pontuá-las é um
-- acto explícito que move números já publicados. Isto diz-te o tamanho dessa
-- decisão antes de a tomares.
SELECT count(*) AS accoes_que_a_regra_antiga_rebaixou
  FROM public.quality_actions a
  JOIN public.scoring_version_severity sv
    ON sv.version_id = a.scoring_version_id AND sv.severity = a.severity
 WHERE a.points_at_creation IS NOT NULL
   AND a.points_at_creation < sv.points;

-- As mesmas, nomeadas, para olhar. Limitado a 50 — se forem mais, o número acima
-- é o que interessa.
SELECT a.action_no, a.recorded_at::date, a.leader_name, a.severity,
       a.points_at_creation AS congelado, sv.points AS o_grau_valia
  FROM public.quality_actions a
  JOIN public.scoring_version_severity sv
    ON sv.version_id = a.scoring_version_id AND sv.severity = a.severity
 WHERE a.points_at_creation IS NOT NULL
   AND a.points_at_creation < sv.points
 ORDER BY a.recorded_at DESC
 LIMIT 50;


-- ── BLOCO 6: a linha semanal aprendeu? (20260825090000) ──────────────────
-- ESPERADO depois: true. Antes: false.
SELECT position('g.gated' IN pg_get_viewdef('public.v_leader_weekly_scorecard'::regclass)) > 0
         AS view_conhece_o_gate;

-- Quantas semanas passam a Red por causa de uma accao, e quais NAO estavam Red
-- ja por outro motivo. A segunda coluna e a que interessa: sao as que mudam de
-- cor no ecra, e cada uma e um lider que vai perguntar porque.
--
-- NOTA sobre linhas: o gate e ao nivel LIDER x SEMANA, nao por linha. Um CCP
-- reprovado na Linha 3 poe Red tambem na linha do mesmo lider na Linha 5 nessa
-- semana. E deliberado — a especificacao diz "aquele periodo e aquele lider" — e
-- por isso o rag_driver nomeia o evento primeiro. Se esta contagem parecer alta,
-- e provavelmente isto, e vale a pena olhar antes de alguem abrir o ecra.
SELECT w.week_ending, w.leader_name, w.line_name, w.overall_rag, w.rag_driver
  FROM public.v_leader_weekly_scorecard w
 WHERE w.rag_driver LIKE 'Seguranca alimentar:%'
 ORDER BY w.week_ending DESC, w.leader_name
 LIMIT 100;
