import { describe, it, expect } from "vitest";
import { buildSkuCatalogue, identifyItemSku, pickLineSku, type LineSkuItem } from "./lineSku";

// The catalogue as the board reads it: what `sku_products` holds.
const catalogue = buildSkuCatalogue([
  { id: "sku-abeeng", code: "ABEENG", name: "A.B.E 375G ENERGY     [HS CODE:2106909285]", target_per_hour: 720 },
  { id: "sku-bfwp", code: "BFWP900WCP", name: "BODYFUEL WHEY PROTEIN 900G WHITE CHOCOLATE PISTACHIO     [HS CODE:2106108070]", target_per_hour: 600 },
  { id: "sku-morcw", code: "MORCW2CNC", name: "CRITICAL WHEY 2KG COOKIES N CREAM - MOROCCO [HS CODE:1806907090]", target_per_hour: 0 },
]);

const item = (over: Partial<LineSkuItem> = {}): LineSkuItem => ({
  sku_id: null,
  sku_code_text: null,
  actual: 0,
  started_at: null,
  finished_at: null,
  ...over,
});

describe("pickLineSku — what the line is making", () => {
  it("names the product from the linked SKU", () => {
    const sku = pickLineSku([item({ sku_id: "sku-bfwp", actual: 573 })], catalogue);
    expect(sku?.code).toBe("BFWP900WCP");
    expect(sku?.ratePerHour).toBe(600);
  });

  // Line 2, 12/08: 1.832 feitas, `sku_id` NULL, `sku_code_text` = 'ABEENG'. O
  // cartão não dizia o que a linha estava a fazer E dizia "SKU has no standard
  // rate" sobre um produto que tem 720/h na tabela. Duas leituras erradas, uma
  // causa: só se olhava para `sku_id`.
  it("names the product from the code the import left as text", () => {
    const sku = pickLineSku([item({ sku_code_text: "ABEENG", actual: 1832 })], catalogue);
    expect(sku?.code).toBe("ABEENG");
    expect(sku?.name).toContain("A.B.E 375G ENERGY");
    expect(sku?.ratePerHour).toBe(720);
  });

  it("matches the text code however it was typed", () => {
    expect(pickLineSku([item({ sku_code_text: "  abeeng " })], catalogue)?.code).toBe("ABEENG");
  });

  // Tablet Line, 12/08: `sku_code_text` = 'Vitamin  d3 and k2', que não é código
  // nenhum. O que o operador escreveu é a única identificação que existe, e uma
  // ranhura vazia diz menos do que ela.
  it("shows what was typed even when the catalogue has never heard of it", () => {
    const sku = pickLineSku([item({ sku_code_text: "Vitamin  d3 and k2", actual: 3441 })], catalogue);
    expect(sku?.code).toBe("Vitamin d3 and k2");
    expect(sku?.ratePerHour).toBeNull();
    expect(sku?.uncatalogued).toBe(true);
  });

  it("has nothing to say about a line with no product recorded at all", () => {
    expect(pickLineSku([item({ actual: 100 })], catalogue)).toBeNull();
    expect(pickLineSku([], catalogue)).toBeNull();
  });

  it("prefers the item that is running over the biggest one", () => {
    const sku = pickLineSku([
      item({ sku_id: "sku-bfwp", actual: 5000, finished_at: "2026-08-12T06:40:00Z", started_at: "2026-08-12T05:20:00Z" }),
      item({ sku_code_text: "ABEENG", actual: 10, started_at: "2026-08-12T09:00:00Z" }),
    ], catalogue);
    expect(sku?.code).toBe("ABEENG");
  });

  it("falls back to the item the shift was spent on when every item is closed", () => {
    const sku = pickLineSku([
      item({ sku_id: "sku-bfwp", actual: 214, finished_at: "2026-08-12T09:30:00Z" }),
      item({ sku_id: "sku-morcw", actual: 539, finished_at: "2026-08-12T09:30:00Z" }),
    ], catalogue);
    expect(sku?.code).toBe("MORCW2CNC");
  });

  // Line 6, 12/08: duas linhas de produção para o MESMO produto, uma ligada por
  // `sku_id` e a outra só com o código em texto. "+1" ao lado do código diria que
  // a linha correu dois produtos, e correu um.
  it("counts products, not rows", () => {
    const sku = pickLineSku([
      item({ sku_id: "sku-morcw", actual: 214 }),
      item({ sku_code_text: "MORCW2CNC", actual: 539 }),
    ], catalogue);
    expect(sku?.code).toBe("MORCW2CNC");
    expect(sku?.others).toBe(0);
  });

  it("counts the other products the line ran in the period", () => {
    const sku = pickLineSku([
      item({ sku_id: "sku-morcw", actual: 539 }),
      item({ sku_code_text: "ABEENG", actual: 10 }),
      item({ sku_id: "sku-bfwp", actual: 5 }),
    ], catalogue);
    expect(sku?.others).toBe(2);
  });
});

