/**
 * Pergunta à produção o que as migrações por aplicar prometeram.
 *
 * NÃO corre por omissão. Faz pedidos de rede, e um teste que falha porque a wifi caiu
 * é um teste que as pessoas aprendem a ignorar. Corre-se à mão, quando se quer saber:
 *
 *     PROBE_PRODUCTION=1 npx vitest run src/__tests__/mergedIsNotApplied.probe.test.ts
 *
 * Só leitura. Usa a `VITE_SUPABASE_PUBLISHABLE_KEY` do `.env` — a mesma que vai no
 * JavaScript servido a toda a gente — e nunca a imprime. Não escreve nada, e não lê
 * conteúdo de linha nenhuma: olha para o código de estado e para o código de erro.
 *
 * PORQUE EXISTE. Nada neste repositório aplica uma migração; uma pessoa cola-as. Um
 * merge parece um deploy e não é, e a diferença é invisível — o CI fica verde, o
 * ficheiro está no main, e a base nunca ouviu falar dele. Uma ponte esteve assim
 * quatro dias, um papel foi oferecido por um ecrã e recusado por um enum, e uma
 * correcção de segurança ficou revista e mergeada enquanto a exposição que fecha
 * respondia 200 a chamadas anónimas.
 *
 * Isto não impede nada disso. Torna-o visível em dez segundos, que é o que faltava.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { probesFor, probePath, MISSING_CODE, type Probe, probeBody } from "@/lib/migrationProbes";

const root = resolve(__dirname, "../..");

/** A última migração cuja aplicação está comprovada. Subir quando se colar. */
const APLICADA_ATE = "20261007090000";

/**
 * Por onde se pergunta por um valor de enum. Declarado, porque um enum não é
 * alcançável sozinho: é preciso uma tabela que o carregue.
 */
const ENUM_VIA: Record<string, { table: string; column: string }> = {
  app_role: { table: "user_roles", column: "role" },
};

function env(): { url: string; key: string } | null {
  const f = resolve(root, ".env");
  if (!existsSync(f)) return null;
  const txt = readFileSync(f, "utf8");
  const get = (k: string) => txt.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"))?.[1] ?? "";
  const url = get("VITE_SUPABASE_URL"), key = get("VITE_SUPABASE_PUBLISHABLE_KEY");
  return url && key ? { url, key } : null;
}

const ligado = process.env.PROBE_PRODUCTION === "1";

describe.skipIf(!ligado)("o que o main promete e a base não tem", () => {
  it("lista as promessas por cumprir", async () => {
    const e = env();
    expect(e, "sem .env — correr a partir da raiz do repositório").not.toBeNull();
    const { url, key } = e!;

    const dir = resolve(root, "supabase/migrations");
    const pendentes = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && f.split("_")[0] > APLICADA_ATE)
      .sort();

    const todas: Probe[] = pendentes.flatMap((f) => probesFor(readFileSync(resolve(dir, f), "utf8"), f));
    const faltam: string[] = [];

    for (const p of todas) {
      const path = probePath(p, ENUM_VIA);
      if (!path) { console.log(`  ?  ${p.kind} ${p.name} — sem forma declarada de perguntar`); continue; }
      const isRpc = p.kind === "function";
      const res = await fetch(`${url}/rest/v1/${path}`, {
        method: isRpc ? "POST" : "GET",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        ...(isRpc ? { body: JSON.stringify(probeBody(p)) } : {}),
      });
      let code = "";
      try { code = ((await res.json()) as { code?: string }).code ?? ""; } catch { /* sem corpo */ }
      const ausente = code === MISSING_CODE[p.kind];
      const rotulo = `${p.kind} ${p.name}${p.detail ? "." + p.detail : ""}`;
      console.log(`  ${ausente ? "FALTA " : "existe"}  ${rotulo.padEnd(46)} ${res.status} ${code}  ${p.migration}`);
      if (ausente) faltam.push(`${rotulo}  (${p.migration})`);
    }

    console.log(`\n  ${faltam.length} de ${todas.length} promessas por cumprir na base.`);
    // Relato, não veredicto: durante a espera pela colagem o estado normal é "faltam",
    // e um teste que falhasse aqui seria desligado no dia seguinte.
    expect(Array.isArray(faltam)).toBe(true);
  }, 120_000);
});
