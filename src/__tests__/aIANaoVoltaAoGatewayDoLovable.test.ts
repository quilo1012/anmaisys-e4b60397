import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * A 06/10/2026 três funções de IA saíram do gateway do Lovable para a API da Anthropic.
 * Este ficheiro existe para que não voltem lá sem que alguém o decida.
 *
 * O QUE TORNA ISTO FRÁGIL, e a razão de não bastar o commit: **a forma do pedido é
 * outra**, e as diferenças são todas invisíveis até correr. No gateway o `system` era
 * uma mensagem com `role: "system"`; na Anthropic é campo de topo. O `max_tokens` era
 * opcional; aqui é obrigatório e o pedido é recusado sem ele. A resposta saía de
 * `choices[0].message.content`; aqui vem em `content[]`, blocos tipados. A imagem ia
 * como `data:` URL inteira; aqui quer `media_type` e base64 separados.
 *
 * Quem copiar um exemplo da OpenAI para aqui — e a maior parte dos exemplos no mundo é
 * da OpenAI — escreve as quatro coisas pelo formato antigo e o código parece bem numa
 * revisão. Daí o teste verificar os cabeçalhos e o `max_tokens` e não só o domínio.
 *
 * A `transcribe-audio` fica de fora, e é uma decisão, não um esquecimento: **a API da
 * Anthropic não aceita áudio** — só texto, imagem e documentos — e a função manda
 * `input_audio`, que é multimodal do Gemini. Migrá-la exige Whisper (conta e segredo
 * novos, função reescrita) ou Gemini directo. Decidido a 06/10 deixar como está.
 *
 * CONSEQUÊNCIA QUE ESTE TESTE NÃO CONSEGUE GUARDAR, e por isso fica escrita aqui: a
 * `LOVABLE_API_KEY` **não pode ser removida**. Além da `transcribe-audio`, a
 * `sharepoint-download-file` usa a mesma chave contra o `connector-gateway.lovable.dev`,
 * que não é IA — é o túnel para o Microsoft Graph, e sem ela caem também o
 * `rag-sharepoint-sync` e o `headcount-sharepoint`. Os segredos não estão no
 * repositório, logo nenhum teste os vê. Ver `claude/migracao-ia-para-claude-aplicada-2026-10-03.md`.
 *
 * Se um dia a `transcribe-audio` migrar, este ficheiro falha e pede que a lista abaixo
 * seja actualizada — que é exactamente o momento em que alguém deve pensar no assunto.
 */

const FUNCTIONS_DIR = resolve(__dirname, "../..", "supabase/functions");

/** O gateway de IA do Lovable, em qualquer das formas por que aparece no código. */
const GATEWAY_DE_IA = [
  /ai\.gateway\.lovable\.dev/,
  /["']Lovable-API-Key["']/,
  /X-Lovable-AIG-SDK/,
];

/**
 * As únicas funções a que o gateway de IA ainda é permitido.
 *
 * Tirar um nome daqui é migrá-lo. Acrescentar um é uma decisão que merece ser discutida
 * no PR — não um efeito lateral de copiar outra função.
 */
const PODEM_USAR_O_GATEWAY = ["transcribe-audio"];

/** As que já falam com a Anthropic e não devem regredir. */
const FALAM_COM_A_ANTHROPIC = [
  "translate-message",
  "identify-part",
  "analyze-sku-performance",
];

function funcoes(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .filter((nome) => existsSync(join(FUNCTIONS_DIR, nome, "index.ts")))
    .sort();
}

function fonte(nome: string): string {
  return readFileSync(join(FUNCTIONS_DIR, nome, "index.ts"), "utf8");
}

describe("a IA não volta ao gateway do Lovable", () => {
  it("só a transcribe-audio continua a chamar o gateway de IA", () => {
    const noGateway = funcoes().filter((nome) => {
      const src = fonte(nome);
      return GATEWAY_DE_IA.some((p) => p.test(src));
    });

    expect(noGateway.sort()).toEqual([...PODEM_USAR_O_GATEWAY].sort());
  });

  it("as três migradas falam com a Anthropic, e com a forma certa de pedido", () => {
    for (const nome of FALAM_COM_A_ANTHROPIC) {
      const src = fonte(nome);

      expect(src, `${nome} deixou de chamar api.anthropic.com`).toMatch(
        /https:\/\/api\.anthropic\.com\/v1\/messages/,
      );
      expect(src, `${nome} sem o cabeçalho x-api-key`).toMatch(/["']x-api-key["']/);
      // Obrigatório na API da Anthropic, e o primeiro a cair num copy-paste da OpenAI.
      expect(src, `${nome} sem o cabeçalho anthropic-version`).toMatch(
        /["']anthropic-version["']/,
      );
      // Também obrigatório: sem ele o pedido é recusado, e só em execução.
      expect(src, `${nome} sem max_tokens`).toMatch(/max_tokens\s*:/);
      // O system é campo de topo, não uma mensagem com role "system".
      expect(src, `${nome} manda o system como mensagem, à maneira da OpenAI`).not.toMatch(
        /role\s*:\s*["']system["']/,
      );
      // A resposta vem em content[], não em choices[].
      expect(src, `${nome} lê a resposta à maneira da OpenAI`).not.toMatch(
        /choices\s*(\?\.)?\s*\[\s*0\s*\]/,
      );
    }
  });

  it("nenhuma das três guarda ainda a chave do Lovable", () => {
    for (const nome of FALAM_COM_A_ANTHROPIC) {
      expect(fonte(nome), `${nome} ainda lê LOVABLE_API_KEY`).not.toMatch(
        /LOVABLE_API_KEY/,
      );
    }
  });
});