describe("the job iTouching says is running, when nothing was logged", () => {
  // Line 2, 12/08 11:04Z: zero production_items — a linha estava em Line
  // Preparation, a ser montada. O 1.832/ABEENG que lá esteve era a produção da
  // Line 3 no lote errado e foi apagado. Nada na base sabia o produto, e o
  // iTouching sabia: é ele que tem o job Running por máquina.
  const now = new Date("2026-08-12T11:04:06Z");
  const live = (over: Partial<{ code: string | null; name: string | null; seenAt: Date | null; state: "running" | "next" }> = {}) => ({
    job: { code: "ABEENG", name: "A.B.E 375G ENERGY", seenAt: new Date("2026-08-12T11:00:00Z"), state: "running" as const, ...over },
    now,
  });

  it("names the live job and says where it came from", () => {
    const sku = pickLineSku([], catalogue, live());
    expect(sku?.code).toBe("ABEENG");
    expect(sku?.source).toBe("itouch");
    expect(sku?.liveState).toBe("running");
  });

  // Uma linha em Line Preparation não está a fazer o produto para que está a ser
  // montada. O cartão nomeia-o e diz que é o próximo — não o carimba de "a
  // correr", que é a única coisa que não pode dizer.
  it("carries through that the job has not started", () => {
    const sku = pickLineSku([], catalogue, live({ state: "next" }));
    expect(sku?.liveState).toBe("next");
    expect(sku?.source).toBe("itouch");
  });

  it("says nothing about a live state for something logged on the line", () => {
    expect(pickLineSku([item({ sku_id: "sku-bfwp", actual: 10 })], catalogue, live())?.liveState).toBeNull();
  });

  it("takes the name and the standard from the catalogue, not from iTouching's text", () => {
    // O nome do catálogo é o que o resto do sistema usa; e a cadência existe,
    // mesmo que ninguém tenha registado uma ordem contra ela.
    const sku = pickLineSku([], catalogue, live({ name: "abe energy 375" }));
    expect(sku?.name).toContain("A.B.E 375G ENERGY");
    expect(sku?.ratePerHour).toBe(720);
  });

  it("shows a live code the catalogue does not hold, marked", () => {
    const sku = pickLineSku([], catalogue, live({ code: "NOVOSKU9", name: null }));
    expect(sku?.code).toBe("NOVOSKU9");
    expect(sku?.uncatalogued).toBe(true);
    expect(sku?.source).toBe("itouch");
  });

  // Um registo nosso tem quantidade contra que medir; o job do iTouching não.
  // Onde os dois existem, quem manda é o que foi registado na linha.
  it("never overrides what was logged on the line", () => {
    const sku = pickLineSku([item({ sku_id: "sku-bfwp", actual: 1623 })], catalogue, live());
    expect(sku?.code).toBe("BFWP900WCP");
    expect(sku?.source).toBe("logged");
  });

  it("refuses a job nobody has confirmed for half an hour", () => {
    // O poll pergunta a cada cinco minutos e limpa o campo quando não há job.
    // Um valor que sobreviveu a isso é o poll parado, não uma linha a correr.
    expect(pickLineSku([], catalogue, live({ seenAt: new Date("2026-08-12T10:30:00Z") }))).toBeNull();
    expect(pickLineSku([], catalogue, live({ seenAt: null }))).toBeNull();
  });

  it("has nothing to say when iTouching has no running job either", () => {
    expect(pickLineSku([], catalogue, live({ code: null }))).toBeNull();
    expect(pickLineSku([], catalogue)).toBeNull();
  });

  it("counts no other products off a live job — it is one job, not a period", () => {
    expect(pickLineSku([], catalogue, live())?.others).toBe(0);
  });
});

