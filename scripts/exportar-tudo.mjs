#!/usr/bin/env node
/**
 * Exporta tudo o que a app consegue ler da base de produção: as 132 tabelas, as 18
 * vistas e os ficheiros dos 5 buckets de storage.
 *
 * PORQUE EXISTE
 * -------------
 * A base de produção é o Lovable Cloud. A documentação do Lovable diz que, sem
 * créditos, "those services pause shortly after you run out of credits" e que
 * "you cannot access or export it until the services run again". Enquanto
 * estiverem a responder, há uma janela — e este script existe para a aproveitar
 * sem depender do MCP do Lovable, que no plano gratuito tem limite de acções.
 *
 * Não usa nada do Lovable. Usa a API da própria app: a mesma URL e a mesma chave
 * publicável que o browser usa, mais a sua sessão de administrador. São os seus
 * dados, lidos pela porta da frente.
 *
 * O QUE ESTE SCRIPT **NÃO** CONSEGUE TIRAR
 * ----------------------------------------
 * As palavras-passe. O schema `auth` não é exposto pela API REST, logo as hashes
 * de `auth.users` não saem por aqui — só por um `pg_dump` com a string de ligação
 * Postgres, que só o Lovable pode dar. Sem isso, as contas têm de ser recriadas
 * na base nova.
 *
 * Os PINs de chefe de linha e de admin, esses, vivem em tabelas de `public`
 * (`leader_pins`, e afins) e **saem** nesta exportação.
 *
 * O QUE SAI É O QUE O SEU UTILIZADOR PODE VER
 * -------------------------------------------
 * Tudo passa por RLS. Uma tabela que a sua conta não possa ler sai vazia, e isso
 * fica escrito no manifesto como `rls_ou_vazia`. Corra com a conta de maior
 * privilégio que tiver, e confira o manifesto no fim — não presuma.
 *
 * COMO CORRER
 * -----------
 *   export PM_EMAIL='voce@appliednutrition.com'
 *   export PM_PASSWORD='...'
 *   node scripts/exportar-tudo.mjs
 *
 * A URL e a chave publicável saem do `.env` do repositório; para outra base,
 * defina PM_URL e PM_ANON_KEY.
 *
 * Escreve para `export-YYYY-MM-DD/`:
 *   tabelas/<nome>.ndjson     uma linha JSON por registo
 *   ficheiros/<bucket>/...    os ficheiros, com o caminho original
 *   MANIFESTO.json            contagens, e o que falhou
 *
 * É seguro repetir: reescreve a pasta do dia. Só lê — nunca escreve na base.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync, createWriteStream, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");
const PAGINA = 1000; // o limite por omissão do PostgREST, e a razão de isto paginar

/** As tabelas e vistas que a app conhece, de src/integrations/supabase/types.ts.
 *  Para regenerar: ver REGENERAR-LISTAS no fim deste ficheiro. */
const LISTAS = join(RAIZ, "scripts", "exportar-tudo.listas.json");

function env(nome, alternativa) {
  return process.env[nome] ?? alternativa;
}

/** Lê VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY do .env do repositório. */
function doEnvDoRepo(chave) {
  const caminho = join(RAIZ, ".env");
  if (!existsSync(caminho)) return undefined;
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(linha);
    if (m && m[1] === chave) return m[2].trim();
  }
  return undefined;
}

/**
 * Lê a configuração e aborta com uma mensagem útil se faltar alguma coisa.
 *
 * Vive numa função, e não no topo do ficheiro, para que o teste possa importar as
 * funções sem que o script se ponha a correr e a chamar process.exit.
 */
