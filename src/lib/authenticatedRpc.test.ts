import { beforeEach, describe, expect, it, vi } from "vitest";
const { getSession, rpc, setHeader } = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn(), setHeader: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession }, rpc } }));
import { authenticatedRpc } from "./authenticatedRpc";

beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockReturnValue({ setHeader });
  setHeader.mockResolvedValue({ data: [], error: null });
});
describe("protected RPC session pinning", () => {
  it("makes no anonymous directory request", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(authenticatedRpc("list_engineer_names")).rejects.toThrow("No live session");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("makes no expired-token presence request", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "expired", expires_at: 1 } } });
    await expect(authenticatedRpc("communication_touch_presence", { p_tab_id: "tab" })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("pins the checked token even if the session disappears while creating the request", async () => {
    const token = `header.${btoa(JSON.stringify({ session_id: "own-session" }))}.signature`;
    getSession.mockResolvedValue({ data: { session: { access_token: token, expires_at: Date.now() / 1000 + 60 } } });
    rpc.mockImplementation(() => {
      getSession.mockResolvedValue({ data: { session: null } });
      return { setHeader };
    });
    await authenticatedRpc("communication_touch_presence", { p_tab_id: "own-tab" });
    expect(rpc).toHaveBeenCalledWith("communication_touch_presence", { p_tab_id: "own-tab" });
    expect(setHeader).toHaveBeenCalledWith("Authorization", `Bearer ${token}`);
  });
  it.each(["communication_touch_presence", "communication_end_presence"] as const)(
    "silently skips %s without a session_id claim", async (name) => {
      getSession.mockResolvedValue({ data: { session: { access_token: `header.${btoa(JSON.stringify({ role: "authenticated" }))}.signature` } } });
      await expect(authenticatedRpc(name, { p_tab_id: "tab" })).resolves.toEqual({ data: null, error: null });
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("does not require session_id for the engineer directory", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "minted-token" } } });
    await authenticatedRpc("list_engineer_names");
    expect(rpc).toHaveBeenCalledWith("list_engineer_names", undefined);
  });
});