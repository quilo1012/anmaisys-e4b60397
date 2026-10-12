import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useForgetPreviousUser } from "./useForgetPreviousUser";

/**
 * Employee A signs out of the shared tablet, employee B signs in. B must not be shown
 * A's cached overtime answers or attendance while B's own are loading.
 */
function setup(initial: string | null) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ id }) => useForgetPreviousUser(id), { wrapper, initialProps: { id: initial } });
  const seed = () => client.setQueryData(["my_attendance", "2026-10-01"], { me: "A" });
  const cached = () => client.getQueryData(["my_attendance", "2026-10-01"]);
  return { hook, seed, cached };
}

describe("useForgetPreviousUser", () => {
  it("forgets A's data when B signs in", () => {
    const { hook, seed, cached } = setup("user-a");
    seed();
    hook.rerender({ id: "user-b" });
    expect(cached()).toBeUndefined();
  });

  it("forgets A's data when A signs out", () => {
    const { hook, seed, cached } = setup("user-a");
    seed();
    hook.rerender({ id: null });
    expect(cached()).toBeUndefined();
  });

  it("has nothing of A's left when B signs in after A signed out", () => {
    const { hook, seed, cached } = setup("user-a");
    seed();
    hook.rerender({ id: null });
    hook.rerender({ id: "user-b" });
    expect(cached()).toBeUndefined();
  });

  it("keeps the cache through a token refresh, which keeps the same person", () => {
    const { hook, seed, cached } = setup("user-a");
    seed();
    hook.rerender({ id: "user-a" });
    expect(cached()).toEqual({ me: "A" });
  });

  it("clears nothing on the first sign-in of a fresh page", () => {
    const { hook, seed, cached } = setup(null);
    seed();
    hook.rerender({ id: "user-a" });
    expect(cached()).toEqual({ me: "A" });
  });
});
