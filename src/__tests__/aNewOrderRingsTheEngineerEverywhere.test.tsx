import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, act } from "@testing-library/react";

/**
 * 07/11/2026: engineers did not hear the siren for new orders. Three roads to the engineer:
 *  - the siren listens on every page, once (Q4);
 *  - the maintenance tablet's screen stays on while it waits on the Engineer dashboard (Q6);
 *  - a push for the locked phone that stays on screen and buzzes (Q5, BLOCO 152).
 */
const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const useWOAlerts = vi.fn();
let role: string | null = "engineer";
vi.mock("@/hooks/useWOAlerts", () => ({ useWOAlerts: () => useWOAlerts() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role }) }));

import { WOAlertsListener } from "@/components/WOAlertsListener";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";

describe("the siren listens on every page", () => {
  beforeEach(() => useWOAlerts.mockClear());

  it("is mounted once, in App, and no page starts a second one", () => {
    expect(read("src/App.tsx").match(/<WOAlertsListener \/>/g)).toHaveLength(1);
    for (const page of ["src/pages/dashboard/EngineerDashboard.tsx", "src/pages/dashboard/ManagerDashboard.tsx"]) {
      expect(read(page), page).not.toMatch(/useWOAlerts\(/);
    }
  });

  it("listens for an engineer, and for nobody else", () => {
    role = "engineer";
    render(<WOAlertsListener />);
    expect(useWOAlerts).toHaveBeenCalled();
    useWOAlerts.mockClear();
    for (const other of ["operator", "manager", "admin", null]) {
      role = other;
      render(<WOAlertsListener />);
    }
    expect(useWOAlerts).not.toHaveBeenCalled();
  });
});

describe("the tablet's screen stays on", () => {
  const release = vi.fn(() => Promise.resolve());
  const request = vi.fn(() => Promise.resolve({ release }));
  let visibility: DocumentVisibilityState = "visible";

  beforeEach(() => {
    release.mockClear(); request.mockClear(); visibility = "visible";
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    Object.defineProperty(document, "visibilityState", { get: () => visibility, configurable: true });
  });
  afterEach(() => { delete (navigator as unknown as Record<string, unknown>).wakeLock; });

  function Probe({ on }: { on: boolean }) { useScreenWakeLock(on); return null; }

  it("takes the lock, takes it again when the page comes back, and lets it go on leaving", async () => {
    const { unmount } = render(<Probe on />);
    await act(async () => {});
    expect(request).toHaveBeenCalledWith("screen");
    expect(request).toHaveBeenCalledTimes(1);
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("asks again after the browser dropped it while hidden", async () => {
    const sentinels: Array<EventTarget & { release: () => Promise<void> }> = [];
    request.mockImplementation(() => {
      const s = Object.assign(new EventTarget(), { release });
      sentinels.push(s);
      return Promise.resolve(s);
    });
    render(<Probe on />);
    await act(async () => {});
    visibility = "hidden";
    await act(async () => { sentinels[0].dispatchEvent(new Event("release")); document.dispatchEvent(new Event("visibilitychange")); });
    visibility = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does nothing where there is no wake lock, or when off", async () => {
    render(<Probe on={false} />);
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
    expect(() => render(<Probe on />)).not.toThrow();
  });
});

describe("the push for a locked phone", () => {
  function showFor(payload: Record<string, unknown>) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
    const self = {
      addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
      registration: { showNotification: (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); return Promise.resolve(); } },
      clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
      skipWaiting: () => {},
    };
    new Function("self", "caches", read("public/sw.js"))(self, { keys: () => Promise.resolve([]) });
    handlers.push({ data: { json: () => payload }, waitUntil: () => {} });
    return shown[0].options;
  }

  it("a new order stays on screen until touched and buzzes in long bursts", () => {
    const o = showFor({ title: "🚨 New maintenance order WO-1", body: "Line 4", tag: "wo_new:abc" });
    expect(o.requireInteraction).toBe(true);
    expect((o.vibrate as number[]).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(3000);
  });

  it("any other bell row keeps its quiet behaviour", () => {
    const o = showFor({ title: "Message", body: "hi", tag: "dm:xyz" });
    expect(o.requireInteraction).toBe(false);
    expect(o.vibrate).toBeUndefined();
  });
});
