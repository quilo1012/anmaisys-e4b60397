/**
 * A página de definições do iTouching não grava nada em `machines`.
 *
 * O botão "Auto-map all machines" escrevia o GUID do iTouching em `machines.code`. Desde
 * 06/08 esse campo é o código interno da máquina (20260806100000_split_asset_code_and_external_id
 * apagou os GUIDs de lá e pôs-lhe um índice único), e a ligação ao iTouching vive em
 * `intouch_machine_map`, que é o que o quadro lê. A 09/11 o botão rebentou com
 * `machines_code_unique`: as linhas 5A/5B e 6A/6B partilham o mesmo GUID. Quando não
 * rebentava, trocava o código interno de uma máquina por um GUID que ninguém lê.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(__dirname, "../pages/dashboard/IntouchSettingsPage.tsx"), "utf8");

describe("IntouchSettingsPage", () => {
  it("não escreve na tabela machines", () => {
    expect(page).not.toMatch(/from\(\s*"machines"\s*\)\s*\.\s*(upsert|insert|update)/);
  });

  it("não manda colar o GUID no campo Code das máquinas", () => {
    expect(page).not.toMatch(/paste it into the matching\s+machine's <strong>Code<\/strong>/);
  });
});
