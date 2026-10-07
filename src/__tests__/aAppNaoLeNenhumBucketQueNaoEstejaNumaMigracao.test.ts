import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Todo o bucket de storage que a app lê tem de ser criado por uma migração.
 *
 * Irmão do `aAppNaoLeNadaQueNaoEstejaNumaMigracao`, que guarda vistas e funções.
 * Esta classe de falha tinha escapado pelo lado do storage, e a 06/10/2026 havia
 * **dois** buckets nessa situação ao mesmo tempo:
 *
 *   `part-photos`     políticas desde 26/08, revistas a 08/09 e a 18/09
 *   `technical-docs`  políticas desde 21/09
 *
 * Em ambos o repositório tinha as **regras** sobre o bucket e não o bucket. Existiam
 * em produção porque alguém os criou à mão no painel, e por isso nada falhava onde
 * alguém estivesse a olhar. Numa base nova — uma branch de preview, um ambiente novo,
 * um `supabase db reset`, ou a migração para fora do Lovable — as políticas aplicam-se
 * a um bucket que não está lá e o `storage.from(...)` responde "Bucket not found": a
 * fotografia de peças no Stock e o repositório técnico de manuais de máquina.
 *
 * Confirmado no destino da migração `ammlyqnjlhioukpgldgc`, que tinha quatro buckets e
 * **não** tinha o `technical-docs` — exactamente o cenário que este teste descreve, já
 * a acontecer numa base real.
 *
 * Lê o código em vez de ter uma lista à mão, pela mesma razão que o irmão: uma lista a
 * actualizar à mão é a terceira cópia do mesmo facto, e é o que estes ficheiros existem
 * para impedir.
 */

const root = resolve(__dirname, "..", "..");
const SRC = resolve(root, "src");
const FUNCTIONS = resolve(root, "supabase/functions");
const MIGRATIONS = resolve(root, "supabase/migrations");

/**
 * As duas formas por que um bucket é nomeado neste projecto.
 *
 * A segunda existe porque `usePartPhotos.ts` guarda o nome numa constante e chama
 * `from(BUCKET)` — um teste que só procurasse a primeira dava-o por inexistente e
 * passava sem o ver, que é o pior resultado possível aqui.
 */
const NO_CODIGO = [
  /storage\s*\.\s*from\(\s*["'`]([a-z0-9-]+)["'`]/g,
  /\bBUCKET\s*=\s*["'`]([a-z0-9-]+)["'`]/g,
];

/** Só o INSERT conta. Uma política que menciona o bucket não o cria. */
const INSERT_EM_BUCKETS = /insert\s+into\s+storage\.buckets[\s\S]*?;/gi;

function ficheiros(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) return ficheiros(p, ext);
    return ext.test(nome) ? [p] : [];
  });
}

function bucketsUsadosPelaApp(): string[] {
  const fontes = [
    ...ficheiros(SRC, /\.tsx?$/).filter(
      (p) => !/\.test\.tsx?$/.test(p) && !/__tests__/.test(p),
    ),
    ...ficheiros(FUNCTIONS, /\.ts$/),
  ];

  const usados = new Set<string>();
  for (const f of fontes) {
    const src = readFileSync(f, "utf8");
    for (const padrao of NO_CODIGO) {
      for (const m of src.matchAll(padrao)) usados.add(m[1]);
    }
  }
  return [...usados].sort();
}

function bucketsCriadosPorMigracao(): string[] {
  const criados = new Set<string>();
  for (const f of ficheiros(MIGRATIONS, /\.sql$/)) {
    const sql = readFileSync(f, "utf8");
    for (const stmt of sql.match(INSERT_EM_BUCKETS) ?? []) {
      for (const m of stmt.matchAll(/'([a-z0-9-]+)'/g)) criados.add(m[1]);
    }
  }
  return [...criados].sort();
}

describe("a app não lê nenhum bucket que não esteja numa migração", () => {
  it("encontra os buckets que a app usa", () => {
    // Se isto vier vazio, os padrões deixaram de encontrar o código e o teste
    // abaixo passaria por não ter nada que verificar.
    expect(bucketsUsadosPelaApp().length).toBeGreaterThan(0);
  });

  it("cada um é criado por uma migração", () => {
    const criados = bucketsCriadosPorMigracao();
    const emFalta = bucketsUsadosPelaApp().filter((b) => !criados.includes(b));

    expect(
      emFalta,
      `Buckets que a app lê e que nenhuma migração cria: ${emFalta.join(", ")}. ` +
        `Numa base nova o storage.from() destes responde "Bucket not found". ` +
        `Criar com INSERT INTO storage.buckets ... ON CONFLICT (id) DO NOTHING — ` +
        `uma política sobre o bucket não o cria.`,
    ).toEqual([]);
  });
});
