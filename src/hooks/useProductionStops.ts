import { useQuery } from "@tanstack/react-query";
import { format, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
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
 *
 * ISSO NÃO SE CUMPRIA. Um `.limit(20 000)` não levanta o tecto de 1 000 linhas que o
 * PostgREST impõe do lado do servidor: a resposta vinha com 1 000 linhas, sem erro e
 * sem aviso, e `1000 >= 20 000` é falso, por isso o aviso de truncagem nunca chegou a
 * aparecer. O ecrã somava os 5 dias mais recentes e escrevia "last 30 days" — 226h34
 * onde a fábrica parou 2 679h, e 1 000 paragens onde houve 7 352. O tecto é agora o do
 * `fetchAllRows`, que lê por páginas até uma vir curta, e `truncated` compara-se com
 * esse tecto e não com o tamanho de uma resposta que o servidor já tinha cortado.
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
  //
  // E truncado em hora LOCAL. O `occurred_date` é uma data operacional, não um
  // instante, e `toISOString()` passa primeiro por UTC: em BST, a meia-noite de hoje é
  // as 23:00 de ontem, e `.slice(0, 10)` lia daí o dia anterior. "Hoje" trazia dois
  // dias — a Line 1 aparecia com 2h53m de pausas num turno em que fez 1h22m, somadas
  // com as de ontem, e o filtro de turno não as separava porque ambas são DAY.
  const fromDay = format(startOfDay(from), "yyyy-MM-dd");
  const toDay = format(to, "yyyy-MM-dd");

  return useQuery({
    queryKey: ["production_stops", fromDay, toDay],
    queryFn: async (): Promise<ProductionStopsResult> => {
      // Sem `machine`: a coluna existe, o ecrã nunca a leu, e o poll não a escreve —
      // `machine` é NULL nas 15 290 linhas da tabela, porque o `intouch-poll` põe o
      // nome da máquina em `notes` e omite a coluna no insert. Era uma leitura morta
      // de uma coluna que ninguém preenche, e agora são menos 15 mil campos a viajar.
      //
      // Ordenado por `id`, que é único. O `occurred_date` repete-se centenas de vezes
      // por dia, e uma ordem com empates não é uma ordem: entre duas páginas o
      // servidor pode devolver a mesma linha outra vez e saltar outra.
      const stops = await fetchAllRows<ProductionStop>(
        {
          range: (lo, hi) =>
            (supabase as any)
              .from("production_downtimes")
              .select("id, occurred_date, shift, line, reason, duration_minutes")
              .gte("occurred_date", fromDay)
              .lte("occurred_date", toDay)
              .order("id", { ascending: true })
              .range(lo, hi),
        },
        STOPS_ROW_LIMIT,
      );
      return { stops, truncated: stops.length >= STOPS_ROW_LIMIT };
    },
    staleTime: 5 * 60_000,
  });
}
