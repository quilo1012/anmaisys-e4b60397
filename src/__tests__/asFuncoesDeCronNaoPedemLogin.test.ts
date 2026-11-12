import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * As funções chamadas por máquinas — o pg_cron, o iTouching, a SafetyCulture, a TV do
 * wallboard — não trazem sessão. Entram com um segredo partilhado que a própria função
 * verifica. Por isso, em produção, correm com `verify_jwt = false`.
 *
 * Auditoria 11/11/2026, P0-1 / ARCH-018: em produção (apblxaaktftinstoidvp) nove funções
 * estavam publicadas com `verify_jwt = false`, mas o `supabase/config.toml` só declarava
 * duas. O `deploy-functions.yml` publica sem `--no-verify-jwt`, logo o próximo deploy
 * pelo repositório virava as outras sete para `verify_jwt = true`: o gateway passava a
 * pedir um JWT antes de a função ver o segredo, e os crons, o push e os webhooks
 * respondiam 401 sem ninguém a olhar.
 *
 * Este ficheiro prende as duas direcções:
 *  - uma função que lê o segredo de uma máquina tem de estar declarada sem JWT;
 *  - uma função declarada sem JWT tem de ler um segredo (senão fica aberta).
 */

const root = resolve(__dirname, "../..");
const FUNCTIONS_DIR = resolve(root, "supabase/functions");
const CONFIG = resolve(root, "supabase/config.toml");

/** Cabeçalhos com que uma máquina se apresenta, um por chamador. */
const SEGREDO_DE_MAQUINA =
  /(headers\.get|searchParams\.get)\(\s*["'](x-cron-secret|x-webhook-secret|x-intouch-signature|x-safetyculture-secret|x-wallboard-key|k)["']\s*\)/;

/**
 * Lê o segredo do cron mas é chamada com a chave de serviço como Bearer
 * (`smart-target-ahead` → `intouch-list-scheduled-jobs`), que passa o `verify_jwt`.
 * Em produção está com `verify_jwt = true` (list_edge_functions, 11/11/2026). Fica
 * assim; declará-la sem JWT abria-a sem necessidade.
 */
const SEGREDO_MAS_CHAMADA_COM_JWT = ["intouch-list-scheduled-jobs"];

/**
 * O que `list_edge_functions` devolveu a 11/11/2026 para apblxaaktftinstoidvp: as funções
 * do repositório publicadas com `verify_jwt = false`. (As `migr-*` não estão no repo.)
 */
const SEM_JWT_EM_PRODUCAO = [
  "calculate-shift-targets",
  "intouch-poll",
  "intouch-sync-production",
  "intouch-webhook",
  "safetyculture-sync",
  "safetyculture-webhook",
  "send-push",
  "smart-target-ahead",
  "wallboard-lines",
];

/** `[functions.<nome>]` → valor de `verify_jwt` (true se a secção não o disser). */
function verifyJwtPorFuncao(toml: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  let atual: string | null = null;
  for (const raw of toml.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      const fn = sec[1].match(/^functions\.([A-Za-z0-9_-]+)$/);
      atual = fn ? fn[1] : null;
      if (atual && !out.has(atual)) out.set(atual, true);
      continue;
    }
    const kv = line.match(/^verify_jwt\s*=\s*(true|false)$/);
    if (atual && kv) out.set(atual, kv[1] === "true");
  }
  return out;
}

function funcoes(): string[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter((d) => existsSync(join(FUNCTIONS_DIR, d, "index.ts")))
    .sort();
}

const src = (f: string) => readFileSync(join(FUNCTIONS_DIR, f, "index.ts"), "utf8");
const config = verifyJwtPorFuncao(readFileSync(CONFIG, "utf8"));
const semJwt = [...config].filter(([, v]) => v === false).map(([k]) => k).sort();

describe("as funções de cron e webhook não pedem login", () => {
  it("o teste encontra as funções e o config", () => {
    // Sem isto, apagar a pasta ou mudar o formato do toml transformava tudo num passe.
    expect(funcoes().length).toBeGreaterThan(30);
    expect(config.get("create-user")).toBe(true);
    expect(semJwt.length).toBeGreaterThan(0);
  });

  it("toda a função que lê o segredo de uma máquina está declarada verify_jwt = false", () => {
    const faltam = funcoes()
      .filter((f) => !SEGREDO_MAS_CHAMADA_COM_JWT.includes(f))
      .filter((f) => SEGREDO_DE_MAQUINA.test(src(f)))
      .filter((f) => config.get(f) !== false);
    expect(faltam).toEqual([]);
  });

  it("toda a entrada verify_jwt = false aponta para uma função que verifica um segredo", () => {
    const todas = funcoes();
    const semFuncao = semJwt.filter((f) => !todas.includes(f));
    expect(semFuncao, "entrada no config.toml sem pasta em supabase/functions").toEqual([]);
    const abertas = semJwt.filter((f) => !SEGREDO_DE_MAQUINA.test(src(f)));
    expect(abertas, "verify_jwt = false sem segredo verificado no código").toEqual([]);
  });

  it("declara exactamente o que está publicado sem JWT em produção", () => {
    expect(semJwt).toEqual([...SEM_JWT_EM_PRODUCAO].sort());
  });

  it("a excepção continua a ser chamada com JWT e a ler o segredo", () => {
    for (const f of SEGREDO_MAS_CHAMADA_COM_JWT) {
      expect(config.get(f) ?? true, `${f} não pode ser declarada sem JWT`).toBe(true);
      expect(src(f)).toMatch(SEGREDO_DE_MAQUINA);
    }
    expect(src("smart-target-ahead")).toMatch(/Authorization:\s*`Bearer \$\{SERVICE_ROLE\}`/);
  });
});
