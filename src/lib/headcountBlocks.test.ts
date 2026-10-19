import { describe, it, expect } from "vitest";
import { blockOf, HEADCOUNT_BLOCKS, sheetBandOf, SHEET_BANDS } from "./headcountBlocks";

/**
 * Which block an area is drawn in, asserted rather than assumed.
 *
 * This file used to declare its own copy of `blockOf`, under a comment saying it
 * mirrored the one in ProductionHeadcountPage. The copy knew two blocks; the board
 * draws three. It passed either way, because the only function it ever called was
 * its own — so the real one could have regressed without a single test going red.
 * It now imports the thing it is testing.
 */
describe("blockOf", () => {
  it("puts the lines in production", () => {
    expect(blockOf({ section: "production", kind: "production" })).toBe("production");
  });

  it("keeps support areas in support", () => {
    expect(blockOf({ section: "support", kind: "support" })).toBe("support");
  });

  it("draws sectors in their own block", () => {
    // The case the copy could not express. The board has had a Sectors column all
    // along; the mirror in this file sent those areas to production or support by
    // their kind, and agreed with itself about it.
    expect(blockOf({ section: "sectors", kind: "production" })).toBe("sectors");
    expect(blockOf({ section: "sectors", kind: "support" })).toBe("sectors");
  });

  it("draws Hygiene, Quality and Runner with production even though they count as support", () => {
    // The factory's sheet puts them there: the people planning the day read them
    // alongside the lines they serve. `kind` is untouched, so the totals do not move.
    for (const name of ["Hygiene", "Quality", "Runner"]) {
      expect(blockOf({ section: "production", kind: "support" }), name).toBe("production");
    }
  });

  it("never loses an area whose section is unrecognised", () => {
    expect(blockOf({ section: "main_lines", kind: "production" })).toBe("production");
    expect(blockOf({ section: "warehouse_quality", kind: "support" })).toBe("support");
    expect(blockOf({ section: "", kind: "production" })).toBe("production");
    expect(blockOf({ section: null, kind: "support" })).toBe("support");
    expect(blockOf({ section: "  PRODUCTION  ".trim().toLowerCase(), kind: "support" })).toBe("production");
  });

  it("only ever answers with a block the board draws", () => {
    const cases = [
      { section: "anything", kind: "production" },
      { section: null, kind: "whatever" },
      { section: "SUPPORT", kind: "production" },
      { section: "sectors", kind: "support" },
    ];
    for (const c of cases) expect(HEADCOUNT_BLOCKS as readonly string[]).toContain(blockOf(c));
  });
});

/**
 * As duas bandas da planilha, que o board passou a desenhar.
 *
 * Esta regra tinha dois leitores em ficheiros diferentes — uma cópia dentro do
 * `headcountSheet.ts` para o export, o papel e o import, e as três bandas do board.
 * Agora é uma só, e isto é o que a prende.
 */
describe("sheetBandOf", () => {
  it("põe as linhas na banda de produção", () => {
    expect(sheetBandOf({ section: "production", kind: "production" })).toBe("production");
  });

  it("põe os sectores no apoio, que é onde a planilha os tem", () => {
    // Hygiene, Quality, WH team e Maintenance estão na segunda banda da folha de
    // Outubro, ao lado do Lab e do Office.
    expect(sheetBandOf({ section: "sectors", kind: "production" })).toBe("support");
    expect(sheetBandOf({ section: "sectors", kind: "support" })).toBe("support");
  });

  it("deixa o Runner na produção, porque a planilha também o deixa", () => {
    // `kind` diz apoio e `section` diz produção: é `section` que decide onde a coluna
    // é desenhada, e a folha tem o Runner na primeira banda.
    expect(sheetBandOf({ section: "production", kind: "support" })).toBe("production");
  });

  it("não perde uma área cuja secção ninguém escreveu", () => {
    // O mesmo motivo que `blockOf` tem: uma área sem secção, ou com uma secção mal
    // escrita, desaparecia do board enquanto as suas alocações continuavam a ser
    // gravadas.
    expect(sheetBandOf({ section: null, kind: "production" })).toBe("production");
    expect(sheetBandOf({ section: "qualquer coisa", kind: "support" })).toBe("support");
  });

  it("põe o Lab, o Blender Room e o Office na produção", () => {
    // A fábrica lê estas três como parte de correr as linhas. A coluna `section`
    // grava-as como sectores, e foi SQL directo que o fez — se a regra vivesse na
    // coluna, bastava uma escrita para o quadro mudar de forma.
    for (const name of ["Lab", "Blender Room", "Office"]) {
      expect(sheetBandOf({ name, section: "sectors", kind: "support" }), name).toBe("production");
    }
  });

  it("reconhece o nome com espaços e maiúsculas diferentes", () => {
    expect(sheetBandOf({ name: "  BLENDER ROOM ", section: "sectors", kind: "support" }))
      .toBe("production");
    expect(sheetBandOf({ name: "office", section: null, kind: "support" })).toBe("production");
  });

  it("não move mais nenhuma área por causa do nome", () => {
    // Quem não está na lista continua a ser desenhado pela secção. Se a lista passasse
    // a mandar em tudo, o WH Team ia ter com o Lab sem que alguém o tivesse pedido.
    for (const name of ["WH Team", "Maintenance", "Hygiene", "Quality"]) {
      expect(sheetBandOf({ name, section: "sectors", kind: "support" }), name).toBe("support");
    }
  });

  it("não mexe no que as contagens contam", () => {
    // A banda diz onde a coluna é desenhada; `kind` diz o que conta em "On lines".
    // O Lab muda de banda e continua a não contar como linha.
    expect(sheetBandOf({ name: "Lab", section: "sectors", kind: "support" })).toBe("production");
    expect(blockOf({ section: "sectors", kind: "support" })).not.toBe("production");
  });

  it("nunca devolve uma terceira banda", () => {
    for (const section of ["production", "sectors", "support", null, "typo"]) {
      for (const kind of ["production", "support"]) {
        for (const name of [undefined, "Lab", "WH Team", "typo room"]) {
          expect(SHEET_BANDS).toContain(sheetBandOf({ name, section, kind }));
        }
      }
    }
  });
});
