import { describe, it, expect, vi } from "vitest";
import {
  CONNECTION_FAILED_MESSAGE,
  isConnectionFailure,
  signupErrorMessage,
  withConnectionRetry,
} from "./signupConnection";

describe("isConnectionFailure", () => {
  it("recognises the text the sign-up screen actually showed", () => {
    // postgrest-js returns a failed fetch as `{ message: "<name>: <message>" }`.
    expect(isConnectionFailure({ message: "AbortError: Fetch is aborted", code: "" })).toBe(true);
  });

  it.each([
    [{ name: "AbortError", message: "The operation was aborted." }],
    [{ name: "TimeoutError", message: "The server did not answer within 15s." }],
    [{ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }],
    [{ name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" }],
    [{ message: "TypeError: Load failed" }],
    [new TypeError("Failed to fetch")],
  ])("treats %o as a connection failure", (err) => {
    expect(isConnectionFailure(err)).toBe(true);
  });

  it.each([
    [{ message: "User already registered", status: 422 }],
    [{ message: "Password should be at least 6 characters." }],
    [{ message: "Invalid invite code" }],
    [null],
    [undefined],
    ["Failed to fetch"],
  ])("does not treat %o as a connection failure", (err) => {
    expect(isConnectionFailure(err)).toBe(false);
  });
});

describe("withConnectionRetry", () => {
  it("returns the first answer when it connected, without a second call", async () => {
    const attempt = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(withConnectionRetry(attempt, 0)).resolves.toEqual({ data: true, error: null });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a refusal", async () => {
    const refusal = { data: null, error: { message: "Invalid invite code" } };
    const attempt = vi.fn().mockResolvedValue(refusal);
    await expect(withConnectionRetry(attempt, 0)).resolves.toBe(refusal);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("tries once more when the first returned a dropped connection", async () => {
    const attempt = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: "AbortError: Fetch is aborted" } })
      .mockResolvedValueOnce({ data: true, error: null });
    await expect(withConnectionRetry(attempt, 0)).resolves.toEqual({ data: true, error: null });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("tries once more when the first threw a dropped connection", async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ error: null });
    await expect(withConnectionRetry(attempt, 0)).resolves.toEqual({ error: null });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("stops after one retry and hands back the second failure", async () => {
    const dropped = { data: null, error: { message: "AbortError: Fetch is aborted" } };
    const attempt = vi.fn().mockResolvedValue(dropped);
    await expect(withConnectionRetry(attempt, 0)).resolves.toBe(dropped);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("rethrows anything that is not a connection failure, untouched", async () => {
    const boom = new Error("programming error");
    const attempt = vi.fn().mockRejectedValue(boom);
    await expect(withConnectionRetry(attempt, 0)).rejects.toBe(boom);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe("signupErrorMessage", () => {
  it("replaces the browser's wording with the sentence a person can act on", () => {
    expect(signupErrorMessage({ message: "AbortError: Fetch is aborted" }, "x")).toBe(CONNECTION_FAILED_MESSAGE);
    expect(CONNECTION_FAILED_MESSAGE).toBe(
      "Não foi possível ligar ao servidor. Verifique a ligação e tente novamente.",
    );
  });

  it("keeps the server's own refusal", () => {
    expect(signupErrorMessage({ message: "User already registered" }, "x")).toBe("User already registered");
  });

  it("falls back when there is nothing to show", () => {
    expect(signupErrorMessage({}, "Could not create the account.")).toBe("Could not create the account.");
  });
});
