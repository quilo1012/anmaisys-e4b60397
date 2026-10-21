import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * F-5. Complemento a `nenhumSegredoVersionado.test.ts`, que vigia APENAS os ficheiros
 * `.env*`. Um segredo vivo pode ser commitado em qualquer outro ficheiro — uma migração,
 * um .ts, um doc — e esse teste não o veria.
 *
 * Este varre TODOS os ficheiros de texto versionados, mas só com padrões de
 * ALTÍSSIMA confiança, para não gerar falsos positivos (um `live_job_state` no código
 * não é um token `live_` de pagamentos). Em concreto recusa:
 *   - um JWT que descodifique para `role: service_role` (a chave que ignora toda a RLS —
 *     o pior caso, e é por isso que é verificada pelo conteúdo, não pelo nome);
 *   - uma chave privada (`-----BEGIN ... PRIVATE KEY-----`);
 *   - uma chave live de pagamentos no formato `sk_live_…` / `rk_live_…`.
 *
 * A chave anon (JWT `role: anon`) é pública por desenho e NÃO falha aqui, onde quer que
 * apareça. O `.env` e o `.env.example` continuam a ser tratados pelo outro teste.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SKIP_EXT = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
  ".lockb", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm",
];
// Os dois testes de segredos contêm os próprios padrões como texto; não se varrem a si.
const SKIP_NAME = new Set([
  "bun.lock",
  "package-lock.json",
  "nenhumSegredoVersionado.test.ts",
  "noLiveSecretInAnyTrackedFile.test.ts",
]);

const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/;
const STRIPE_LIVE = /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g;

function trackedTextFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return out
    .split("\0")
    .filter(Boolean)
    .filter((p) => {
      const base = p.split("/").pop()!;
      if (SKIP_NAME.has(base)) return false;
      const dot = base.lastIndexOf(".");
      const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "";
      return !SKIP_EXT.includes(ext);
    });
}

function decodeJwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  b64 += "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    const m = /"role"\s*:\s*"([a-z_]+)"/.exec(json);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function liveSecretsIn(rel: string): string[] {
  let body: string;
  try {
    body = readFileSync(resolve(root, rel), "utf8");
  } catch {
    return [];
  }
  const found: string[] = [];
  if (PRIVATE_KEY.test(body)) found.push("private key");
  if (STRIPE_LIVE.test(body)) found.push("sk_live/rk_live key");
  for (const m of body.matchAll(JWT)) {
    if (decodeJwtRole(m[0]) === "service_role") {
      found.push("service_role JWT");
      break;
    }
  }
  return found;
}

describe("nenhum segredo vivo em qualquer ficheiro versionado", () => {
  const files = trackedTextFiles();

  it("encontra ficheiros para verificar", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("nenhum ficheiro versionado contém service_role, chave privada ou chave live de pagamentos", () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const hits = liveSecretsIn(rel);
      if (hits.length) offenders.push(`${rel} → ${hits.join(", ")}`);
    }
    expect(
      offenders,
      "Segredo vivo versionado. Rodar no fornecedor/painel PRIMEIRO, só depois remover do " +
        "ficheiro e do histórico (git filter-repo/BFG) — pela ordem inversa apaga-se a prova e " +
        `mantém-se o risco:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
