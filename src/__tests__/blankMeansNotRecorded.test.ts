import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/**
 * Zero é uma afirmação, e nestas três colunas era falsa em todas as linhas.
 *
 * Medido a 13/09/2026:
 *
 *   production_items.scrap_qty        943 de 943 linhas exactamente 0, nenhuma NULL
 *   production_sessions.staff_actual  493 a 0, 231 NULL, 14 acima de zero
 *
 * A tabela "Line indicators" imprimia "0.0%" de sucata e "0" de equipa em cada linha —
 * uma linha que fez 6.093 peças com zero pessoas — e o ramo "not recorded" que o
 * componente escreve contra NULL nunca chegou a correr, porque a coluna era NOT NULL
 * DEFAULT 0. Com sucata "registada" em toda a parte, a nota honesta desaparecia
 * também do rodapé da tabela.
 *
 * A correcção do efectivo já tinha sido feita uma vez, em 20260801120000, que anulou
 * os 231 zeros desse dia. O que ficou por fazer foi tirar o DEFAULT, e as 493 sessões
 * criadas desde então nasceram outra vez a zero. É esse regresso que este teste
 * existe para impedir: não basta limpar os dados, é preciso fechar a torneira.
 */
describe("blank means nobody measured it", () => {
  const migration = read(
    "supabase/migrations/20260923090000_o_zero_que_ninguem_mediu_e_o_turno_que_ninguem_escreveu.sql",
  );

  it("closes the tap as well as emptying the bucket", () => {
    // O que faltou à 20260801120000, e é por isso que o problema voltou.
    expect(migration).toMatch(/production_items[\s\S]*ALTER COLUMN scrap_qty DROP DEFAULT/);
    expect(migration).toMatch(/ALTER COLUMN scrap_qty DROP NOT NULL/);
    expect(migration).toMatch(/production_sessions[\s\S]*ALTER COLUMN staff_actual\s+DROP DEFAULT/);
    expect(migration).toMatch(/ALTER COLUMN staff_planned DROP DEFAULT/);
  });

  it("empties the bucket too, so the columns start out honest", () => {
    expect(migration).toMatch(/UPDATE public\.production_items SET scrap_qty = NULL WHERE scrap_qty = 0/);
    expect(migration).toMatch(/UPDATE public\.production_sessions SET staff_actual\s+= NULL WHERE staff_actual\s+= 0/);
  });

  it("derives a shift only for the source that carries a real instant", () => {
    expect(migration).toMatch(/SET shift = public\.factory_shift_of\(recorded_at\)/);
    expect(migration).toMatch(/AND source = 'safetyculture'/);
    // A origem 'pm' carimba 12:00 porque o formulário pede uma data. Derivar DAY daí
    // seria trocar um branco honesto por uma invenção.
    expect(migration).not.toMatch(/UPDATE public\.quality_actions[\s\S]*source = 'pm'/);
  });

  it("has no writer left that fabricates a zero", () => {
    const suspects = [
      "supabase/functions/intouch-sync-production/index.ts",
      "supabase/functions/_shared/safetyculture/sync.ts",
      "src/components/IntouchImportDialog.tsx",
      "src/pages/dashboard/ShiftHistoryPage.tsx",
      "src/pages/dashboard/ProductionPerformancePage.tsx",
    ];
    for (const f of suspects) {
      const src = read(f);
      expect(src, `${f} writes a literal zero scrap`).not.toMatch(/scrap_qty:\s*0\b/);
      expect(src, `${f} writes a literal zero headcount`).not.toMatch(/staff_(actual|planned):\s*0\b/);
    }
  });

  it("leaves no migration behind that puts the default back", () => {
    const dir = resolve(root, "supabase/migrations");
    const later = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && f.slice(0, 14) > "20260923090000")
      .map((f) => readFileSync(resolve(dir, f), "utf8"))
      .join("\n");
    expect(later).not.toMatch(/scrap_qty[\s\S]{0,80}DEFAULT 0/);
    expect(later).not.toMatch(/staff_(actual|planned)[\s\S]{0,80}DEFAULT 0/);
  });
});
