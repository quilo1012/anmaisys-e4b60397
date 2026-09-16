import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

/**
 * Quem pode ajustar a Production Control — importar, corrigir o SKU, editar actuals.
 *
 * Era uma lista de papéis escrita a meio do ecrã, e faltava-lhe o
 * `production_office_admin`. O efeito não era uma porta fechada, que se vê: na mesma
 * linha da grelha ele mudava a quantidade, o lote, as horas de início e fim e até
 * apagava a linha toda — só a célula do SKU vinha em texto morto. Um SKU trocado pelo
 * líder só se corrigia apagando a linha e escrevendo-a de novo, o que perde o lote, as
 * horas e os blenders que já lá estavam.
 *
 * A base nunca esteve de acordo com o ecrã: a policy `office_admin all` dá ao
 * `production_office_admin` ALL em `production_items` e em `production_sessions`,
 * sem sequer a condição de sessão fechada que prende os outros. O menu também não
 * discordava — a linha "Production Control" lista-o e a rota pede `production.manage`.
 * Era este único sítio, e é por isso que a lista sai daqui em vez de ficar no ecrã.
 *
 * O operador não entra: escreve a sua linha pelo Line Production, onde a RLS o prende
 * à linha dele e à sessão aberta. Esta grelha é a folha do turno inteiro.
 */
const ADJUSTS_PRODUCTION_CONTROL: readonly AppRole[] = [
  "admin",
  "manager",
  "maintenance_manager",
  "supervisor",
  "production_office_admin",
];

export function canAdjustProductionControl(role: AppRole | null | undefined): boolean {
  return !!role && ADJUSTS_PRODUCTION_CONTROL.includes(role);
}
