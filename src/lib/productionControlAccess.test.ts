import { describe, it, expect } from "vitest";
import { canAdjustProductionControl } from "@/lib/productionControlAccess";

/**
 * Quem pode corrigir o que se escreveu na Production Control.
 *
 * O caso que trouxe este ficheiro: um SKU trocado pelo líder ficou escrito e o
 * escritório de produção não tinha como o corrigir — a célula do SKU era o único
 * campo da grelha fechado a ele, com a quantidade, o lote, as horas e o apagar da
 * linha todos abertos ao lado. A saída passou a ser apagar a linha inteira e
 * escrevê-la outra vez, e isso está nos audit_logs 53 vezes.
 */
describe("who may adjust Production Control", () => {
  it("lets the production office admin correct what the line wrote", () => {
    // É a razão de ser do papel, e a base já o diz: a policy `office_admin all`
    // dá-lhe ALL em production_items e production_sessions. Só o ecrã discordava.
    expect(canAdjustProductionControl("production_office_admin")).toBe(true);
  });

  it("keeps the roles that already had it", () => {
    for (const role of ["admin", "manager", "maintenance_manager", "supervisor"] as const) {
      expect(canAdjustProductionControl(role)).toBe(true);
    }
  });

  it("does not open it to whoever merely reads the screen", () => {
    // O operador escreve a sua linha pelo Line Production e a RLS prende-o a ela;
    // o engenheiro nem sequer entra na rota.
    for (const role of ["operator", "engineer", "co_engineer", "quality_supervisor", "warehouse"] as const) {
      expect(canAdjustProductionControl(role)).toBe(false);
    }
  });

  it("treats a session with no role yet as read-only", () => {
    expect(canAdjustProductionControl(null)).toBe(false);
    expect(canAdjustProductionControl(undefined)).toBe(false);
  });
});
