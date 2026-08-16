import { describe, expect, it } from "vitest";
import { safetyFormBlockers } from "@/lib/actionDomain";

const empty = { domain: "safety", safety_kind: "", leader_name: "", line: "" };

describe("safetyFormBlockers", () => {
  it("names what a safety occurrence cannot be recorded without", () => {
    // Sem lider e sem linha a ocorrencia nao pode ser contada por nenhum dos dois, e uma
    // contagem que descarta linhas em silencio e a armadilha que este modelo evita.
    expect(safetyFormBlockers(empty)).toEqual(["Kind", "Leader", "Line"]);
  });

  it("clears once all three are given", () => {
    expect(safetyFormBlockers({ ...empty, safety_kind: "near_miss", leader_name: "X", line: "Line 5" })).toEqual([]);
  });

  it("blocks nothing on a quality action, whose rules did not change", () => {
    expect(safetyFormBlockers({ domain: "quality", safety_kind: "", leader_name: "", line: "" })).toEqual([]);
  });
});
