-- A ordem do armazém tem a sua própria série.
--
-- `work_orders.wo_number` é `DEFAULT nextval('wo_number_seq')` — uma sequência
-- só para toda a gente — com um índice UNIQUE por cima. As 14 ordens de armazém
-- abertas desde 09/09 tiraram senha dessa fila: ficaram com os números 1027,
-- 1042, 1051… e deixaram catorze buracos na série da manutenção, que é a série
-- que vai nas folhas assinadas.
--
-- UMA COLUNA NOVA, E NÃO UMA SEGUNDA SEQUÊNCIA NA MESMA COLUNA. Duas sequências
-- a escrever em `wo_number` colidem contra o UNIQUE assim que a segunda alcançar
-- um número que a primeira já deu — não é um risco teórico, é uma questão de
-- semanas. Tornar o índice parcial por `wo_type` partia a única coisa que
-- `wo_number` promete: que identifica uma ordem.
--
-- Por isso `wo_number` não se toca. Fica o identificador interno, o índice fica
-- íntegro, e a única consulta do sistema que procura por ele
-- (`src/lib/mcp/tools/get-work-order.ts`) não dá por nada. O que é novo é
-- `warehouse_number`, preenchido só para as ordens de armazém, e é ele que a
-- interface escreve como `WH-2026-000001`.
--
-- AS 14 QUE JÁ EXISTEM SÃO RENUMERADAS, por ordem de abertura. Decidido com o
-- utilizador a 15/09/2026. É seguro precisamente porque o `wo_number` antigo não
-- desaparece: quem tiver uma folha com WO-2026-001027 continua a encontrá-la
-- pela pesquisa.
--
-- O trigger é BEFORE INSERT e não um DEFAULT na coluna: um default corre em toda
-- a linha inserida, e só as de armazém podem gastar a sequência. Uma ordem de
-- manutenção que passasse por aqui deixaria um buraco na série nova — o mesmo
-- erro, ao contrário.

-- ── A sequência ──────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.warehouse_number_seq AS integer START WITH 1;

-- ── A coluna ─────────────────────────────────────────────────────────────────
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS warehouse_number integer;

COMMENT ON COLUMN public.work_orders.warehouse_number IS
  'Série própria das ordens de armazém (WH-YYYY-NNNNNN). Nula em tudo o resto. O wo_number continua a ser o identificador da ordem.';

-- Único entre as ordens de armazém, e indiferente às outras: um índice parcial
-- diz exactamente isso, e não obriga as 616 ordens de manutenção a carregar uma
-- entrada nula cada.
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_warehouse_number
  ON public.work_orders (warehouse_number)
  WHERE warehouse_number IS NOT NULL;

-- ── Quem o atribui ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.work_orders_set_warehouse_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- `to_jsonb(NEW)->>'wo_type'` e não `NEW.wo_type`: é como os outros triggers
  -- desta tabela lêem campos que podem não existir na versão da linha que lhes
  -- chega, e custa o mesmo.
  IF coalesce(to_jsonb(NEW)->>'wo_type', 'production') = 'warehouse_service'
     AND NEW.warehouse_number IS NULL THEN
    NEW.warehouse_number := nextval('public.warehouse_number_seq');
  END IF;
  RETURN NEW;
END;
$$;

-- `REVOKE FROM PUBLIC` porque recriar uma função devolve-lhe o EXECUTE do anon:
-- o `CREATE OR REPLACE` acima repõe os defaults de quem a pode correr.
REVOKE ALL ON FUNCTION public.work_orders_set_warehouse_number() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_work_orders_set_warehouse_number ON public.work_orders;
CREATE TRIGGER trg_work_orders_set_warehouse_number
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.work_orders_set_warehouse_number();

-- ── As que já existem ────────────────────────────────────────────────────────
-- Por ordem de abertura, 1..N. Idempotente: só toca nas que ainda não têm
-- número, para poder correr outra vez sem renumerar nada.
WITH ordenadas AS (
  SELECT id, row_number() OVER (ORDER BY created_at, wo_number) AS n
  FROM public.work_orders
  WHERE coalesce(wo_type, 'production') = 'warehouse_service'
    AND warehouse_number IS NULL
)
UPDATE public.work_orders w
SET warehouse_number = o.n + coalesce(
      (SELECT max(warehouse_number) FROM public.work_orders), 0)
FROM ordenadas o
WHERE w.id = o.id;

-- A sequência continua de onde o backfill parou, ou a espera seguinte repetia
-- um número que já está numa folha.
SELECT setval(
  'public.warehouse_number_seq',
  greatest(coalesce((SELECT max(warehouse_number) FROM public.work_orders), 0), 1),
  (SELECT count(*) > 0 FROM public.work_orders WHERE warehouse_number IS NOT NULL)
);
