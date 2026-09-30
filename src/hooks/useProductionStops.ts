import { useQuery } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { ProductionStop } from "@/lib/stopAnalysis";

/**
 * As paragens de produção, como o iTouching as escreveu.
 *
 * `production_downtimes` recebe cerca de 6 700 linhas por mês, uma por paragem, com o
 * motivo vindo da lista de códigos do iTouching. É o registo mais completo que a
 * fábrica tem sobre o que a impede de produzir, e até agora nenhum ecrã o lia.
 *
 * NÃO CONFUNDIR COM `downtime_events`. Essa é a paragem que um humano marca no tablet
 * quando abre uma ordem de manutenção — cerca de 190 por mês, e sempre por avaria.
 * Esta é a contagem da máquina, e inclui preparação, limpeza e pausas. As duas medem
 * coisas diferentes e não se somam.
 *
 * O limite de 20 000 linhas é deliberado e visível: chega para três meses de fábrica,
 * e o ecrã diz quando lá bate em vez de mostrar um total truncado como se fosse o
 * total. Um relatório que mente sobre o seu próprio período é pior do que nenhum.
 */

/** Tecto de linhas por consulta. Três meses de fábrica cabem folgadamente. */
export const STOPS_ROW_LIMIT = 20_000;

export interface ProductionStopsResult {
  stops: ProductionStop[];
  /** O tecto foi atingido: o que está no ecrã é uma parte, não o todo. */
  truncated: boolean;
}

export function useProductionStops(from: Date, to: Date) {
  // A chave nunca leva um `Date` cru: `new Date()` é um instante novo a cada render e
  // punha o React Query a buscar sem fim. Truncado ao dia e serializado.
  const fromIso = startOfDay(from).toISOString();
  const toIso = to.toISOString();

  return useQuery({
    queryKey: ["production_stops", fromIso, toIso],
    queryFn: async (): Promise<ProductionStopsResult> => {
      const { data, error } = await (supabase as any)
        .from("production_downtimes")
        .select("id, occurred_date, shift, line, reason, duration_minutes, machine")
        .gte("occurred_date", fromIso.slice(0, 10))
        .lte("occurred_date", toIso.slice(0, 10))
        .order("occurred_date", { ascending: false })
        .limit(STOPS_ROW_LIMIT);
      if (error) throw error;
      const stops = (data ?? []) as ProductionStop[];
      return { stops, truncated: stops.length >= STOPS_ROW_LIMIT };
    },
    staleTime: 5 * 60_000,
  });
}
