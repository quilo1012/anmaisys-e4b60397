/**
 * A folha de impressão da Production Control carrega o turno inteiro.
 *
 * O ecrã edita no sítio: o Líder e o SKU são `Select`, a Equipa, a Qty e as horas são
 * `input`. O `printDocument` imprime um clone do DOM, e um clone não leva React
 * nenhum — os botões são escondidos pela folha e um `input` controlado tem o valor na
 * propriedade, não no atributo que o clone copia. Imprimir o ecrã dava uma folha com
 * as cinco colunas por que se lê um turno em branco, e nada disso dá erro: sai uma
 * página com ar de estar certa.
 *
 * Por isso o que se testa aqui é exactamente isso — que a folha é texto, que os cinco
 * valores estão lá escritos, e que não sobrou campo nenhum por onde eles se percam.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  ProductionControlPrintSheet,
  PC_COLUMNS,
  PC_FIXED_PX,
  PC_PRINTABLE_PX,
} from "@/pages/dashboard/ShiftHistoryPage";

// 06:00 e 14:00 locais, para que a folha diga as mesmas horas em qualquer fuso.
const startedAt = new Date(2026, 7, 26, 6, 0).toISOString();
const finishedAt = new Date(2026, 7, 26, 14, 0).toISOString();

const session = {
  id: "s1",
  session_date: "2026-08-26",
  shift: "DAY",
  line: "Line 3",
  leader_id: "l1",
  leader_name: "Gill",
  staff_planned: 9,
  staff_actual: 8,
  tickets: null,
  tickets_unit: null,
  locked: false,
  notes: null,
  production_items: [
    {
      id: "i1",
      sku_id: "sku1",
      sku_code_text: null,
      target_qty: 1200,
      planned_qty: 1200,
      actual_qty: 1059,
      notes: null,
      blender_ref: null,
      batch_code: "B4417",
      manufacture_month: null,
      expiry_month: null,
      started_at: startedAt,
      finished_at: finishedAt,
      tickets_unit: "bags" as const,
      production_blender_entries: [{ blender_number: 7, quantity: 1059 }],
    },
  ],
};

function renderSheet() {
  return render(
    <ProductionControlPrintSheet
      sessions={[session]}
      bands={{
        day: new Map([["2026-08-26", { qty: 1059, plan: 1200, lines: new Set(["Line 3"]) }]]),
        bay: new Map([
          ["2026-08-26|Line 3", { qty: 1059, plan: 1200, skus: 1, shifts: new Set(["DAY"]), noLeader: false }],
        ]),
      }}
      summary={{ target: 1200, actual: 1059, days: 1, lineCount: 1, pct: 88.25 }}
      skuMap={new Map([["sku1", { code: "SKU-001", name: "Whey Protein 1kg [HS CODE:2106108070]" }]])}
      leaders={[{ id: "l1", name: "Gill" }]}
      periodLabel="26/08/2026"
      shiftLabel="Day"
      filtersLabel="Line: Line 3"
    />,
  );
}

describe("Production Control print sheet", () => {
  it("writes the five columns the cloned screen would have lost", () => {
    renderSheet();
    expect(screen.getByText("Gill")).toBeTruthy();      // Leader — um Select no ecrã
    expect(screen.getByText("SKU-001")).toBeTruthy();   // SKU — um Select no ecrã
    expect(screen.getByText("8")).toBeTruthy();         // Team — um input no ecrã
    expect(screen.getAllByText("1,059").length).toBeGreaterThan(0); // Qty — um input no ecrã
    expect(screen.getByText("06:00")).toBeTruthy();     // Start — um input no ecrã
    expect(screen.getByText("14:00")).toBeTruthy();     // Finish — um input no ecrã
  });

  it("has no field or control left to lose a value in", () => {
    const { container } = renderSheet();
    expect(container.querySelectorAll("input, select, textarea, button").length).toBe(0);
  });

  it("carries the day and bay bands, the header and the total", () => {
    renderSheet();
    expect(screen.getByText(/Wed 26 Aug 2026/)).toBeTruthy();
    expect(screen.getAllByText("Line 3").length).toBeGreaterThan(0);
    expect(screen.getByText("Production Control")).toBeTruthy();
    expect(screen.getByText("Line: Line 3")).toBeTruthy();
    expect(screen.getByText(/Total for the period/i)).toBeTruthy();
    // O atingimento sai do sumário e não da soma das filas — é o mesmo número da placa.
    expect(screen.getAllByText("88%").length).toBeGreaterThan(0);
  });

  it("leaves the customs code off the paper", () => {
    renderSheet();
    // O nome do catálogo traz o HS CODE agarrado. Em papel dobrava a altura de metade
    // das filas para dizer uma coisa que não é lida por quem enche as linhas.
    expect(screen.getByText("Whey Protein 1kg")).toBeTruthy();
    expect(screen.queryByText(/HS CODE/i)).toBeNull();
  });

  it("has one total, and it is not a repeating page footer", () => {
    const { container } = renderSheet();
    // Um tfoot repete-se em todas as páginas impressas: o total do período aparecia ao
    // fundo de cada uma, como se fosse o total daquela página.
    expect(container.querySelectorAll("tfoot").length).toBe(0);
    expect(screen.getAllByText(/Total for the period/i).length).toBe(1);
  });

  it("keeps a shift that logged nothing on the sheet", () => {
    render(
      <ProductionControlPrintSheet
        sessions={[{ ...session, id: "s2", production_items: [] }]}
        bands={{
          day: new Map([["2026-08-26", { qty: 0, plan: 0, lines: new Set(["Line 3"]) }]]),
          bay: new Map([
            ["2026-08-26|Line 3", { qty: 0, plan: 0, skus: 0, shifts: new Set(["DAY"]), noLeader: false }],
          ]),
        }}
        summary={{ target: 0, actual: 0, days: 1, lineCount: 1, pct: 0 }}
        skuMap={new Map()}
        leaders={[]}
        periodLabel="26/08/2026"
        shiftLabel="Day"
      />,
    );
    expect(screen.getByText("Gill")).toBeTruthy();
    expect(screen.getByText("26/08")).toBeTruthy();
  });
});

/**
 * A régua da folha.
 *
 * A tabela é `table-layout: fixed`, e numa tabela fixa uma célula mais larga do que a
 * sua coluna não a alarga: imprime-se por cima da coluna do lado, sem erro nenhum. Foi
 * assim que o `NEUBFWP900WCP` saiu por cima do `NOT FOR EU —` e que o `M 09/26 · E
 * 09/28` saiu por cima dos números da mistura. A folha parecia certa.
 *
 * Nada disto se vê num teste de jsdom, que não mede nada. O que se pode guardar é a
 * régua: cada largura foi medida contra os dados reais de um dia de sete linhas, e o
 * `need` ao lado é essa medida. Apertar uma coluna abaixo do seu `need` é exactamente o
 * gesto que reabre o bug — e é isto que o apanha.
 */
