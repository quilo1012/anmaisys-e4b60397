import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * As duas páginas que descrevem permissões têm de dizer até onde elas chegam.
 *
 * A Matriz de Permissões escreve uma linha em `role_permission_overrides` e o sistema
 * lê-a para decidir que linhas de menu, botões e páginas desenha. **A base de dados não
 * a lê.** Contado contra a produção a 04/10/2026: 407 políticas RLS, 322 a resolver pelo
 * papel através de `has_role()`, e **nenhuma** a consultar os overrides como regra de
 * autorização — a única política que nomeia essa tabela é o SELECT da própria tabela,
 * que decide quem pode *ler* os overrides, não quem pode agir.
 *
 * A consequência cai na pessoa: uma permissão concedida aqui mostra um botão cuja
 * gravação a base recusa, e uma negada esconde o botão enquanto a operação continua
 * possível pela API. O texto que lá estava — *"Toggling a cell writes a database
 * override"* — é verdade à letra e lê-se como garantia.
 *
 * As Regras dos Papéis são piores nisto por imprimirem: uma folha "Regras do perfil"
 * arquivada é a resposta de alguém à pergunta "quem podia fazer o quê".
 *
 * ESTE TESTE APAGA-SE quando o Lote 1.2(a) do
 * `claude/plano-profissionalizacao-2026-10-03.md` estiver feito — a função
 * `action_allowed()` a existir e as políticas sensíveis a chamá-la. Aí o aviso deixa de
 * ser verdade e tem de sair das duas páginas. Até lá, é a única coisa que separa a
 * página de uma promessa que ela não cumpre.
 */

const raiz = resolve(__dirname, "..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

/**
 * Procura a ideia, não a frase.
 *
 * Um teste colado à redacção exacta quebra-se na primeira revisão de texto e ensina a
 * geração seguinte a apagá-lo em vez de o ler. O que não pode desaparecer é a distinção
 * entre o que se mostra e o que se permite.
 */
const DIZ_O_LIMITE = [
  /database (does not read|access is decided separately)/i,
  /não (lê|cumpre)|nao (le|cumpre)/i,
  /decidid[oa] à parte|decidid[oa] a parte/i,
  /not (a security boundary|what is allowed)/i,
];

const PAGINAS = [
  ["Matriz de Permissões", "pages/dashboard/PermissionsMatrixPage.tsx"],
  ["Regras dos Papéis", "pages/dashboard/RoleRulesPage.tsx"],
] as const;

describe("as páginas que descrevem permissões", () => {
  for (const [nome, caminho] of PAGINAS) {
    it(`${nome} diz que a matriz não é a base de dados`, () => {
      const corpo = ler(caminho);
      const diz = DIZ_O_LIMITE.some((re) => re.test(corpo));
      expect(
        diz,
        `${caminho} deixou de distinguir o que o sistema MOSTRA do que a base PERMITE. ` +
          "Se foi porque as políticas passaram a impor a matriz (Lote 1.2(a)), apaga este " +
          "teste e o aviso das duas páginas. Se não, repõe a frase: sem ela a página " +
          "promete uma fronteira que não existe.",
      ).toBe(true);
    });
  }

  it("a Matriz não volta a chamar-lhe apenas um override da base de dados", () => {
    // A frase original. Enquanto a base não impuser nada, ela diz a um leitor razoável
    // que a porta ficou fechada.
    const corpo = ler("pages/dashboard/PermissionsMatrixPage.tsx");
    const promessa = /Toggling a cell writes a database override\./;
    expect(
      promessa.test(corpo),
      "A frase antiga voltou à Matriz de Permissões. Ver o cabeçalho deste ficheiro.",
    ).toBe(false);
  });
});
