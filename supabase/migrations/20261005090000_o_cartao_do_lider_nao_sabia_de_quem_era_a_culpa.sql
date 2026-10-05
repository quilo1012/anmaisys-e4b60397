-- O cartão do líder não sabia de quem era a culpa.
--
-- `leader_self_scorecard` é a única porta pela qual o tablet lê o cartão: as linhas
-- vêm de uma projecção FIXA, e uma coluna que a lista não nomeia chega ao cliente
-- como `undefined`. Todos os predicados deste repositório leem `undefined` como "não
-- há motivo para excluir" — é o mesmo defeito que `20260822093000` (domain) e
-- `20260908170000` (classification) já vieram fechar, pela terceira vez.
--
-- Medido na base viva a 04/10/2026, com pg_get_functiondef. A projecção acaba em
-- `qa.points_at_creation` e NÃO nomeia três colunas que o select do gestor nomeia:
--
--   root_cause_area   77 acções com líder têm uma causa que não lhe é cobrada
--                     (Maintenance 49, Lab 12, Warehouse 9, Office 5, Supplier 2)
--   classification    0 linhas afectadas hoje — nenhuma `excluded`/`quality_error`
--                     tem leader_name — mas `20260908170000` foi escrita para a
--                     acrescentar e nunca chegou a correr nesta base
--   source            separa as duas origens do log; o gestor lê-a, o tablet não
--
-- O que isto estragava, e não é o total. As 77 têm todas `points_at_creation = 0`,
-- e `actionPoints` prefere a figura congelada, portanto o NÚMERO no tablet está
-- certo. O que está errado é a RAZÃO. Sem `root_cause_area`, `livePoints` recalcula
-- 4 para uma acção congelada a 0, e `pointsBreakdown` entra no ramo "frozen":
--
--   "0 points — the scale in force when this was logged. Today's scale would make
--    it 4; past actions keep the scale of their own day."
--
-- O cartão do gestor, com a coluna, diz a verdade na mesma acção:
--
--   "0 points — root cause is Office, so this is not charged to the leader."
--
-- A um líder que abre o seu próprio cartão a primeira frase diz que houve uma tabela
-- de preços que mudou. Não houve: a Qualidade atribuiu aquilo ao Office. Duas frases
-- diferentes para a mesma linha é o que `leaderScorecard.ts` abre a proibir — "Two
-- fetch paths, one arithmetic" — e aqui as duas vias davam razões contraditórias.
--
-- PORQUE É QUE ISTO REMENDA EM VEZ DE SUBSTITUIR: a mesma razão que `20260822093000`
-- e `20260908170000` dão. A função é longa, nada neste repositório aplica migrações,
-- e por isso o repositório é o registo da INTENÇÃO e a base é o registo do FACTO. Lê
-- a definição viva, confirma que tem a forma que espera, e reescreve só a projecção.
-- Se a função tiver divergido, LEVANTA em vez de adivinhar.

DO $patch$
DECLARE
  _src text;
  -- A cauda da projecção. Ancorar na última coluna, e não na lista inteira, é o que
  -- mantém isto a funcionar quando uma coluna foi acrescentada à frente entretanto —
  -- foi exactamente o que aconteceu a `domain` e `safety_kind` depois de 20260822093000.
  _anchor constant text := 'qa.points_at_creation';
  -- Por ordem de quanto custa a sua ausência. Cada uma é acrescentada só se faltar,
  -- para que isto e `20260908170000` possam correr em qualquer ordem, ou duas vezes.
  --
  -- Escritas com o prefixo `qa.` à letra, e não montadas com `'qa.' || _col`:
  -- theTwoCardsProjectTheSameRow.test.ts procura `qa.<coluna>` nos ficheiros desta
  -- pasta, e uma lista montada em tempo de execução não aparece a quem lê o texto.
  _wanted constant text[] := ARRAY['qa.root_cause_area', 'qa.classification', 'qa.source'];
  _missing text[] := '{}';
  _col text;
  _hits integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'leader_self_scorecard';

  IF _src IS NULL THEN
    RAISE NOTICE 'leader_self_scorecard nao existe nesta base. Nada a corrigir.';
    RETURN;
  END IF;

  FOREACH _col IN ARRAY _wanted LOOP
    IF position(_col IN _src) = 0 THEN
      _missing := _missing || _col;
    END IF;
  END LOOP;

  -- Idempotente: voltar a correr uma migração não pode ser uma maneira de estragar algo.
  IF cardinality(_missing) = 0 THEN
    RAISE NOTICE 'leader_self_scorecard ja projecta as tres colunas. Sem alteracao.';
    RETURN;
  END IF;

  _hits := (length(_src) - length(replace(_src, _anchor, ''))) / length(_anchor);

  IF _hits <> 1 THEN
    RAISE EXCEPTION
      'A projeccao de leader_self_scorecard nao tem a forma esperada (% ocorrencias de "%"). '
      'A funcao viva divergiu do que esta migracao conhece: comparar com '
      'pg_get_functiondef antes de aplicar, e acrescentar % a mao. Um cartao que diz '
      'ao lider que o preco mudou, quando o que mudou foi a area culpada, e o defeito '
      'que isto corrige.',
      _hits, _anchor, array_to_string(_missing, ', ')
      USING ERRCODE = 'raise_exception';
  END IF;

  EXECUTE replace(
    _src,
    _anchor,
    _anchor || ', ' || array_to_string(_missing, ', ')
  );

  RAISE NOTICE 'leader_self_scorecard passa a projectar %.', array_to_string(_missing, ', ');
END $patch$;
