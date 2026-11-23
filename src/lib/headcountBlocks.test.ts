import { describe, it, expect } from "vitest";
import {
  blockOf, boardBandOf, boardReorderBand, HEADCOUNT_BLOCKS, overtimeSlot, sheetBandOf, SHEET_BANDS,
} from "./headcountBlocks";
import { moveLine, renumber } from "./lineOrder";

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
    // Outubro. O Lab, o Blender Room e o Office, esses vão para a primeira — a prova
    // está mais abaixo, em «põe o Lab, o Blender Room e o Office na produção».
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

/**
 * A coluna Overtime no sítio do Lab, no board (23/11/2026).
 *
 * As áreas e a ordem são as de produção nesse dia: Runner 130, Lab 140, Blender Room
 * 150, Office 160; no apoio WH Team 10 … Quality 40.
 */
describe("Overtime no sítio do Lab", () => {
  const a = (name: string, section: string, kind: string, sort_order: number) =>
    ({ id: name, name, section, kind, sort_order });
  const areas = [
    a("Line 1", "production", "production", 10),
    a("WH Team", "sectors", "support", 10),
    a("Line 2", "production", "production", 20),
    a("Maintenance", "sectors", "support", 20),
    a("Hygiene", "sectors", "support", 30),
    a("Quality", "sectors", "support", 40),
    a("Blender Team", "production", "support", 120),
    a("Runner", "production", "production", 130),
    a("Lab", "sectors", "support", 140),
    a("Blender Room", "sectors", "support", 150),
    a("Office", "sectors", "support", 160),
  ];
  const drawn = (band: "production" | "support") => areas.filter((x) => boardBandOf(x) === band);

  it("desce o Lab para o apoio no board, e só o Lab", () => {
    expect(drawn("production").map((x) => x.name))
      .toEqual(["Line 1", "Line 2", "Blender Team", "Runner", "Blender Room", "Office"]);
    expect(drawn("support").map((x) => x.name))
      .toEqual(["WH Team", "Maintenance", "Hygiene", "Quality", "Lab"]);
  });

  it("deixa a folha como estava: o Lab continua na banda de produção do export e do papel", () => {
    expect(sheetBandOf({ name: "Lab", section: "sectors", kind: "support" })).toBe("production");
  });

  it("põe a coluna Overtime entre o Runner e o Blender Room, onde o Lab estava", () => {
    const prod = drawn("production");
    expect(prod[overtimeSlot(prod, areas)].name).toBe("Blender Room");
  });

  it("põe-na no fim da banda quando não há Lab na produção da folha", () => {
    const semLab = areas.filter((x) => x.name !== "Lab");
    const prod = semLab.filter((x) => boardBandOf(x) === "production");
    expect(overtimeSlot(prod, semLab)).toBe(prod.length);
  });

  it("mantém o Overtime entre as mesmas vizinhas quando se muda uma linha de sítio", () => {
    // Line 1 arrastada para o fim da banda (para cima do Office).
    const band = boardReorderBand(areas, "production");
    expect(band.map((x) => x.name)).toContain("Lab");
    const moved = moveLine(band.map((x) => x.id), "Line 1", "Office")!;
    const { save } = renumber(moved, new Map(band.map((x) => [x.id, x.sort_order])));
    const by = new Map(save.map((c) => [c.id, c.sort_order]));
    const after = areas
      .map((x) => ({ ...x, sort_order: by.get(x.id) ?? x.sort_order }))
      .sort((x, y) => x.sort_order - y.sort_order || x.name.localeCompare(y.name));
    const prod = after.filter((x) => boardBandOf(x) === "production");
    const at = overtimeSlot(prod, after);
    expect(prod[at - 1].name).toBe("Runner");
    expect(prod[at].name).toBe("Blender Room");
  });

  it("não renumera o Lab quando se arrastam colunas no apoio", () => {
    expect(boardReorderBand(areas, "support").map((x) => x.name))
      .toEqual(["WH Team", "Maintenance", "Hygiene", "Quality"]);
  });
});
