import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-me" }, profile: { name: "Ana" } }) }));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

import { AvailabilityMenu } from "./AvailabilityMenu";

function setup(mine: { preference: string; approved_holiday: boolean }, setError: string | null = null) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "communication_my_availability") return { data: [mine], error: null };
    if (fn === "communication_set_availability") return { data: null, error: setError ? { message: setError } : null };
    return { data: null, error: { message: `unexpected ${fn}` } };
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><AvailabilityMenu /></QueryClientProvider>);
}

async function openMenu() {
  const trigger = await screen.findByRole("button", { name: /your availability: .*change/i });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.findByRole("menu");
}

beforeEach(() => { rpc.mockReset(); toastError.mockReset(); toastSuccess.mockReset(); });

describe("AvailabilityMenu", () => {
  it("offers exactly the six statuses, in English, and no break", async () => {
    setup({ preference: "online", approved_holiday: false });
    const menu = await openMenu();
    const names = within(menu).getAllByRole("menuitemradio").map((el) => el.textContent ?? "");
    expect(names).toHaveLength(6);
    for (const label of ["Online", "Busy", "Do Not Disturb", "Away", "Offline", "On Holiday"]) {
      expect(names.some((n) => n.startsWith(label))).toBe(true);
    }
    expect(menu.textContent).not.toMatch(/break/i);
  });

  it("marks the saved choice", async () => {
    setup({ preference: "do_not_disturb", approved_holiday: false });
    const menu = await openMenu();
    const checked = within(menu).getAllByRole("menuitemradio").filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toMatch(/^Do Not Disturb/);
  });

  it("saves the choice through the one function that writes your own row, and nothing else", async () => {
    setup({ preference: "online", approved_holiday: false });
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^Busy/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("communication_set_availability", { p_preference: "busy" }));
    expect(rpc.mock.calls.map((c) => c[0]).filter((f) => f !== "communication_my_availability")).toEqual(["communication_set_availability"]);
    // The call has no user id to name: there is no way to set somebody else's.
    const call = rpc.mock.calls.find((c) => c[0] === "communication_set_availability")!;
    expect(Object.keys(call[1] as object)).toEqual(["p_preference"]);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("You are now set to Busy."));
  });

  it("says approved leave is why you read On Holiday, and keeps the choice underneath", async () => {
    setup({ preference: "busy", approved_holiday: true });
    const trigger = await screen.findByRole("button", { name: /your availability: on holiday/i });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByTestId("availability-leave-note").textContent).toMatch(/approved leave.*On Holiday.*choice is kept/i);
    const checked = within(menu).getAllByRole("menuitemradio").filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked[0].textContent).toMatch(/^Busy/);
  });

  it("tells you in English when it could not save, and goes back to what it was", async () => {
    setup({ preference: "online", approved_holiday: false }, "boom");
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^Away/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not save your availability. Try again."));
    await screen.findByRole("button", { name: /your availability: online/i });
  });

  it("does not save a choice that is already saved", async () => {
    setup({ preference: "away", approved_holiday: false });
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^Away/ }));
    await new Promise((r) => setTimeout(r, 30));
    expect(rpc.mock.calls.some((c) => c[0] === "communication_set_availability")).toBe(false);
  });
});
