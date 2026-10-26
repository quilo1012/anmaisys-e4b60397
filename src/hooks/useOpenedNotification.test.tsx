import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Opening a phone notification marks its bell row read — once, by its id (or, for the
 * office's overtime push, by the ask) — and takes the marker out of the address. It
 * never writes anything else: opening is not an answer.
 */
const calls: { method: string; args: unknown[] }[] = [];
let result: { error: unknown } = { error: null };
function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["update", "eq", "is", "in"]) c[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return c; };
  (c as { then: unknown }).then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko);
  return c;
}
const from = vi.fn((t: string) => { calls.push({ method: "from", args: [t] }); return chain(); });
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => from(t) } }));

import { useOpenedNotification } from "./useOpenedNotification";

const ID = "0b4b8a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const ASK = "1c5c9b4f-2d3e-4f60-9bac-1d2e3f4a5b6c";
let seen = "";
function Probe({ userId }: { userId: string | null }) {
  useOpenedNotification(userId);
  const l = useLocation();
  seen = l.pathname + l.search;
  return null;
}
function renderAt(url: string, userId: string | null = "u-1") {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="*" element={<Probe userId={userId} />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("useOpenedNotification", () => {
  beforeEach(() => { calls.length = 0; from.mockClear(); result = { error: null }; });

  it("marks the bell row the trigger's tag names, only if still unread, and cleans the address", async () => {
    renderAt(`/dashboard/my-overtime?ask=${ASK}&notification=${encodeURIComponent(`overtime_cancelled:${ID}`)}`);
    await waitFor(() => expect(seen).toBe(`/dashboard/my-overtime?ask=${ASK}`));
    await waitFor(() => expect(from).toHaveBeenCalledWith("notifications"));
    expect(calls.find((c) => c.method === "update")!.args[0]).toEqual({ read_at: expect.any(String) });
    expect(calls).toEqual(expect.arrayContaining([
      { method: "eq", args: ["user_id", "u-1"] },
      { method: "is", args: ["read_at", null] },
      { method: "eq", args: ["id", ID] },
    ]));
  });

  it("marks every unread notice about an ask by the shared overtime-notice tag", async () => {
    const ask = "3e7ebd61-4f50-4182-9dce-3f4a5b6c7d8e";
    renderAt(`/dashboard/my-overtime?ask=${ask}&notification=${encodeURIComponent(`overtime-notice-${ask}`)}`);
    await waitFor(() => expect(from).toHaveBeenCalledWith("notifications"));
    expect(calls).toEqual(expect.arrayContaining([
      { method: "eq", args: ["user_id", "u-1"] },
      { method: "is", args: ["read_at", null] },
      { method: "in", args: ["kind", ["overtime_changed", "overtime_cancelled", "overtime_reminder_24h", "overtime_reminder_2h"]] },
      { method: "eq", args: ["overtime_request_id", ask] },
    ]));
    // Never by id, and never the ask's own overtime_new row.
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "id")).toBe(false);
    expect(calls.some((c) => c.method === "eq" && c.args[1] === "overtime_new")).toBe(false);
  });

  it("marks the office's overtime ask by its ask", async () => {
    const other = "2d6dac50-3e4f-4071-8cbd-2e3f4a5b6c7d";
    renderAt(`/dashboard/my-overtime?notification=overtime-ask-${other}`);
    await waitFor(() => expect(calls).toEqual(expect.arrayContaining([
      { method: "eq", args: ["kind", "overtime_new"] },
      { method: "eq", args: ["overtime_request_id", other] },
    ])));
  });

  it("the same tag from the address and from the worker marks once", async () => {
    const listeners: ((e: MessageEvent) => void)[] = [];
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
      addEventListener: (_: string, f: (e: MessageEvent) => void) => listeners.push(f),
      removeEventListener: vi.fn(),
    } });
    const tag = "chat_message:3e7ebd61-4f50-4182-9dce-3f4a5b6c7d8e";
    renderAt(`/dashboard/messages?notification=${encodeURIComponent(tag)}`);
    await waitFor(() => expect(from).toHaveBeenCalledTimes(1));
    await act(async () => { listeners.forEach((f) => f({ data: { type: "notification-opened", tag } } as MessageEvent)); });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("ignores a tag with no bell row, and does nothing before sign-in", async () => {
    renderAt("/dashboard?notification=test:1730000000000");
    await waitFor(() => expect(seen).toBe("/dashboard"));
    renderAt(`/dashboard?notification=${encodeURIComponent(`overtime_changed:${ID}`)}`, null);
    expect(from).not.toHaveBeenCalled();
  });
});
