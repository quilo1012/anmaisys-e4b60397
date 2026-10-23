import { describe, it, expect } from "vitest";
import {
  sameApplicationServerKey,
  isDifferentKeyError,
  describeSubscribeError,
  withTimeout,
} from "./pushSubscribe";

/**
 * "Erro ao activar as notificações", 23/10. The subscribe path asked the browser for a
 * subscription without ever looking at the one it might already hold — and this app
 * changed its VAPID public key (it moved from VITE_VAPID_PUBLIC_KEY to the constant in
 * lib/vapid), so a phone that said yes under the old value is holding one that cannot
 * be reused. The browser refuses rather than replaces, and the raw DOMException went
 * straight into a toast.
 */

const key = (...bytes: number[]) => new Uint8Array(bytes);
const buf = (...bytes: number[]) => new Uint8Array(bytes).buffer;

describe("deciding whether the subscription in hand can be kept", () => {
  it("keeps one minted with the same key", () => {
    expect(sameApplicationServerKey(buf(1, 2, 3), key(1, 2, 3))).toBe(true);
  });

  it("drops one minted with a different key", () => {
    expect(sameApplicationServerKey(buf(1, 2, 4), key(1, 2, 3))).toBe(false);
    expect(sameApplicationServerKey(buf(1, 2), key(1, 2, 3))).toBe(false);
  });

  it("drops one whose key the browser will not say", () => {
    // Safari has not always exposed options.applicationServerKey. Unknown must mean
    // "mint a fresh one", never "assume it matches" — assuming is the error itself.
    expect(sameApplicationServerKey(null, key(1, 2, 3))).toBe(false);
    expect(sameApplicationServerKey(undefined, key(1, 2, 3))).toBe(false);
  });
});

describe("recognising the refusal that is worth retrying", () => {
  it("knows it by name, across browsers", () => {
    expect(isDifferentKeyError({ name: "InvalidStateError", message: "" })).toBe(true);
  });

  it("knows it by wording when the name is missing", () => {
    expect(isDifferentKeyError(new Error(
      "Registration failed - A subscription with a different applicationServerKey already exists",
    ))).toBe(true);
    expect(isDifferentKeyError(new Error("different gcm_sender_id"))).toBe(true);
  });

  it("does not retry an unrelated failure", () => {
    // Retrying a permission refusal or an offline phone just spends another tap.
    expect(isDifferentKeyError(new Error("Network request failed"))).toBe(false);
    expect(isDifferentKeyError({ name: "NotAllowedError", message: "denied" })).toBe(false);
    expect(isDifferentKeyError(null)).toBe(false);
  });
});

describe("what the person on the floor reads", () => {
  it("never shows the browser's own wording for the stale-key case", () => {
    const raw = "Registration failed - A subscription with a different applicationServerKey already exists";
    const shown = describeSubscribeError(new Error(raw));
    expect(shown).not.toContain("applicationServerKey");
    expect(shown).toMatch(/open it again|tap Turn on/i);
  });

  it("tells a blocked browser where the switch is", () => {
    expect(describeSubscribeError({ name: "NotAllowedError", message: "denied" }))
      .toMatch(/browser settings/i);
  });

  it("says a worker that will not load is not the phone's fault", () => {
    const shown = describeSubscribeError(new Error(
      "Failed to register a ServiceWorker: The script has an unsupported MIME type ('text/html')",
    ));
    expect(shown).toMatch(/server problem/i);
  });

  it("still says something when the error carries no message", () => {
    expect(describeSubscribeError({})).toBe("Could not turn on notifications.");
    expect(describeSubscribeError(null)).toBe("Could not turn on notifications.");
  });
});

describe("a wait that cannot last for ever", () => {
  it("passes the value through when it arrives in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "x")).resolves.toBe("ok");
  });

  it("gives up with a readable reason", async () => {
    // serviceWorker.ready never rejects; without this the button spins silently.
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10, "Preparing notifications"))
      .rejects.toThrow(/Preparing notifications timed out/);
  });
});
