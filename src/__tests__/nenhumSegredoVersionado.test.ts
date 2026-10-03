import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Nenhum ficheiro de ambiente versionado pode conter um segredo.
 *
 * `quilo1012/anmaisys-e4b60397` é um repositório **público**. A 03/10/2026 tinha
 * quatro ficheiros `.env` versionados, e um deles — `.env.production` — carrega um
 * `VITE_PAYMENTS_CLIENT_TOKEN` com prefixo `live_`.
 *
 * O `.gitignore` lista `.env`, `.env.local` e `.env.*.local`, e não serve para nada
 * aqui: não destrackeia o que já foi commitado, e `.env.production` nem sequer
 * corresponde a esses padrões.
 *
 * DUAS COISAS QUE NÃO SÃO SEGREDOS, e por isso são permitidas:
 *
 * - `.env.example` não tem valores.
 * - `.env` tem o `VITE_SUPABASE_PUBLISHABLE_KEY`, que é a chave `anon` e **é feita
 *   para ser pública** — vai no pacote do browser de qualquer maneira, pelo prefixo
 *   `VITE_`. O que a protege é a RLS, e a produção tem RLS em todas as 128 tabelas,
 *   com 407 políticas. Tirá-la daqui partia o arranque local sem ganhar nada.
 *
 * O que este teste procura é o que não cabe nessa categoria: valores com cara de
 * credencial viva.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Excepção datada, não permanente.
 *
 * **Está vazia, e é assim que deve ficar.** Teve `.env.production` enquanto lá esteve
 * um token de pagamentos `live_`; foi removido do repositório a 03/10 e a excepção saiu
 * com ele.
 *
 * O teste abaixo recusa um nome que já não corresponda a nenhum ficheiro versionado —
 * sem isso uma excepção fica aqui a dar cobertura a um ficheiro que voltou, e foi
 * exactamente o que quase aconteceu: assim que o `.env.production` deixou de ser
 * versionado, nenhum caso de teste passou a ser gerado para ele e a excepção ficou
 * morta sem ninguém reparar. Uma lista de excepções que não se limpa sozinha é a
 * próxima falha a dormir.
 *
 * ESTA LISTA É A TAREFA. Quando o token estiver rodado e os ficheiros removidos,
 * apaga-se esta constante e o teste passa a ser absoluto. Está aqui em vez de o teste
 * ficar vermelho porque uma suite vermelha partilhada por várias pessoas deixa de ser
 * lida ao terceiro dia — e isto não se resolve em minutos, resolve-se no painel do
 * fornecedor de pagamentos.
 */
const POR_RODAR = new Set<string>([]);

/** Sem valores, ou com valores que são claramente exemplos. */
const SEM_SEGREDOS = new Set([".env.example"]);

/** A chave anon do Supabase mora aqui e é pública por desenho. */
const PUBLICO_POR_DESENHO = new Set([".env"]);

function ficheirosDeAmbienteVersionados(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return out.split("\0").filter((p) => /(^|\/)\.env($|\.)/.test(p));
}

/**
 * Procura a forma de uma credencial, não o nome da variável.
 *
 * Um nome pode mentir (`VITE_PAYMENTS_CLIENT_TOKEN` soa inofensivo e tem um `live_`
 * lá dentro); um valor longo a seguir a `live_`, `sk_`, `secret` ou um JWT, não.
 */
const PARECE_SEGREDO = [
  /=\s*"?(live|sk|rk|ghp|gho|xox[baprs])[_-][A-Za-z0-9_-]{8,}/i,
  /=\s*"?eyJ[A-Za-z0-9_-]{20,}\./,            // JWT
  /(SECRET|PRIVATE_KEY|SERVICE_ROLE)\s*=\s*"?\S{8,}/i,
];

function temSegredo(rel: string): boolean {
  const p = resolve(root, rel);
  if (!existsSync(p)) return false;
  const corpo = readFileSync(p, "utf8");
  // A chave anon é um JWT e é permitida onde mora; não a contamos como segredo aí.
  const linhas = corpo.split("\n").filter((l) => {
    if (PUBLICO_POR_DESENHO.has(rel) && /SUPABASE_PUBLISHABLE_KEY|SUPABASE_ANON/i.test(l)) return false;
    return true;
  });
  return linhas.some((l) => PARECE_SEGREDO.some((re) => re.test(l)));
}

describe("ficheiros de ambiente num repositório público", () => {
  const versionados = ficheirosDeAmbienteVersionados();

  it("nao guarda excepcoes mortas", () => {
    // Uma excepcao so se justifica enquanto o ficheiro que ela cobre existir. Quando o
    // ficheiro sai, nenhum caso e gerado para ele e a excepcao deixaria de ser vista.
    const bases = new Set(versionados.map((p) => p.split("/").pop()!));
    const mortas = [...POR_RODAR].filter((n) => !bases.has(n));
    expect(
      mortas,
      `Estas excepcoes ja nao cobrem nada e devem sair de POR_RODAR: ${mortas.join(", ")}.`,
    ).toEqual([]);
  });

  it("encontra ficheiros de ambiente para verificar", () => {
    // Sem isto, um `git ls-files` que falhe faz o resto passar sem ter visto nada.
    expect(versionados.length).toBeGreaterThan(0);
  });

  for (const rel of versionados) {
    const base = rel.split("/").pop()!;
    const esperaSegredo = POR_RODAR.has(base);

    it(
      esperaSegredo
        ? `${rel} ainda tem um segredo por rodar — remover de POR_RODAR quando estiver feito`
        : `${rel} não tem segredos`,
      () => {
        const tem = temSegredo(rel);
        if (esperaSegredo) {
          // Falha quando o segredo DESAPARECER: aí a excepção já não se justifica e
          // ficar lá a coberto é como o problema volta.
          expect(
            tem,
            `${rel} já não tem segredo. Apaga "${base}" de POR_RODAR neste ficheiro.`,
          ).toBe(true);
          return;
        }
        if (SEM_SEGREDOS.has(base) || PUBLICO_POR_DESENHO.has(base)) {
          expect(tem, `${rel} é permitido mas ganhou um valor com cara de credencial.`).toBe(false);
          return;
        }
        expect(
          tem,
          `${rel} está versionado num repositório público e tem um valor com cara de credencial. ` +
            "Rodar primeiro, remover depois — pela ordem inversa apaga-se a prova e mantém-se o risco.",
        ).toBe(false);
      },
    );
  }
});
