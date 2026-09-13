-- O board de líderes saía de `leader_line_assignment`. Essa tabela tem SETE linhas e
-- todas sem fim — "Rafael Tosta tem a Line 4 desde 2026-08-17, sem data de término" —
-- por isso a semana de 06/09/2026 mostrava sete cartões: um dono fixo por linha, o
-- mesmo em todas as semanas, e vinte e quatro dos trinta e um líderes activos sem
-- cartão nenhum.
--
-- Medido na base a 11/09/2026, para a semana que termina a 2026-09-06:
--
--   scorecard_week_board('2026-09-06')                      ->  7 linhas
--   pares (líder, linha) em production_sessions nessa semana -> 22 linhas
--
-- `production_sessions` é escrita quando alguém abre a linha e regista a linha, a data,
-- o turno e quem abriu. É o registo de quem esteve lá, e é dele que o board passa a sair.
--
-- Duas coisas que a sondagem corrigiu face ao que se julgava:
--
--   1. `production_sessions.leader_id` NÃO está nulo em toda a tabela — 426 das 721
--      linhas têm-no, e onde existe concorda com `leader_name` em 426 de 426 casos.
--      O que está a zero é precisamente a semana de 31/08–06/09: 51 sessões com nome
--      e nenhuma com id. Por isso a resolução é `COALESCE(leader_id, <pelo nome>)`:
--      usa o id quando a sessão o tem, e cai no nome só quando não tem.
--   2. A ligação pelo nome só é aceite quando EXACTAMENTE UM líder responde ao nome.
--      Um nome que duas pessoas partilham não identifica ninguém. Hoje os 29 nomes
--      distintos de `production_sessions` resolvem todos para um único líder — as
--      verificações 5d e 5e do pacote voltam a medir isso e têm de dar zero. Se um dia
--      derem alguma coisa, há sessões a desaparecer do board em silêncio.
--
-- O tipo de retorno ganha `shifts_led`, por isso é um DROP e não um CREATE OR REPLACE.
-- `DROP FUNCTION` leva as permissões com ele: a função tinha `authenticated` e
-- `service_role` explícitos e `PUBLIC` revogado (`{postgres=X,authenticated=X,
-- service_role=X}`), e sem repor isso a aplicação deixa de a conseguir chamar.

-- ---------------------------------------------------------------------------
-- 1. O board sai de quem abriu a linha
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.scorecard_week_board(date);

