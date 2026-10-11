import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `auth.identities.email` não se escreve, e uma função tentava.
 *
 * No GoTrue de hoje essa coluna é GERADA a partir de `identity_data->>'email'`. Uma
 * instrução que lhe atribua um valor é recusada inteira:
 *
 *     column "email" can only be updated to DEFAULT        (SQLSTATE 428C9)
 *
 * O `admin_update_auth_email` fazia-o desde 12/07/2026 e ninguém soube, porque até
 * 11/10/2026 a função não tinha UM ÚNICO CHAMADOR. Sondei-a nessa noite, vi
 * `401 42501`, concluí "existe" — e construí um botão em cima dela. Existir não é
 * funcionar. O 401 prova que o nome resolve e que a guarda recusa quem não tem sessão;
 * não diz nada sobre o corpo, que nunca tinha corrido.
 *
 * Pior do que falhar: o `update auth.users` que confirma o endereço vem antes, na
 * mesma transacção, por isso a recusa desfazia também a confirmação. O Approve falhava
 * por inteiro e a pessoa continuava de fora.
 *
 * Este teste lê a ÚLTIMA definição da função nas migrações — é a que vale, porque um
 * `create or replace` posterior substitui as anteriores — e exige que a escrita da
 * coluna, se existir, esteja atrás da pergunta ao catálogo.
 */

const MIGRATIONS = resolve(__dirname, "../..", "supabase/migrations");

/** A última definição de uma função, pela ordem dos carimbos de data. */
function ultimaDefinicao(nome: string): { ficheiro: string; corpo: string } {
  const abre = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nome}\\s*\\(`, "i");
  let achado: { ficheiro: string; corpo: string } | null = null;
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve(MIGRATIONS, f), "utf8");
    const m = sql.match(abre);
    if (!m) continue;
    const desde = sql.slice(m.index ?? 0);
    const fim = desde.search(/^\s*\$\$\s*;/m);
    achado = { ficheiro: f, corpo: fim > 0 ? desde.slice(0, fim) : desde };
  }
  if (!achado) throw new Error(`nenhuma definição de ${nome} nas migrações`);
  return achado;
}

describe("admin_update_auth_email", () => {
  const { corpo } = ultimaDefinicao("admin_update_auth_email");

  /**
   * Só a instrução que toca em `auth.identities`, e só a ESTÁTICA.
   *
   * O `update auth.users` escreve `email = normalized` e está certo — essa é uma
   * coluna a sério. E o `execute '...'` escreve a outra de propósito, atrás da
   * pergunta ao catálogo; por isso os literais são removidos antes de procurar,
   * que é o que distingue uma instrução de um texto que a descreve.
   */
  it("não atribui a coluna gerada numa instrução estática", () => {
    const semLiterais = corpo.replace(/'(?:''|[^'])*'/g, "''");
    const estaticos = [...semLiterais.matchAll(/update\s+auth\.identities\b([\s\S]*?);/gi)]
      .map((m) => m[1]);
    expect(estaticos.length, "o update ao identities desapareceu").toBeGreaterThan(0);
    for (const instrucao of estaticos) {
      expect(instrucao, "atribuição estática a auth.identities.email").not.toMatch(/\bemail\s*=/i);
    }
  });

  it("escreve a coluna só depois de perguntar ao catálogo se é escrevível", () => {
    expect(corpo).toContain("attgenerated");
    // `execute` e não instrução estática: uma estática seria planeada mesmo no ramo
    // que não corre, e voltava a ser recusada.
    expect(corpo).toMatch(/execute\s+'update auth\.identities set email/i);
  });

  it("continua a confirmar o endereço e a exigir admin ou manager", () => {
    expect(corpo).toMatch(/email_confirmed_at\s*=\s*coalesce\(email_confirmed_at,\s*now\(\)\)/i);
    expect(corpo).toMatch(/has_role\(auth\.uid\(\),\s*'admin'\)/i);
  });

  it("continua a pôr o endereço no identity_data, que é o que o GoTrue lê", () => {
    expect(corpo).toMatch(/identity_data\s*=\s*coalesce\(identity_data/i);
  });
});
