-- O cartão do líder listava acções sem saber dizer o que eram.
--
-- Metade do `quality_actions` chega do SafetyCulture, e uma linha sincronizada não traz
-- `action_no` nem `description`: o que aconteceu está em `title` ("Excessive Powder
-- Leakage hopper (L6)") e a classificação em `error_type`. Nenhuma das duas colunas
-- estava em nenhum dos dois caminhos de leitura do scorecard, por isso a folha impressa
-- de um líder saía com cinco acções identificadas por oito caracteres do próprio UUID e
-- cinco linhas de texto vazias. O score estava certo; a prova dele é que era ilegível,
-- na folha que se imprime e se assina.
--
-- O caminho do gestor é um select PostgREST e foi alargado no mesmo commit que este.
-- Este é o caminho do tablet: uma função SECURITY DEFINER, porque a RLS prende a sessão
-- do tablet a uma linha só. A projecção dela é uma lista fixa escrita em 20260811090000,
-- e uma coluna que a lista não nomeia não chega ao JSON — o líder continuaria a ver
-- UUIDs no seu próprio cartão depois de o gestor já ver os nomes. Duas leituras, uma
-- aritmética: é a regra que abre src/lib/leaderScorecard.ts.
--
-- PORQUE É QUE ISTO REMENDA EM VEZ DE REESCREVER. Pela mesma razão que 20260822093000:
-- a função tem mais de duzentas linhas e nada aqui aplica migrações, por isso o
-- repositório é o registo da intenção e a base é o registo do facto. Isto lê a definição
-- viva, confirma que tem a forma que espera, e reescreve só a projecção. Se a função
-- viva tiver divergido, levanta excepção em vez de adivinhar.

DO $patch$
DECLARE
  _src text;
  -- Exactamente como 20260811090000 escreveu a linha. Ancorar no meio da lista, e não
  -- na cauda, porque a cauda já foi movida duas vezes (20260822093000, e o par
  -- domain/safety_kind).
  _old constant text := 'qa.line, qa.action_no, qa.description, qa.shift, qa.validation_status,';
  _new constant text := 'qa.line, qa.action_no, qa.description, qa.title, qa.error_type, qa.shift, qa.validation_status,';
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

  -- Idempotente: voltar a correr uma migracao nao pode ser uma forma de partir algo.
  IF position('qa.title' IN _src) > 0 THEN
    RAISE NOTICE 'leader_self_scorecard ja projecta qa.title. Sem alteracao.';
    RETURN;
  END IF;

  -- A coluna tem de existir antes de ser projectada. Uma base anterior ao sync do
  -- SafetyCulture nao tem nenhuma linha sincronizada para nomear, por isso nao ha nada
  -- a corrigir nela — e reescrever a funcao para uma coluna inexistente deixaria o
  -- cartao do lider sem funcao nenhuma, que e muito pior do que um UUID.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'quality_actions'
       AND column_name IN ('title', 'error_type')
     GROUP BY table_name HAVING count(*) = 2
  ) THEN
    RAISE NOTICE 'quality_actions ainda nao tem title/error_type nesta base. Nada a projectar.';
    RETURN;
  END IF;

  _hits := (length(_src) - length(replace(_src, _old, ''))) / length(_old);

  IF _hits <> 1 THEN
    RAISE EXCEPTION
      'A projeccao de leader_self_scorecard nao tem a forma esperada (% ocorrencias de "%"). '
      'A funcao viva divergiu do que esta migracao conhece: comparar antes de aplicar, e '
      'acrescentar qa.title e qa.error_type a mao. Um cartao que lista accoes sem as saber '
      'nomear e o defeito que isto corrige.',
      _hits, _old
      USING ERRCODE = 'raise_exception';
  END IF;

  EXECUTE replace(_src, _old, _new);
  RAISE NOTICE 'leader_self_scorecard passa a projectar qa.title e qa.error_type.';
END $patch$;