CREATE FUNCTION public.scorecard_week_board(_week_ending date)
RETURNS TABLE(
  leader_id uuid,
  leader_name text,
  line_id uuid,
  line_name text,
  shifts_led integer,
  entry_id uuid,
  state text,
  volume_rag text,
  quality_rag text,
  hs_rag text,
  overall_rag text,
  rag_driver text,
  capa_required boolean,
  score_final numeric,
  score_bruto numeric,
  cap_reason text,
  cap_applied boolean
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH sessao AS (
    -- Uma sessão por (data, turno, linha, quem abriu), já resolvida a ids. A resolução
    -- vem ANTES do DISTINCT de propósito: duas sessões do mesmo turno, uma com
    -- `leader_id` e outra só com o nome, são o mesmo turno da mesma pessoa e não podem
    -- contar duas vezes em `shifts_led`.
    SELECT
      ps.session_date,
      ps.shift,
      COALESCE(
        ps.leader_id,
        (SELECT ll.id
           FROM public.line_leaders ll
          WHERE lower(btrim(ll.name)) = lower(btrim(ps.leader_name))
            AND (SELECT count(*)
                   FROM public.line_leaders l2
                  WHERE lower(btrim(l2.name)) = lower(btrim(ps.leader_name))) = 1
          LIMIT 1)
      ) AS leader_id,
      -- `production_sessions.line` é texto e `lines.name` é a tabela; a normalização é a
      -- mesma que `scorecard_derived_volume` já usava, para que as duas não divirjam.
      (SELECT ln.id
         FROM public.lines ln
        WHERE lower(replace(btrim(ln.name), ' ', '')) = lower(replace(btrim(ps.line), ' ', ''))
        LIMIT 1) AS line_id
    FROM public.production_sessions ps
    WHERE ps.session_date BETWEEN _week_ending - 6 AND _week_ending
      AND ps.leader_name IS NOT NULL
  ),
  turnos AS (
    SELECT DISTINCT session_date, shift, leader_id, line_id
    FROM sessao
    WHERE leader_id IS NOT NULL
      AND line_id IS NOT NULL
  ),
  par AS (
    SELECT leader_id, line_id, count(*)::integer AS shifts_led
    FROM turnos
    GROUP BY leader_id, line_id
  )
  SELECT
    par.leader_id,
    ll.name,
    par.line_id,
    ln.name,
    par.shifts_led,
    w.id,
    CASE
      WHEN w.id IS NULL              THEN 'por preencher'
      WHEN w.approved_at IS NOT NULL THEN 'aprovada'
      WHEN w.submitted_at IS NOT NULL THEN 'submetida'
      ELSE 'rascunho'
    END,
    w.volume_rag, w.quality_rag, w.hs_rag, w.overall_rag,
    w.rag_driver, w.capa_required,
    w.score_final, w.score_bruto, w.cap_reason, w.cap_applied
  FROM par
  JOIN public.line_leaders ll ON ll.id = par.leader_id
  JOIN public.lines        ln ON ln.id = par.line_id
  LEFT JOIN public.v_leader_weekly_scorecard w
         ON w.leader_id   = par.leader_id
        AND w.line_id     = par.line_id
        AND w.week_ending = _week_ending
  -- Por linha e depois por líder: com vários líderes na mesma linha, é a linha que
  -- agrupa a leitura. Ordenar por nome do líder espalhava os três da Line 3 pelo board.
  ORDER BY ln.display_order NULLS LAST, ln.name, ll.name;
$function$;

-- PUBLIC **e** anon: o schema `public` deste projeto tem ALTER DEFAULT PRIVILEGES que
-- concede EXECUTE a anon/authenticated/service_role em cada funcao nova, por isso a
-- funcao recriada nasce com `anon=X` que a original nao tinha. Verificado na base: sem
-- este REVOKE a ACL fica `{postgres,anon,authenticated,service_role}`; com ele volta a
-- ser exactamente `{postgres,authenticated,service_role}`.
REVOKE ALL ON FUNCTION public.scorecard_week_board(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scorecard_week_board(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.scorecard_week_board(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scorecard_week_board(date) TO service_role;

COMMENT ON FUNCTION public.scorecard_week_board(date) IS
  'O board da semana, uma linha por (líder, linha) que abriu turno nessa semana segundo production_sessions. shifts_led diz quantos turnos daquela linha foram daquela pessoa.';

-- ---------------------------------------------------------------------------
-- 2. O volume oferecido é o dos turnos do líder, não o da linha inteira
-- ---------------------------------------------------------------------------
--
-- Com a atribuição certa mas o volume da linha, o cartão do Kaz na Line 1 oferecia as
-- 24 533 unidades da semana inteira — o trabalho de nove turnos, quando ele fez três.
--
-- `rag_weekly_entries` e `production_sessions` são ambas por (linha, turno, dia), por
-- isso o volume do líder é uma SELECÇÃO das mesmas linhas, não uma estimativa nem um
-- rateio. Medido para a semana de 06/09:
--
--   Line 1   total 24 533     Kaz 3 turnos 96,2% | Lucas 2 103,8% | Murilo 2 102,8%
--   Line 6                    Ailton 4 86,5% | Henrique 2 73,1% | Pedro 1 103,7% | Izildo 1 102,6%
--
-- `_leader_id` entra como terceiro parâmetro COM DEFAULT NULL, e não como uma função
-- nova: assim a chamada de dois argumentos que o código ainda faz continua a resolver
-- para esta função e devolve exactamente o que devolvia antes — o total da linha. Isso
-- é o que mantém a base aplicável sozinha, antes de o código ir.

DROP FUNCTION IF EXISTS public.scorecard_derived_volume(uuid, date);

CREATE FUNCTION public.scorecard_derived_volume(
  _line_id uuid,
  _week_ending date,
  _leader_id uuid DEFAULT NULL
)
RETURNS TABLE(
  planned_volume integer,
  actual_volume integer,
  unplanned_downtime_minutes integer,
  source_label text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH alvo AS (
    SELECT lower(replace(btrim(ln.name), ' ', '')) AS chave
    FROM public.lines ln
    WHERE ln.id = _line_id
  ),
  turnos AS (
    -- Os (dia, turno) que este líder abriu nesta linha nesta semana. Vazio quando
    -- `_leader_id` é nulo — e nesse caso o filtro abaixo não se aplica de todo.
    SELECT DISTINCT ps.session_date, ps.shift
    FROM public.production_sessions ps
    CROSS JOIN alvo
    WHERE _leader_id IS NOT NULL
      AND ps.session_date BETWEEN _week_ending - 6 AND _week_ending
      AND lower(replace(btrim(ps.line), ' ', '')) = alvo.chave
      AND COALESCE(
            ps.leader_id,
            (SELECT ll.id
               FROM public.line_leaders ll
              WHERE lower(btrim(ll.name)) = lower(btrim(ps.leader_name))
                AND (SELECT count(*)
                       FROM public.line_leaders l2
                      WHERE lower(btrim(l2.name)) = lower(btrim(ps.leader_name))) = 1
              LIMIT 1)
          ) = _leader_id
  )
  -- Sem NULLIF, pela mesma razão de sempre: sum() sobre zero linhas já dá a única
  -- ausência verdadeira, e um zero REGISTADO — uma linha que genuinamente não produziu
  -- — é um facto e tem de ler 0. Com `_leader_id` preenchido, "zero linhas" passa a
  -- poder significar também "este líder não abriu nenhum turno nesta linha", que é
  -- igualmente uma ausência e não um zero.
  SELECT
    sum(e.plan_qty)::integer,
    sum(e.actual_qty)::integer,
    sum(e.downtime_min)::integer,
    CASE WHEN _leader_id IS NULL THEN 'RAG Weekly' ELSE 'RAG Weekly (turnos deste líder)' END
  FROM public.rag_weekly_entries e
  CROSS JOIN alvo
  WHERE lower(replace(btrim(e.line), ' ', '')) = alvo.chave
    AND e.entry_date BETWEEN _week_ending - 6 AND _week_ending
    AND (
      _leader_id IS NULL
      OR EXISTS (SELECT 1 FROM turnos t
                  WHERE t.session_date = e.entry_date
                    AND t.shift = e.shift)
    );
$function$;

REVOKE ALL ON FUNCTION public.scorecard_derived_volume(uuid, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scorecard_derived_volume(uuid, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.scorecard_derived_volume(uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scorecard_derived_volume(uuid, date, uuid) TO service_role;

COMMENT ON FUNCTION public.scorecard_derived_volume(uuid, date, uuid) IS
  'O que a produção registou nesta linha e semana. Com _leader_id, só os (dia, turno) que essa pessoa abriu; sem ele, a linha inteira.';

-- ---------------------------------------------------------------------------
-- 3. Aprovar exige submeter
-- ---------------------------------------------------------------------------
--
-- O trigger verificava a CAPA, o `approved_by` e o papel de quem assina, e nunca olhava
-- para `submitted_at` — a palavra não aparecia no corpo da função. Uma semana podia ir
-- de rascunho a aprovada sem passar por submetida, que é justamente o estado que o
-- board mostra e o passo em que alguém declara a semana terminada.
--
-- `leader_weekly_scorecard` tem hoje ZERO linhas, portanto não há nenhuma semana
-- aprovada-sem-submissão para reparar e a regra não quebra nada já gravado.

CREATE OR REPLACE FUNCTION public.scorecard_require_capa_before_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _fail_type text;
  _approval_changed boolean;
BEGIN
  IF NEW.approved_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Aprovar é o segundo passo, nunca o primeiro.
  IF NEW.submitted_at IS NULL THEN
    RAISE EXCEPTION
      'Uma semana tem de ser submetida antes de ser aprovada: submitted_at esta por preencher.'
      USING ERRCODE = 'check_violation';
  END IF;

  _fail_type := public.scorecard_quality_fail_type(
    ARRAY[NEW.ccp_check_status, NEW.starter_check_status, NEW.volume_weight_check_status]);

  IF _fail_type = 'Fail'
     AND (nullif(btrim(coalesce(NEW.root_cause, '')), '')        IS NULL
       OR nullif(btrim(coalesce(NEW.corrective_action, '')), '') IS NULL
       OR nullif(btrim(coalesce(NEW.capa_owner, '')), '')        IS NULL
       OR NEW.capa_due_date IS NULL) THEN
    RAISE EXCEPTION
      'Semana com check reprovado (Fail) nao pode ser aprovada sem CAPA: root_cause, corrective_action, capa_owner e capa_due_date sao obrigatorios.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- An approval names somebody. An unsigned approval is not a trail.
  IF NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'Aprovacao exige approved_by.' USING ERRCODE = 'check_violation';
  END IF;

  _approval_changed := TG_OP = 'INSERT'
    OR OLD.approved_by IS DISTINCT FROM NEW.approved_by
    OR OLD.approved_at IS DISTINCT FROM NEW.approved_at;

  IF _approval_changed THEN
    -- ...and the somebody it names is the person doing it. Otherwise any writer
    -- could sign an approval in a colleague's name.
    IF NEW.approved_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'Aprovacao tem de ser assinada por quem a faz: approved_by tem de ser o utilizador autenticado.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- ...and that person holds a role that may approve. Preencher e aprovar sao
    -- permissoes diferentes (scorecard.fill vs scorecard.approve): production_office_admin
    -- preenche a semana e nao a assina.
    IF NOT (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
    ) THEN
      RAISE EXCEPTION
        'Sem permissao para aprovar uma semana: e preciso admin, manager ou quality_supervisor.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $function$;