describe("Production Control print sheet — a régua das colunas", () => {
  it("gives every column at least what its widest cell measured", () => {
    const tight = PC_COLUMNS.filter((c) => c.width > 0 && c.width < c.need);
    expect(tight.map((c) => `${c.key}: ${c.width}px < ${c.need}px`)).toEqual([]);
  });

  it("leaves the description a column to live in", () => {
    // O que sobra dos 277 mm da A4 deitada depois das treze larguras fixas. Abaixo
    // disto uma descrição de catálogo cai em quatro linhas e a folha duplica de altura.
    expect(PC_PRINTABLE_PX - PC_FIXED_PX).toBeGreaterThanOrEqual(260);
  });

  it("lets the three columns that take free text wrap instead of overprint", () => {
    const { container } = renderSheet();
    const row = container.querySelectorAll("tbody tr")[2]; // dia, baía, e a primeira fila
    const cls = [...row.querySelectorAll("td")].map((td) => td.className);
    // O SKU, a descrição e o lote são os três que recebem texto sem limite: o
    // `sku_code_text` escrito à mão, o nome do catálogo, e a linha do M/E.
    const wrapping = cls.filter((c) => c.includes("pc-wrap"));
    expect(wrapping.length).toBeGreaterThanOrEqual(3);
    expect(wrapping.some((c) => c.includes("whitespace-nowrap"))).toBe(false);
  });

  it("merges the SKU into the description when there is no description", () => {
    // Um `sku_code_text` escrito à mão ("Essential protein banana milkshake") ao lado
    // de uma descrição que é um travessão: 33 caracteres numa coluna de 100 px, em
    // três linhas, ao lado de uma célula vazia.
    const { container } = render(
      <ProductionControlPrintSheet
        sessions={[{
          ...session,
          production_items: [{
            ...session.production_items[0],
            // Sem catálogo: é o caso em que a descrição não existe de todo. (Um
            // `sku_id` que aponta a nada escreve "Unknown", que é uma descrição — e
            // uma que vale a pena ver.)
            sku_id: null,
            sku_code_text: "Essential protein banana milkshake",
          }],
        }]}
        bands={{
          day: new Map([["2026-08-26", { qty: 1059, plan: 1200, lines: new Set(["Line 3"]) }]]),
          bay: new Map([
            ["2026-08-26|Line 3", { qty: 1059, plan: 1200, skus: 1, shifts: new Set(["DAY"]), noLeader: false }],
          ]),
        }}
        summary={{ target: 1200, actual: 1059, days: 1, lineCount: 1, pct: 88.25 }}
        skuMap={new Map()}
        leaders={[]}
        periodLabel="26/08/2026"
        shiftLabel="Day"
      />,
    );
    const cell = [...container.querySelectorAll("td")].find(
      (td) => td.textContent === "Essential protein banana milkshake",
    );
    expect(cell).toBeTruthy();
    expect(cell!.getAttribute("colspan")).toBe("2");
  });
});