function configuracao() {
  const url = env("PM_URL", doEnvDoRepo("VITE_SUPABASE_URL"));
  const anon = env("PM_ANON_KEY", doEnvDoRepo("VITE_SUPABASE_PUBLISHABLE_KEY"));
  const email = env("PM_EMAIL");
  const password = env("PM_PASSWORD");

  if (!url || !anon) {
    console.error("Falta a URL ou a chave. Defina PM_URL e PM_ANON_KEY, ou corra a partir do repositório com .env.");
    process.exit(1);
  }
  if (!email || !password) {
    console.error("Defina PM_EMAIL e PM_PASSWORD com a conta de maior privilégio que tiver.");
    process.exit(1);
  }
  return { url, anon, email, password };
}

/**
 * Uma tabela de cada vez, às páginas, com a contagem exacta para conferir no fim.
 *
 * `sb` e `destinoDir` entram por parâmetro para isto poder ser testado sem rede —
 * ver `src/__tests__/aExportacaoNaoParaNaPrimeiraPagina.test.ts`. A leitura
 * truncada às 1000 linhas já aconteceu neste projecto, e é o que esta paginação
 * e a conferência de contagem no fim existem para impedir.
 */
export async function exportarTabela(sb, nome, destinoDir) {
  const destino = join(destinoDir, "tabelas", `${nome}.ndjson`);
  mkdirSync(dirname(destino), { recursive: true });

  const { count, error: erroContagem } = await sb
    .from(nome)
    .select("*", { count: "exact", head: true });

  if (erroContagem) return { nome, estado: "erro", detalhe: erroContagem.message, linhas: 0 };

  const fluxo = createWriteStream(destino, { flags: "w" });
  let escritas = 0;
  let ordenavel = true;

  for (let inicio = 0; ; inicio += PAGINA) {
    // Sem ordem estável, duas páginas podem repetir ou saltar registos. Quase todas
    // as tabelas têm `id`; as que não têm ficam marcadas e devem ser conferidas.
    let q = sb.from(nome).select("*").range(inicio, inicio + PAGINA - 1);
    if (ordenavel) q = q.order("id", { ascending: true });

    let { data, error } = await q;

    if (error && ordenavel) {
      ordenavel = false; // provavelmente não tem coluna `id`
      ({ data, error } = await sb.from(nome).select("*").range(inicio, inicio + PAGINA - 1));
    }
    if (error) {
      fluxo.end();
      return { nome, estado: "erro", detalhe: error.message, linhas: escritas };
    }
    if (!data?.length) break;

    for (const linha of data) {
      fluxo.write(JSON.stringify(linha) + "\n");
      escritas++;
    }
    if (data.length < PAGINA) break;
  }

  await new Promise((r) => fluxo.end(r));

  // A verificação que importa: o que saiu bate com o que a base diz ter?
  const esperado = count ?? 0;
  let estado = "ok";
  if (escritas === 0 && esperado === 0) estado = "rls_ou_vazia";
  else if (escritas !== esperado) estado = "INCOMPLETA";

  return { nome, estado, linhas: escritas, esperado, ordenada: ordenavel };
}

/** Percorre um bucket até ao fim, pasta a pasta, e descarrega cada ficheiro. */
export async function listarRecursivo(sb, bucket, prefixo = "") {
  const encontrados = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await sb.storage
      .from(bucket)
      .list(prefixo, { limit: PAGINA, offset: inicio });
    if (error) throw new Error(`${bucket}/${prefixo}: ${error.message}`);
    if (!data?.length) break;

    for (const entrada of data) {
      const caminho = prefixo ? `${prefixo}/${entrada.name}` : entrada.name;
      // Sem `id` é pasta; o Supabase devolve as duas coisas na mesma lista.
      if (entrada.id === null || entrada.id === undefined) {
        encontrados.push(...(await listarRecursivo(sb, bucket, caminho)));
      } else {
        encontrados.push(caminho);
      }
    }
    if (data.length < PAGINA) break;
  }
  return encontrados;
}

