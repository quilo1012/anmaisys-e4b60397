-- A hora que a janela de leitura não via.
--
-- `leader_self_scorecard` abre a sua janela de leitura em
--
--   _gte := (_from::text || 'T00:00:00.000Z')::timestamptz
--
-- que é UTC, enquanto TODAS as regras que decidem a que dia uma acção pertence leem a
-- hora de LONDRES — `shiftSessionDate` em src/lib/shifts.ts, e o `AT TIME ZONE
-- 'Europe/London'` que o resto desta base usa. Oito meses por ano as duas concordam.
-- Sob BST estão uma hora afastadas, e é a ponta de baixo que custa:
--
--   '2026-07-28T00:00:00Z' é 01:00 em Londres. Uma acção registada entre 00:00 e 00:59
--   do dia 28 — marcada 23:xx UTC do dia 27 — fica FORA da janela. Se a coluna `shift`
--   disser NIGHT ela pertence ao dia 27 e nada se perde. Se disser DAY,
--   `shiftSessionDate` arquiva-a no dia 28, o período pediu o dia 28, e a linha
--   simplesmente nunca foi lida. Sem erro e sem ecrã vazio: uma acção ausente do dia
--   de um líder, e nada que o diga.
--
-- Corrigido do lado do TypeScript em `shiftDateFetchRange`, que é a mesma janela e tinha
-- a mesma hora escrita da mesma maneira errada, e lida por seis ecrãs. Esta é a cópia
-- em SQL — "Two fetch paths, one arithmetic" — e tem de andar com a outra.
--
-- Medido na produção a 04/10/2026: as 48 acções registadas antes das 07:00 de Londres
-- têm todas uma coluna `shift` que concorda com o relógio (37 NIGHT antes das 06:00,
-- 11 DAY a partir das 06:00), portanto HOJE isto não move linha nenhuma. É a hora onde
-- a próxima teria caído.
--
-- SÓ A PONTA DE BAIXO. A de cima fica em `(_to + 1) 06:59:59.999Z` como está: o cliente
-- volta a filtrar tudo com `actionsInPeriod`, que devolve ao remetente qualquer linha
-- cuja data de turno caia fora do período, por isso a janela de cima só tem de ser um
-- SUPERCONJUNTO — e é. Apertá-la não ganharia uma linha e seria mais uma coisa a poder
-- estar errada.

DO $patch$
DECLARE
  _src text;
  _old constant text := '(_from::text || ''T00:00:00.000Z'')::timestamptz';
  _new constant text := '(_from::text || '' 00:00'')::timestamp AT TIME ZONE ''Europe/London''';
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

  -- Idempotente: voltar a correr uma migração não pode ser uma maneira de estragar algo.
  IF position(_new IN _src) > 0 THEN
    RAISE NOTICE 'leader_self_scorecard ja abre a janela a meia-noite de Londres. Sem alteracao.';
    RETURN;
  END IF;

  _hits := (length(_src) - length(replace(_src, _old, ''))) / length(_old);

  IF _hits <> 1 THEN
    RAISE EXCEPTION
      'A janela de leitura de leader_self_scorecard nao tem a forma esperada '
      '(% ocorrencias). A funcao viva divergiu do que esta migracao conhece: comparar '
      'com pg_get_functiondef antes de aplicar. O defeito a corrigir e _gte estar em '
      'UTC quando shiftSessionDate le a hora de Londres.',
      _hits
      USING ERRCODE = 'raise_exception';
  END IF;

  EXECUTE replace(_src, _old, _new);
  RAISE NOTICE 'leader_self_scorecard abre a janela a meia-noite de Londres.';
END $patch$;
