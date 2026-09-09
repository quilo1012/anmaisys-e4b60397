import { describe, it, expect, beforeEach } from "vitest";
import { shouldFireWOAlert, type WORealtimeRow } from "@/lib/woAlertGate";
import {
  isWOAcknowledged,
  acknowledgeWOLocal,
  clearAcknowledgedWOLocal,
} from "@/lib/woAck";

const USER_ID = "engineer-1";
const allLines = () => true;

const wo = (over: Partial<WORealtimeRow> = {}): WORealtimeRow => ({
  id: "wo-1",
  status: "open",
  engineer_id: null,
  locked_engineer_id: null,
  engineer_notified_acknowledged_at: null,
  line_id: null,
  ...over,
});

describe("shouldFireWOAlert", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("fires for an open, unassigned, un-acked WO", () => {
    expect(
      shouldFireWOAlert(wo(), {
        userId: USER_ID,
        shouldAlertForLine: allLines,
        isAcknowledged: isWOAcknowledged,
      }),
    ).toBe(true);
  });

  it("blocks WOs already acknowledged client-side (single-fire per WO)", () => {
    acknowledgeWOLocal("wo-1");
    expect(
      shouldFireWOAlert(wo(), {
        userId: USER_ID,
        shouldAlertForLine: allLines,
        isAcknowledged: isWOAcknowledged,
      }),
    ).toBe(false);
  });

  it("blocks WOs already acknowledged server-side", () => {
    expect(
      shouldFireWOAlert(
        wo({ engineer_notified_acknowledged_at: "2026-06-27T10:00:00Z" }),
        { userId: USER_ID, shouldAlertForLine: allLines, isAcknowledged: isWOAcknowledged },
      ),
    ).toBe(false);
  });

  it("blocks WOs in non-open status", () => {
    for (const status of ["received", "in_progress", "finished", "closed"]) {
      expect(
        shouldFireWOAlert(wo({ status }), {
          userId: USER_ID,
          shouldAlertForLine: allLines,
          isAcknowledged: isWOAcknowledged,
        }),
      ).toBe(false);
    }
  });

  it("blocks WOs assigned to another engineer", () => {
    expect(
      shouldFireWOAlert(wo({ engineer_id: "other" }), {
        userId: USER_ID,
        shouldAlertForLine: allLines,
        isAcknowledged: isWOAcknowledged,
      }),
    ).toBe(false);
  });

  it("blocks WOs locked to another engineer", () => {
    expect(
      shouldFireWOAlert(wo({ locked_engineer_id: "other" }), {
        userId: USER_ID,
        shouldAlertForLine: allLines,
        isAcknowledged: isWOAcknowledged,
      }),
    ).toBe(false);
  });

  it("respects the engineer's line filter", () => {
    expect(
      shouldFireWOAlert(wo({ line_id: "line-7" }), {
        userId: USER_ID,
        shouldAlertForLine: (id) => id === "line-1",
        isAcknowledged: isWOAcknowledged,
      }),
    ).toBe(false);
  });

  it("fires for WOs assigned to this engineer", () => {
    expect(
      shouldFireWOAlert(wo({ engineer_id: USER_ID, locked_engineer_id: USER_ID }), {
        userId: USER_ID,
        shouldAlertForLine: allLines,
        isAcknowledged: isWOAcknowledged,
      }),
    ).toBe(true);
  });

  it("re-fires for a WO whose ack was cleared (recurrence)", () => {
    acknowledgeWOLocal("wo-1");
    expect(isWOAcknowledged("wo-1")).toBe(true);
    clearAcknowledgedWOLocal("wo-1");
    expect(
      shouldFireWOAlert(wo(), {
        userId: USER_ID,
        shouldAlertForLine: allLines,
        isAcknowledged: isWOAcknowledged,
      }),
    ).toBe(true);
  });
});

/**
 * A sirene do engenheiro e a espera do armazem.
 *
 * A 09/09 uma ordem `warehouse_service` chegou ao quadro do engenheiro e tocou-
 * lhe a sirene. O portao julgava a ordem por estado, atribuicao e linha, e uma
 * espera por embalagem passa nos tres: esta `open`, nao tem engenheiro, e tem
 * uma linha. Nada no portao perguntava de quem era o trabalho.
 *
 * O primeiro teste e o caso real. O segundo guarda a fronteira do lado de la:
 * uma preventiva TAMBEM nao e uma avaria, mas e trabalho de manutencao e a
 * regra nao a pode apanhar por arrasto.
 */
describe("shouldFireWOAlert e o tipo da ordem", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("nao toca a sirene por uma ordem de armazem", () => {
    expect(
      shouldFireWOAlert(wo({ wo_type: "warehouse_service" }), {
        userId: USER_ID,
        shouldAlertForLine: allLines,
        isAcknowledged: isWOAcknowledged,
      }),
    ).toBe(false);
  });

  it("continua a tocar por uma ordem de producao e por uma preventiva", () => {
    for (const t of ["production", "preventive", null, undefined]) {
      expect(
        shouldFireWOAlert(wo({ wo_type: t as string | null }), {
          userId: USER_ID,
          shouldAlertForLine: allLines,
          isAcknowledged: isWOAcknowledged,
        }),
      ).toBe(true);
    }
  });
});
