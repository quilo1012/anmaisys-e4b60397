import { describe, it, expect } from "vitest";
// Fora de `src` de propósito, como o `stopReading`: a regra é do poller e vive
// com ele, para não existir uma segunda cópia na app a dizer outra coisa.
import { pickRunningJob } from "../../supabase/functions/intouch-poll/liveJob";

/**
 * O job que o iTouching tem na máquina, de `/api/appapi/getscheduledjobs`.
 *
 * As formas e os nomes dos campos vêm do parser que já fala com este endpoint —
 * `intouch-list-scheduled-jobs` — e não de suposição: WorksOrders por máquina,
 * PartCode, Description, OrderQty, e o estado em Status ou IsRunning.
 */
const payload = (wos: unknown[]) => [{
  MachineID: "{86B96A38-2B47-4C36-9E9F-4B23A0A6E6C0}",
  MachineName: "Filler Line 2",
  WorksOrders: wos,
}];

describe("pickRunningJob", () => {
  it("takes the work order iTouching reports as running", () => {
    const job = pickRunningJob(payload([
      { PartCode: "COL165SR", Description: "COLLAGEN 165G STRAWBERRY", OrderQty: 6607, Sequence: 1, Status: "Complete" },
      { PartCode: "ABEENG", Description: "A.B.E 375G ENERGY", OrderQty: 6607, Sequence: 2, Status: "Running" },
      { PartCode: "MMMG2V", Description: "MUSCLE MOOSE", OrderQty: 900, Sequence: 3, Status: "Scheduled" },
    ]));
    expect(job).toEqual({ code: "ABEENG", name: "A.B.E 375G ENERGY", qty: 6607, state: "running" });
  });

  it("reads IsRunning when the status field says nothing useful", () => {
    const job = pickRunningJob(payload([{ PartCode: "ABEENG", Description: "A.B.E", OrderQty: 10, IsRunning: true }]));
    expect(job?.state).toBe("running");
  });

  // Line 2, 12/08 11:03Z: em "Line Preparation" — a ser montada para o job
  // seguinte, que o iTouching tem em fila e ainda não começou. Dizer que está a
  // FAZER esse produto seria mentira; não dizer nada é o ecrã a saber menos do
  // que o ecrã ao lado. Então diz-se qual, e diz-se que é o próximo.
  it("falls back to the next job in the queue, and says that is what it is", () => {
    const job = pickRunningJob(payload([
      { PartCode: "MMMG2V", Description: "MUSCLE MOOSE", OrderQty: 900, Sequence: 4, Status: "Scheduled" },
      { PartCode: "ABEENG", Description: "A.B.E 375G ENERGY", OrderQty: 6607, Sequence: 2, Status: "Scheduled" },
    ]));
    expect(job).toEqual({ code: "ABEENG", name: "A.B.E 375G ENERGY", qty: 6607, state: "next" });
  });

  it("keeps the queue order iTouching gave when no sequence is numbered", () => {
    const job = pickRunningJob(payload([
      { PartCode: "ABEENG", Description: "A.B.E", OrderQty: 1 },
      { PartCode: "MMMG2V", Description: "MOOSE", OrderQty: 1 },
    ]));
    expect(job?.code).toBe("ABEENG");
  });

  it("normalises the code the way the importer does, batch suffix included", () => {
    const job = pickRunningJob(payload([{ PartCode: " 'abeeng-b2' ", Description: "A.B.E", OrderQty: 1, Status: "Running" }]));
    expect(job?.code).toBe("ABEENG-B2");
  });

  it("names the code when iTouching sends no description", () => {
    const job = pickRunningJob(payload([{ PartCode: "ABEENG", OrderQty: 1, Status: "Running" }]));
    expect(job?.name).toBe("ABEENG");
  });

  it("reads the flat shape too, for a deployment without WorksOrders", () => {
    const job = pickRunningJob([{ MachineName: "Filler Line 2", PartCode: "ABEENG", ProductDescription: "A.B.E", RequiredQty: 500, Status: "Running" }]);
    expect(job).toEqual({ code: "ABEENG", name: "A.B.E", qty: 500, state: "running" });
  });

  // O quadro escreve NULL nestas colunas quando não há job, e "não há job" tem de
  // ser distinguível de "a resposta veio estranha" apenas por não haver código.
  it("has nothing to report when there is no job, or no code to name one", () => {
    expect(pickRunningJob(payload([]))).toBeNull();
    expect(pickRunningJob(payload([{ Description: "sem código", OrderQty: 5 }]))).toBeNull();
    expect(pickRunningJob(payload([{ PartCode: "X", OrderQty: 5 }]))).toBeNull(); // 1 char: não é código
    expect(pickRunningJob([])).toBeNull();
    expect(pickRunningJob(null)).toBeNull();
    expect(pickRunningJob("Unauthorized")).toBeNull();
  });

  it("does not report a quantity it was not given", () => {
    expect(pickRunningJob(payload([{ PartCode: "ABEENG", Status: "Running" }]))?.qty).toBeNull();
  });
});
