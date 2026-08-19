-- Prova do congelamento da pontuação (20260822090000 + 20260822093000).
-- Correr no SQL editor do projecto PMSYSTEM (ybtrzqzliepknpzqdajx).
--
-- São todos SELECTs. Não escrevem nada, não abrem transacção, podem correr
-- as vezes que forem precisas.
--
-- Correr ANTES e DEPOIS. O "antes" não é formalidade: o Bloco 1 é o que distingue
-- "a migração ainda não correu" de "a migração correu e não fez nada", e essas duas
-- coisas parecem iguais em todos os outros blocos.

-- ── BLOCO 1: a migração correu? ──────────────────────────────────────────
-- ANTES esperado: 0 linhas.
-- DEPOIS esperado: 4 linhas — scoring_version, _severity, _label, _excluded_label.
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name LIKE 'scoring_version%'
 ORDER BY table_name;

-- ANTES esperado: 0 linhas. DEPOIS esperado: 3.
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'quality_actions'
   AND column_name IN ('points_at_creation', 'scoring_version_id', 'points_recalculated_at')
 ORDER BY column_name;


-- ── BLOCO 2: o backfill chegou a toda a gente? ───────────────────────────
-- ESTE É O BLOCO QUE DECIDE. Zero acções por congelar é o resultado bom;
-- qualquer número diferente de zero em `por_congelar` significa que o backfill
-- não terminou, e os relatórios ficariam a misturar réguas — que é exactamente
-- o defeito que isto vem corrigir.
--
-- `total` a zero NÃO é sucesso: é a base errada, ou uma tabela vazia. Uma ordem
-- de serviço que actualiza zero linhas está errada, não cumprida.
SELECT count(*)                                                   AS total,
       count(points_at_creation)                                  AS congeladas,
       count(*) - count(points_at_creation)                        AS por_congelar,
       count(scoring_version_id)                                  AS com_versao,
       count(points_recalculated_at)                              AS ja_recalculadas
  FROM public.quality_actions;


-- ── BLOCO 3: a v1 cobre todo o histórico? ────────────────────────────────
-- Uma acção anterior ao valid_from da v1 ficaria fora de toda a vigência e sem
-- versão nenhuma. valid_from tem de ser <= à acção mais antiga.
SELECT v.id, v.valid_from, v.valid_to, v.note,
       (SELECT min(recorded_at)::date FROM public.quality_actions) AS accao_mais_antiga,
       v.valid_from <= (SELECT min(recorded_at)::date FROM public.quality_actions)
         AS cobre_o_historico
  FROM public.scoring_version v
 ORDER BY v.valid_from;

-- Uma só versão vigente, sempre. Esperado: 1.
SELECT count(*) AS versoes_em_vigor
  FROM public.scoring_version WHERE valid_to IS NULL;


-- ── BLOCO 4: a régua congelada é a régua de hoje? ────────────────────────
-- No dia em que a migração corre têm de ser iguais — a v1 é um retrato do que
-- está em vigor. Uma diferença aqui significa que o snapshot leu outra coisa.
-- Esperado: 0 linhas.
SELECT s.severity, s.points AS ao_vivo, v.points AS congelado
  FROM public.quality_severity_points s
  FULL JOIN (SELECT sv.severity, sv.points FROM public.scoring_version_severity sv
              JOIN public.scoring_version x ON x.id = sv.version_id AND x.valid_to IS NULL) v
    ON v.severity = s.severity
 WHERE s.points IS DISTINCT FROM v.points;

-- Esperado: 0 linhas.
SELECT o.value AS label, o.points AS ao_vivo, l.points AS congelado
  FROM public.quality_options o
  FULL JOIN (SELECT sl.label, sl.points FROM public.scoring_version_label sl
              JOIN public.scoring_version x ON x.id = sl.version_id AND x.valid_to IS NULL) l
    ON l.label = lower(btrim(o.value))
 WHERE o.kind = 'label' AND o.points IS DISTINCT FROM l.points;


-- ── BLOCO 5: os números congelados fazem sentido? ────────────────────────
-- Nenhuma verificação automática substitui olhar para isto. Uma tabela cruzada
-- de severidade contra pontos congelados mostra num relance se alguma coisa
-- correu mal — um Critical congelado a 0, ou um Low a 40, salta à vista de uma
-- forma que nenhum COUNT consegue.
SELECT coalesce(severity, '(sem grau)') AS severidade,
       points_at_creation               AS pontos_congelados,
       count(*)                         AS quantas
  FROM public.quality_actions
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- Segurança é contada, nunca cobrada. Esperado: 0 linhas.
-- (Se a coluna `domain` não existir nesta base, esta consulta dá erro — e isso
--  também é informação: não há acções de segurança para verificar.)
SELECT id, action_no, severity, labels, points_at_creation
  FROM public.quality_actions
 WHERE domain = 'safety' AND coalesce(points_at_creation, 0) <> 0;

-- Uma acção rejeitada não custa nada. Esperado: 0 linhas.
SELECT id, action_no, severity, labels, points_at_creation
  FROM public.quality_actions
 WHERE validation_status = 'rejected' AND coalesce(points_at_creation, 0) <> 0;


-- ── BLOCO 6: os triggers ficaram instalados? ─────────────────────────────
-- Sem eles a migração congela o passado e depois deixa de congelar. Esperado:
-- trg_quality_action_freeze_points_ins e _upd.
SELECT tgname
  FROM pg_trigger
 WHERE tgrelid = 'public.quality_actions'::regclass AND NOT tgisinternal
   AND tgname LIKE '%freeze%'
 ORDER BY tgname;

-- As réguas que abrem versão. Esperado: trg_scoring_version_severity,
-- _label_ins, _label_upd, _label_del, e _attribution se a tabela existir.
SELECT c.relname AS tabela, t.tgname
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg_scoring_version%'
 ORDER BY 1, 2;


-- ── BLOCO 7: o cartão do líder no tablet ─────────────────────────────────
-- A segunda migração acrescenta points_at_creation à projecção de
-- leader_self_scorecard. Sem ela o tablet lê a régua de hoje e o gestor lê a
-- régua do dia — o mesmo líder, a mesma semana, dois números.
-- Esperado: true.
SELECT position('points_at_creation' IN pg_get_functiondef(p.oid)) > 0
         AS projecta_o_congelado
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'leader_self_scorecard';
