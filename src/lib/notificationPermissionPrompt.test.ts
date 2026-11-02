import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import {
  askOnFirstGesture, asksForNotificationPermissionAtLogin, FLOOR_ROLES_NOT_PROMPTED,
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

describe("askOnFirstGesture", () => {
  // 02/11/2026: Root Diagnostics showed three employees go from "default" to "denied" on
  // the Home Screen app, and three more "granted" with no subscription. The first-touch
  // handler in DashboardLayout (27/07, for DM alerts on the tablet) asked everybody, the
  // floor included, with the bare iOS prompt and no sentence — on the first tap anywhere.
  // A no there is only undone in Settings; a yes there grants permission and subscribes
  // nothing, so the server still has no phone.
  const fake = (permission: NotificationPermission) => ({ permission, requestPermission: vi.fn(async () => permission) });

  it("não pergunta ao chão de fábrica no primeiro toque", () => {
    for (const role of ["employee", "operator"] as const) {
      const n = fake("default");
      expect(askOnFirstGesture(role, n)).toBe(false);
      expect(n.requestPermission).not.toHaveBeenCalled();
    }
  });

  it("pergunta ao escritório, uma vez, enquanto não respondeu", () => {
    const n = fake("default");
    expect(askOnFirstGesture("admin", n)).toBe(true);
    expect(n.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("não volta a perguntar a quem já respondeu, nem antes de saber quem é", () => {
    for (const p of ["granted", "denied"] as const) {
      const n = fake(p);
      expect(askOnFirstGesture("admin", n)).toBe(false);
      expect(n.requestPermission).not.toHaveBeenCalled();
    }
    const n = fake("default");
    expect(askOnFirstGesture(null, n)).toBe(false);
    expect(n.requestPermission).not.toHaveBeenCalled();
  });

  it("sem Notification (Safari num separador do iPhone) não faz nada", () => {
    expect(askOnFirstGesture("admin", undefined)).toBe(false);
  });
});
