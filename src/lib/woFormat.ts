/**
 * Como se escreve a referência de uma ordem.
 *
 * Duas séries, porque são dois trabalhos. `WO-2026-001027` é uma avaria, com o
 * número que a sequência `wo_number_seq` deu. `WH-2026-000001` é uma espera de
 * embalagem, com o número da sua própria série — ver a migração
 * `20260924090000`. Antes dela as ordens de armazém tiravam senha da fila da
 * manutenção e deixaram catorze buracos na série que vai nas folhas assinadas.
 */
import { isWarehouseWo } from "@/lib/woKinds";

/**
 * Format WO number as WO-YYYY-000XXX
 *
 * A forma da manutenção. Para uma linha completa prefere-se `woReference`, que
 * sabe qual das duas séries usar; esta fica para quem só tem o número à mão.
 */
export function formatWONumber(woNumber: number, createdAt: string): string {
  const year = new Date(createdAt).getFullYear();
  return `WO-${year}-${String(woNumber).padStart(6, "0")}`;
}

export interface ReferencedWo {
  wo_number?: number | null;
  /** Só as ordens de armazém o têm. Nulo em tudo o resto. */
  warehouse_number?: number | null;
  wo_type?: string | null;
  created_at?: string | null;
}

/**
 * A referência desta ordem, na série a que ela pertence.
 *
 * Uma ordem de armazém sem `warehouse_number` cai na forma `WO-`: acontece
 * quando quem a foi buscar não pediu a coluna, e nesse caso um número da série
 * antiga é uma resposta pior do que a certa mas melhor do que `WH-2026-NaN`.
 */
export function woReference(wo: ReferencedWo | null | undefined): string {
  if (!wo || wo.wo_number == null) return "—";
  const year = wo.created_at ? new Date(wo.created_at).getFullYear() : new Date().getFullYear();
  const warehouse = isWarehouseWo(wo) && wo.warehouse_number != null;
  const prefix = warehouse ? "WH" : "WO";
  const n = warehouse ? wo.warehouse_number! : wo.wo_number;
  return `${prefix}-${year}-${String(n).padStart(6, "0")}`;
}
