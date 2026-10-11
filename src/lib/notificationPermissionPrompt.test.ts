import { describe, it, expect } from "vitest";
import {
  asksForNotificationPermissionAtLogin, FLOOR_ROLES_NOT_PROMPTED,
} from "./notificationPermissionPrompt";
import { ACTIVE_ROLES } from "@/lib/permissions";

describe("asksForNotificationPermissionAtLogin", () => {
  it("não pergunta ao chão de fábrica", () => {
    // Quem trabalha na linha recebe o pedido no cartão do overtime, com uma frase a
    // explicar porquê — não numa barra cinzenta ao abrir a página.
    expect(asksForNotificationPermissionAtLogin("operator")).toBe(false);
    expect(asksForNotificationPermissionAtLogin("employee")).toBe(false);
  });

  it("pergunta ao escritório e à manutenção", () => {
    for (const role of ["admin", "manager", "engineer", "maintenance_manager",
                        "production_office_admin", "quality_supervisor"] as const) {
      expect(asksForNotificationPermissionAtLogin(role)).toBe(true);
    }
  });

  it("não pergunta antes de saber quem é", () => {
    expect(asksForNotificationPermissionAtLogin(null)).toBe(false);
    expect(asksForNotificationPermissionAtLogin(undefined)).toBe(false);
  });

  it("os papéis excluídos existem mesmo", () => {
    // Senão a lista protege um papel que já ninguém tem, e deixa o real de fora.
    for (const r of FLOOR_ROLES_NOT_PROMPTED) expect(ACTIVE_ROLES).toContain(r);
  });
});
