import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildSkuCatalogue, type SkuRow, type SkuCatalogue } from "@/lib/lineSku";

/**
 * O catálogo de produtos, uma vez por sessão, para quem precisa de nomear o que
 * uma linha está a fazer.
 *
 * `lineSku.ts` diz qual é a REGRA — um item identifica o produto por `sku_id` ou
 * pelo código em texto, e as duas colunas têm de ser lidas. Isto é a outra
 * metade: de onde vêm as linhas contra as quais essa regra resolve. Estava
 * escrito dentro do painel de desempenho, e o ecrã de parede — que faz a mesma
 * pergunta, sobre as mesmas linhas — não tinha catálogo nenhum e mostrava um
 * travessão nos itens sem `sku_id`.
 *
 * A chave é a mesma que o painel já usava, de propósito: os dois ecrãs partilham
 * a entrada em cache em vez de irem os dois à base.
 */
export function useSkuCatalogue(): { catalogue: SkuCatalogue; isLoading: boolean } {
  const { data: skus = [], isLoading } = useQuery({
    queryKey: ["sku_products_min"],
    // O catálogo muda quando alguém edita um produto, o que não é ao minuto. Um
    // ecrã de parede que fica ligado dias não tem de o reler a cada foco.
    staleTime: 10 * 60_000,
    queryFn: async () => {
      // Paginate past the ~1000-row PostgREST cap so SKUs beyond 1000 resolve.
      const pageSize = 1000;
      const rows: SkuRow[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("sku_products")
          .select("id, code, name, target_per_hour")
          .order("code")
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as SkuRow[];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows;
    },
  });

  const catalogue = useMemo(() => buildSkuCatalogue(skus), [skus]);
  return { catalogue, isLoading };
}