async function exportarBucket(sb, bucket, destinoDir) {
  let caminhos;
  try {
    caminhos = await listarRecursivo(sb, bucket);
  } catch (e) {
    return { bucket, estado: "erro", detalhe: e.message, ficheiros: 0 };
  }

  let guardados = 0;
  const falhados = [];
  for (const caminho of caminhos) {
    const { data, error } = await sb.storage.from(bucket).download(caminho);
    if (error || !data) {
      falhados.push({ caminho, detalhe: error?.message ?? "sem corpo" });
      continue;
    }
    const destino = join(destinoDir, "ficheiros", bucket, caminho);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, Buffer.from(await data.arrayBuffer()));
    guardados++;
  }

  return {
    bucket,
    estado: falhados.length ? "parcial" : "ok",
    ficheiros: guardados,
    listados: caminhos.length,
    falhados,
  };
}

async function main() {
  const { tabelas, vistas, buckets } = JSON.parse(readFileSync(LISTAS, "utf8"));
  const { url: URL, anon: ANON, email: EMAIL, password: PASSWORD } = configuracao();

  const DESTINO = join(RAIZ, `export-${new Date().toISOString().slice(0, 10)}`);
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });

  console.log(`Base:    ${URL}`);
  console.log(`Destino: ${DESTINO}`);
  console.log(`A entrar como ${EMAIL} ...`);

  const { error: erroLogin } = await sb.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (erroLogin) {
    console.error(`\nNão foi possível entrar: ${erroLogin.message}`);
    console.error("Se disser que o serviço está indisponível, a base pode já estar pausada por falta de créditos.");
    process.exit(1);
  }
  console.log("Dentro.\n");

  mkdirSync(DESTINO, { recursive: true });
  const manifesto = { base: URL, quando: new Date().toISOString(), tabelas: [], vistas: [], buckets: [] };

  const alvos = [...tabelas.map((t) => ["tabelas", t]), ...vistas.map((v) => ["vistas", v])];
  for (const [grupo, nome] of alvos) {
    const r = await exportarTabela(sb, nome, DESTINO);
    manifesto[grupo].push(r);
    const marca = r.estado === "ok" ? "·" : r.estado === "rls_ou_vazia" ? " " : "!";
    console.log(`${marca} ${nome.padEnd(42)} ${String(r.linhas).padStart(7)}  ${r.estado}`);
  }

  console.log("");
  for (const b of buckets) {
    const r = await exportarBucket(sb, b, DESTINO);
    manifesto.buckets.push(r);
    console.log(`${r.estado === "ok" ? "·" : "!"} ${b.padEnd(42)} ${String(r.ficheiros).padStart(7)} ficheiros  ${r.estado}`);
  }

  writeFileSync(join(DESTINO, "MANIFESTO.json"), JSON.stringify(manifesto, null, 2));

  const maus = [...manifesto.tabelas, ...manifesto.vistas].filter(
    (r) => r.estado === "erro" || r.estado === "INCOMPLETA",
  );
  const linhas = [...manifesto.tabelas, ...manifesto.vistas].reduce((s, r) => s + r.linhas, 0);
  const ficheiros = manifesto.buckets.reduce((s, r) => s + r.ficheiros, 0);

  console.log(`\n${linhas} registos e ${ficheiros} ficheiros em ${DESTINO}`);
  if (maus.length) {
    console.log(`\n${maus.length} com problema — ver MANIFESTO.json:`);
    for (const r of maus) console.log(`  ${r.estado}  ${r.nome}  ${r.detalhe ?? `${r.linhas} de ${r.esperado}`}`);
    process.exitCode = 1;
  } else {
    console.log("Nada falhou. Confira na mesma as marcadas rls_ou_vazia no manifesto.");
  }
}

// Só corre quando é invocado directamente. Importado por um teste, não faz nada.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

/*
 * REGENERAR-LISTAS
 * ----------------
 * As listas vêm de src/integrations/supabase/types.ts, que é gerado. Se o schema
 * mudar, reconstrua exportar-tudo.listas.json com os blocos `Tables` e `Views`
 * desse ficheiro, mais os buckets criados em supabase/migrations.
 */