describe("identifyItemSku — one product, one row, on every screen", () => {
  // O SKU Efficiency agrupava por `sku_id` e fazia `if (!sku) continue`: as linhas
  // com o produto só em texto desapareciam da tabela em silêncio — 22 linhas e
  // 29.325 unidades em 90 dias. Uma tabela que deixa de fora aquilo que não soube
  // ler não diz que não soube; parece completa.
  it("gives a linked row and a text row for the same product the same key", () => {
    const a = identifyItemSku(item({ sku_id: "sku-morcw", actual: 214 }), catalogue);
    const b = identifyItemSku(item({ sku_code_text: "morcw2cnc", actual: 539 }), catalogue);
    expect(a?.key).toBe(b?.key);
    expect(b?.code).toBe("MORCW2CNC");
    expect(b?.uncatalogued).toBe(false);
  });

  it("keeps an unmatched code as its own row instead of dropping it", () => {
    const id = identifyItemSku(item({ sku_code_text: "Criticql whey vanilla 825" }), catalogue);
    expect(id).not.toBeNull();
    expect(id?.code).toBe("Criticql whey vanilla 825");
    expect(id?.uncatalogued).toBe(true);
    expect(id?.row).toBeNull();
  });

  // Duas grafias do mesmo engano — "Critical whey vanilla 825" e "Criticql whey
  // vanilla 825", em dias seguidos na Line 6 — são dois produtos até alguém as
  // reconciliar. Adivinhar qual é qual seria inventar produção.
  it("does not guess that two different typings are the same product", () => {
    const a = identifyItemSku(item({ sku_code_text: "Critical whey vanilla 825" }), catalogue);
    const b = identifyItemSku(item({ sku_code_text: "Criticql whey vanilla 825" }), catalogue);
    expect(a?.key).not.toBe(b?.key);
  });

  it("has nothing to identify when both columns are empty", () => {
    expect(identifyItemSku(item({ actual: 9836 }), catalogue)).toBeNull();
    expect(identifyItemSku(item({ sku_code_text: "   " }), catalogue)).toBeNull();
  });

  it("carries the catalogue row through for whoever needs the rest of it", () => {
    const id = identifyItemSku(item({ sku_code_text: "ABEENG" }), catalogue);
    expect(id?.row?.id).toBe("sku-abeeng");
    expect(id?.row?.target_per_hour).toBe(720);
  });
});

/**
 * A cadência padrão do SKU.
 *
 * Já não pontua nada: o painel passou a medir contra o relógio do turno, e a
 * razão está escrita no cabeçalho do `linePerformance.ts`. Continua a ser lida
 * porque é uma coluna real que o planeamento usa — e continua a ser resolvida
 * pelo código em texto, que é o que a mantém honesta.
 */
describe("the rate the catalogue carries", () => {
  it("is found through the text code too, not only through the link", () => {
    const sku = pickLineSku([item({ sku_code_text: "ABEENG", actual: 1832 })], catalogue);
    expect(sku?.ratePerHour).toBe(720);
  });

  // MORCW2CNC tem target_per_hour = 0 — 208 SKUs activos têm. Zero não é uma
  // cadência e não pode passar por uma; é a ausência de um padrão, e foi esta
  // ausência, repetida por mais de duzentos produtos, que acabou por matar a
  // pontuação por ritmo.
  it("treats a zero standard as no standard", () => {
    const sku = pickLineSku([item({ sku_id: "sku-morcw", actual: 214 })], catalogue);
    expect(sku?.code).toBe("MORCW2CNC");
    expect(sku?.ratePerHour).toBeNull();
  });
});
