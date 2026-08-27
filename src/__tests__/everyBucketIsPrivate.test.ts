import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Every storage bucket in this project is private, so `getPublicUrl` can only ever
 * produce a dead link.
 *
 * It does not ask the server anything — it builds an `/object/public/...` string on the
 * client and hands it back. Against a private bucket that string is well-formed, looks
 * correct in a code review, and serves nothing. Checked against the live database on
 * 26/08/2026:
 *
 *   bucket            public   objects
 *   wo-photos          false        22
 *   dm-audio           false        10
 *   part-photos        false         1
 *   quality-photos     false         0
 *   database_export…   false         1
 *
 * WOChat called it, stored the result in wo_messages.image_url, and rendered that in an
 * <img>. The upload succeeded and the message never arrived, so the only trace was a
 * file nobody could see:
 *
 *   chat/5700b746-…/1774529886689_IMG_5607.jpg — 161 kB, 26/03/2026, Daniel Quiló
 *   public.wo_messages — 0 rows
 *
 * Five months, one lost photo, and no error anywhere, because the catch block said
 * "silently fail".
 *
 * The correct shape is already used in four other places — store the path, sign on read
 * with createSignedUrl / getWOPhotoUrl. This test keeps the fifth from coming back. If a
 * public bucket is ever genuinely wanted, make it public in the dashboard first, then
 * change the assertion and say which bucket and why.
 */

const SRC = resolve(__dirname, "..");

function ficheirosDeCodigo(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) return ficheirosDeCodigo(caminho);
    return /\.(ts|tsx)$/.test(entrada) ? [caminho] : [];
  });
}

describe("storage URLs", () => {
  const ficheiros = ficheirosDeCodigo(SRC).filter((f) => !f.includes("__tests__"));

  it("has files to check at all", () => {
    // A wrong path makes the assertion below vacuously true — the failure mode of every
    // test that walks a directory.
    expect(ficheiros.length).toBeGreaterThan(300);
  });

  it("never calls getPublicUrl — every bucket here is private", () => {
    const infractores = ficheiros
      .filter((f) => /getPublicUrl/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1));
    expect(infractores).toEqual([]);
  });

  it("keeps a path in wo_messages, not a URL", () => {
    const hook = readFileSync(resolve(SRC, "hooks/useWOMessages.ts"), "utf8");
    expect(hook).toMatch(/image_path/);
    expect(hook).not.toMatch(/image_url/);
  });

  it("does not swallow a failed chat upload", () => {
    // The upload and the insert are two calls; the first can succeed while the second
    // fails, and that is exactly what left an orphan in the bucket. Whatever goes wrong
    // has to reach the person who tried.
    const chat = readFileSync(resolve(SRC, "components/WOChat.tsx"), "utf8");
    // From the handler to the end of it, not to the first `return (` in the file — that
    // one belongs to ChatPhoto, which is declared above and would slice to nothing.
    const inicio = chat.indexOf("handleImageUpload");
    expect(inicio).toBeGreaterThan(-1);
    const bloco = chat.slice(inicio, chat.indexOf("\n  };", inicio));
    expect(bloco).toMatch(/upload\(/);
    expect(bloco).toMatch(/catch\s*\(\s*err/);
    expect(bloco).toMatch(/toast\.error/);
    expect(bloco).not.toMatch(/silently fail/);
  });
});
