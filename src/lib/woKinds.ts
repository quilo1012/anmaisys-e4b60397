/**
 * O que é uma ordem de manutenção, e o que não é.
 *
 * A `work_orders` guarda dois trabalhos diferentes debaixo do mesmo tecto. Um é
 * uma avaria: uma linha parou, um engenheiro desloca-se, repara, a linha anda.
 * O outro é uma espera de embalagem, que o poll do iTouching abre e fecha
 * sozinho e que ninguém da manutenção toca.
 *
 * Na base a regra já está dita uma vez e bem: a policy restritiva
 * `Warehouse orders belong to the warehouse` (migração `20260920090000`) só
 * deixa `warehouse` e `admin` verem uma ordem de armazém. O que a RLS não pode
 * fazer é distinguir ECRÃS — e o admin, que está isento porque precisa de ler a
 * matriz do armazém, via as ordens de armazém dentro de "Maintenance Orders" e
 * contadas nos KPIs de manutenção. Uma única conta, mas é a que assina os
 * relatórios.
 *
 * Por isso a regra vive também aqui, escrita uma vez para o código a poder
 * dizer o mesmo que a base.
 */

/** O `wo_type` que o poll carimba na ordem que abre por espera do armazém. */
export const WAREHOUSE_WO_TYPE = "warehouse_service";

/**
 * `wo_type` é `NOT NULL DEFAULT 'production'` na base, mas os tipos gerados
 * deixam-no opcional e há chamadores a passar linhas parciais. O `??` é para
 * eles, não para a coluna.
 */
export function isWarehouseWo(wo: { wo_type?: string | null } | null | undefined): boolean {
  return (wo?.wo_type ?? "production") === WAREHOUSE_WO_TYPE;
}

/** As ordens que são mesmo de manutenção. */
export function maintenanceOnly<T extends { wo_type?: string | null }>(
  wos: readonly T[] | null | undefined,
): T[] {
  return (wos ?? []).filter((w) => !isWarehouseWo(w));
}
