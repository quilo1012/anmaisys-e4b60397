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
import { probesFor, probePath, MISSING_CODE, type Probe, probeBody, markReplacements } from "@/lib/migrationProbes";

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

    // A lista TODA, e não só as pendentes: a primeira definição de uma função pode ser
    // de meses antes da janela que esta sonda cobre, e é isso que decide se uma
    // promessa é verificável. Ver `markReplacements`.
    const historico = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
      .map((f) => ({ file: f, sql: readFileSync(resolve(dir, f), "utf8") }));

    const todas: Probe[] = markReplacements(
      pendentes.flatMap((f) => probesFor(readFileSync(resolve(dir, f), "utf8"), f)),
      historico,
    );
    const faltam: string[] = [];
    const porSaber: string[] = [];

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
      // Um corpo substituído não muda a assinatura, por isso a resposta é a mesma com
      // o corpo novo ou com o antigo. Dizer "existe" aqui era afirmar o que não se
      // sabe — e foi assim que um botão foi construído sobre uma função partida.
      const estado = ausente ? "FALTA " : p.replacesExisting ? "?     " : "existe";
      console.log(`  ${estado}  ${rotulo.padEnd(46)} ${res.status} ${code}  ${p.migration}`);
      if (ausente) faltam.push(`${rotulo}  (${p.migration})`);
      else if (p.replacesExisting) porSaber.push(`${rotulo}  (${p.migration})`);
    }

    console.log(`\n  ${faltam.length} de ${todas.length} promessas por cumprir na base.`);
    if (porSaber.length) {
      console.log(`  ${porSaber.length} que esta sonda NÃO pode verificar — só substituem um corpo:`);
      for (const q of porSaber) console.log(`    ? ${q}`);
    }
    // Relato, não veredicto: durante a espera pela colagem o estado normal é "faltam",
    // e um teste que falhasse aqui seria desligado no dia seguinte.
    expect(Array.isArray(faltam)).toBe(true);
  }, 120_000);
});
