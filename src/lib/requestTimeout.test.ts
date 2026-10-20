import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installRequestTimeout } from "./requestTimeout";

const marker = window as unknown as { __requestTimeoutInstalled?: boolean };
let originalFetch: typeof fetch;

beforeEach(() => {
  vi.useFakeTimers();
  originalFetch = window.fetch;
  delete marker.__requestTimeoutInstalled;
  window.fetch = vi.fn((_input, init) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response("ok")), 60_000);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(init.signal?.reason);
    }, { once: true });
  }));
  installRequestTimeout();
});

afterEach(() => {
  window.fetch = originalFetch;
  delete marker.__requestTimeoutInstalled;
  vi.useRealTimers();
});

describe("request deadlines", () => {
  it.each([
    ["/functions/v1/headcount-sharepoint", "POST"],
    ["/functions/v1/intouch-poll", "POST"],
    ["/functions/v1/identify-part", "POST"],
    ["/functions/v1/send-shift-report", "POST"],
    ["/rest/v1/work_orders", "GET"],
    ["/rest/v1/rpc/report", "POST"],
  ])("allows a one-minute %s operation to complete", async (path, method) => {
    const result = window.fetch(`https://example.test${path}`, { method });
    const success = expect(result).resolves.toBeInstanceOf(Response);
    await vi.advanceTimersByTimeAsync(60_000);
    await success;
  });

  it("keeps the short deadline for a direct table save", async () => {
    const result = window.fetch("https://example.test/rest/v1/production_items", { method: "POST" });
    const failure = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(15_000);
    await failure;
  });

  it("still bounds a function that never answers", async () => {
    window.fetch = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    delete marker.__requestTimeoutInstalled;
    installRequestTimeout();
    const result = window.fetch("https://example.test/functions/v1/headcount-sharepoint", { method: "POST" });
    const failure = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(120_000);
    await failure;
  });

  it("honours caller cancellation before the deadline", async () => {
    const controller = new AbortController();
    const result = window.fetch("https://example.test/functions/v1/identify-part", { signal: controller.signal });
    const failure = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });
});