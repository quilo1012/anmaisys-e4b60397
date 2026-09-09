-- A projecção do tablet passa a dizer de que sistema veio a linha.
--
-- 115 das 135 acções não têm `action_no`, e as duas ausências não são a mesma coisa.
-- Uma acção escrita à mão no ecrã de Quality pode simplesmente nunca ter recebido
-- número. Uma acção da SafetyCulture TEM sempre um — `unique_id`, "A-1042", o número
-- que a fábrica lê no telemóvel — e é esta base que ainda não o guarda: nas 66 linhas
-- importadas o campo está a NULL, incluindo nas 36 que a SafetyCulture voltou a
-- alterar depois de o importador aprender a lê-lo.
--
-- Sem `source` o cartão não consegue distinguir os dois casos e a única saída honesta
-- é não escrever nada em nenhum — que é o que fazia. Com ele, uma linha sem referência
-- diz onde a referência vive, e passa a mostrar o número no dia em que ele chegar, sem
-- mais nenhuma alteração aqui.
--
-- O select do gestor já podia pedir a coluna (é PostgREST sobre a tabela); esta função
-- é a outra via, e as duas têm de projectar o mesmo campo ou o líder e o gestor leem
-- cartões diferentes sobre a mesma pessoa — que é a única coisa que este módulo não
-- pode fazer. Ver LeaderScorecardBody.
--
-- Escrito como emenda ao texto da função e não como CREATE OR REPLACE completo, pelo
-- mesmo motivo que 20260908170000: o corpo desta função é longo e tem sido alterado
-- por várias migrações, e recopiá-lo por inteiro faz desta migração uma reversão
-- silenciosa de tudo o que entrou depois da cópia.
--
-- E acrescenta mais duas ao mesmo tempo, que não são novidade nenhuma para a base e
-- são-no para este repositório. `title` e `error_type` ESTÃO na função em produção e
-- não há migração nenhuma aqui que os lá tenha posto — entraram por fora. Enquanto
-- assim for, qualquer reconstrução da função a partir das migrações apaga-os, e a
-- projecção do tablet volta a dizer "No description recorded" sobre as 54 acções que
-- só se descrevem no `title`. Ficam declarados aqui para que o repositório passe a
-- explicar o que a produção já tem. Cada coluna é acrescentada só se faltar, portanto
-- correr isto contra a base de hoje só acrescenta `source`.
DO $$
DECLARE
  _src   text;
  _col   text;
  _anchor constant text := 'qa.points_at_creation';
  _added text[] := '{}';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'leader_self_scorecard'
   LIMIT 1;

  IF _src IS NULL THEN
    RAISE NOTICE 'leader_self_scorecard nao existe nesta base. Sem alteracao.';
    RETURN;
  END IF;

  IF position(_anchor IN _src) = 0 THEN
    RAISE EXCEPTION
      'leader_self_scorecard nao contem "%" — a funcao mudou de forma. Acrescentar as '
      'colunas a mao. Uma projeccao que nao traz a coluna entrega-a como NULL, e todos '
      'os predicados deste modulo leem NULL como "nao ha motivo para excluir".', _anchor;
  END IF;

  -- Escritas por extenso, e não montadas a partir do nome da coluna: é assim que
  -- theTwoCardsProjectTheSameRow.test.ts consegue ler daqui o que esta função projecta.
  -- Um teste que não consegue ver a coluna no ficheiro não guarda nada.
  FOREACH _col IN ARRAY ARRAY['qa.source', 'qa.title', 'qa.error_type'] LOOP
    IF position(_col IN _src) = 0 THEN
      _src := replace(_src, _anchor, _anchor || ', ' || _col);
      _added := _added || _col;
    END IF;
  END LOOP;

  IF cardinality(_added) = 0 THEN
    RAISE NOTICE 'leader_self_scorecard ja projecta source, title e error_type. Sem alteracao.';
    RETURN;
  END IF;

  EXECUTE _src;
  RAISE NOTICE 'leader_self_scorecard passa a projectar %.', array_to_string(_added, ', ');
END $$;
