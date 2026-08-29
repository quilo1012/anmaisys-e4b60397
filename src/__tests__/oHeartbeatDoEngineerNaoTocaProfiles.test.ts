import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * O heartbeat do engineer nao pode ir direto a `profiles`.
 *
 * `useHeartbeat` fazia `.from("profiles").update({ last_seen_at })` de 30 em 30
 * segundos e o PostgREST devolvia sempre `42501 permission denied for table profiles`
 * — seis vezes em Root Diagnostics entre 28/08 07:15 e 29/08 08:40, sempre em
 * /dashboard/engineer, sempre PATCH.
 *
 * Nao era RLS. A policy "Users can update own profile" deixa passar. O que falha e o
 * privilegio: o PostgREST escreve `UPDATE ... RETURNING profiles.*` mesmo quando o
 * cliente nao pede a linha de volta, e `authenticated` nao tem SELECT em
 * `labor_rate` — revogado de proposito desde 20260724130000, para o custo/hora de
 * cada pessoa nao viajar para o browser. Ler a linha inteira e exatamente o que a
 * revogacao proibe, por isso o PATCH nao podia funcionar de forma nenhuma.
 *
 * O Postgres sugere `GRANT SELECT ON public.profiles TO authenticated` na propria
 * HINT do erro. Seguir a sugestao devolve o labor_rate a toda a gente que a RLS
 * deixa ver a linha — os managers veem a de todos os nao-admins. A saida e nao ler
 * a linha: `touch_last_seen()` escreve so a coluna e nao devolve nada.
 */

const MIGRACOES = resolve(__dirname, "../..", "supabase/migrations");
const SQL = readdirSync(MIGRACOES)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(resolve(MIGRACOES, f), "utf8"))
  .join("\n");

/** Sem os comentarios `--`, senao um GRANT citado dentro de um vale como um GRANT feito. */
const SQL_EXECUTAVEL = SQL.replace(/--[^\n]*/g, "");

const HEARTBEAT = readFileSync(resolve(__dirname, "..", "hooks/useHeartbeat.ts"), "utf8");

describe("o heartbeat do engineer", () => {
  it("nao faz PATCH a profiles", () => {
    expect(HEARTBEAT).not.toMatch(/from\(\s*["']profiles["']\s*\)/);
  });

  it("marca o last_seen_at pela RPC", () => {
    expect(HEARTBEAT).toMatch(/rpc\(\s*["']touch_last_seen["']/);
  });

  it("tem a RPC definida numa migracao, SECURITY DEFINER e so para authenticated", () => {
    const def = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.touch_last_seen\(\)[\s\S]*?\$function\$;/,
    );
    expect(def, "nenhuma migracao define touch_last_seen()").not.toBeNull();
    expect(def![0]).toMatch(/SECURITY DEFINER/);
    // Sem argumentos: quem a chama so se pode marcar a si proprio.
    expect(def![0]).toMatch(/WHERE id = auth\.uid\(\)/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.touch_last_seen\(\) TO authenticated;/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.touch_last_seen\(\) FROM public, anon;/);
  });

  /**
   * A HINT do proprio erro pede o GRANT que devolve o labor_rate ao browser. Este
   * teste le as migracoes por ordem e exige que a ultima palavra sobre o SELECT de
   * tabela em `profiles` continue a ser um REVOKE — 20260627071614 concedeu-o e
   * 20260724130000 tirou-o; se alguem o conceder outra vez, isto parte.
   */
  it("nao devolve o SELECT de tabela em profiles ao authenticated", () => {
    const eventos = [
      ...SQL_EXECUTAVEL.matchAll(
        /(GRANT|REVOKE)\s+([A-Z, ]*?SELECT[A-Z, ]*?)\s+ON\s+(?:TABLE\s+)?public\.profiles\s+(?:TO|FROM)\s+([^;]+);/gi,
      ),
    ].filter((m) => /authenticated/.test(m[3]));
    expect(eventos.length, "nenhuma migracao fala do SELECT em profiles").toBeGreaterThan(0);
    const ultimo = eventos[eventos.length - 1];
    expect(ultimo[1].toUpperCase(), `a ultima palavra e "${ultimo[0].trim()}"`).toBe("REVOKE");
  });
});
