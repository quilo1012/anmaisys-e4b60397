import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a phone may say about push, and how often. 30/10/2026: three of four employees who
 * booked overtime from an iPhone had no phone on the server, and nothing could say whether
 * they were in a Safari tab, had said no, were never asked, or had a save fail.
 */
const rows: { endpoint: string }[] = [];
let selectError: unknown = null;
const insert = vi.fn(async () => ({ error: null as unknown }));
const eq = vi.fn(async () => ({ data: selectError ? null : rows, error: selectError }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => table === "system_telemetry_logs"
      ? { insert }
      : { select: vi.fn(() => ({ eq })) }),
  },
}));

import {
  currentDisplayMode,
  pushErrorCode,
  readPushDeviceState,
  rememberPushError,
  reportPushDeviceState,
  telemetryRow,
} from "./pushDiagnostics";

const IPHONE_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; SM-X110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const ENDPOINT = "https://web.push.apple.com/QSECRET-endpoint-token";

const getSubscription = vi.fn();
let standaloneMedia = false;

function device(opts: {
  ua: string;
  standalone?: boolean;
  push?: boolean;
  permission?: "default" | "granted" | "denied";
  worker?: "active" | "none";
}) {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: opts.ua });
  Object.defineProperty(navigator, "platform", { configurable: true, value: /iPhone/.test(opts.ua) ? "iPhone" : "Linux armv8l" });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
  Object.defineProperty(navigator, "standalone", { configurable: true, value: opts.standalone ?? false });
  const w = window as unknown as Record<string, unknown>;
  if (opts.push === false) {
    delete w.PushManager;
    delete w.Notification;
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  } else {
    w.PushManager = function PushManager() {};
    w.Notification = { permission: opts.permission ?? "default", requestPermission: vi.fn() };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => opts.worker === "none" ? undefined : { active: {}, pushManager: { getSubscription } }),
      },
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  rows.length = 0;
  selectError = null;
  standaloneMedia = false;
  getSubscription.mockResolvedValue(null);
  insert.mockResolvedValue({ error: null });
  window.matchMedia = vi.fn((q: string) => ({ matches: q.includes("standalone") && standaloneMedia })) as unknown as typeof window.matchMedia;
  localStorage.clear();
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).PushManager;
  delete (window as unknown as Record<string, unknown>).Notification;
});

describe("how the app was opened", () => {
  it("an iPhone in a Safari tab: browser, nothing to ask, server not checked for this phone", async () => {
    device({ ua: IPHONE_SAFARI_UA, push: false });
    rows.push({ endpoint: "https://web.push.apple.com/another-phone" });
    const s = await readPushDeviceState("u-1");
    expect(s).toMatchObject({
      display: "browser", environment: "ios-install", permission: "unsupported",
      local: "unknown", server: "not_checked", loginPhones: 1, platform: "ios", iosVersion: "18.7",
    });
  });

  it("an iPhone from the Home Screen: standalone, with push on offer", async () => {
    device({ ua: IPHONE_SAFARI_UA, standalone: true, permission: "granted" });
    const s = await readPushDeviceState("u-1");
    expect(s.display).toBe("standalone");
    expect(s.environment).toBe("ready");
  });

  it("is read from the display mode, not the user agent — the Home Screen app sends Safari's", () => {
    device({ ua: IPHONE_SAFARI_UA, standalone: false });
    expect(currentDisplayMode()).toBe("browser");
    standaloneMedia = true;
    expect(currentDisplayMode()).toBe("standalone");
  });
});

describe("what the phone and the server say", () => {
  it("permission denied", async () => {
    device({ ua: ANDROID_UA, permission: "denied" });
    expect((await readPushDeviceState("u-1")).permission).toBe("denied");
  });

  it("permission never asked", async () => {
    device({ ua: ANDROID_UA, permission: "default" });
    const s = await readPushDeviceState("u-1");
    expect(s).toMatchObject({ permission: "default", local: "absent", server: "not_checked" });
  });

  it("permission granted but the phone holds no subscription", async () => {
    device({ ua: IPHONE_SAFARI_UA, standalone: true, permission: "granted" });
    getSubscription.mockResolvedValue(null);
    expect(await readPushDeviceState("u-1")).toMatchObject({ worker: "active", local: "absent", server: "not_checked", loginPhones: 0 });
  });

  it("no service worker registered", async () => {
    device({ ua: ANDROID_UA, permission: "granted", worker: "none" });
    expect(await readPushDeviceState("u-1")).toMatchObject({ worker: "none", local: "absent" });
  });

  it("the phone holds a subscription the server does not have: a failed registration", async () => {
    device({ ua: IPHONE_SAFARI_UA, standalone: true, permission: "granted" });
    getSubscription.mockResolvedValue({ endpoint: ENDPOINT });
    rows.push({ endpoint: "https://web.push.apple.com/some-other-phone" });
    expect(await readPushDeviceState("u-1")).toMatchObject({ local: "present", server: "missing", loginPhones: 1 });
  });

  it("the phone and the server agree", async () => {
    device({ ua: IPHONE_SAFARI_UA, standalone: true, permission: "granted" });
    getSubscription.mockResolvedValue({ endpoint: ENDPOINT });
    rows.push({ endpoint: ENDPOINT });
    expect(await readPushDeviceState("u-1")).toMatchObject({ local: "present", server: "registered" });
  });

  it("the server could not be asked: unknown, never 'missing'", async () => {
    device({ ua: ANDROID_UA, permission: "granted" });
    getSubscription.mockResolvedValue({ endpoint: ENDPOINT });
    selectError = { message: "Failed to fetch" };
    expect((await readPushDeviceState("u-1")).server).toBe("unknown");
  });

  it("asks the server for the login's rows, never with the endpoint in the query", async () => {
    device({ ua: ANDROID_UA, permission: "granted" });
    getSubscription.mockResolvedValue({ endpoint: ENDPOINT });
    await readPushDeviceState("u-1");
    expect(eq).toHaveBeenCalledWith("user_id", "u-1");
    expect(JSON.stringify(eq.mock.calls)).not.toContain(ENDPOINT);
  });
});

describe("errors become codes", () => {
  it("never keeps an error's own text", () => {
    expect(pushErrorCode(new Error(`push service error at ${ENDPOINT}`))).toBe("push_service");
    expect(pushErrorCode({ code: "22023", message: `Invalid push subscription ${ENDPOINT}` })).toBe("save_refused:22023");
    expect(pushErrorCode(new DOMException("denied", "NotAllowedError"))).toBe("permission_denied");
    expect(pushErrorCode(new DOMException("A subscription with a different applicationServerKey already exists", "InvalidStateError"))).toBe("different_key");
    expect(pushErrorCode(new Error("Preparing notifications timed out after 20s"))).toBe("timeout");
    expect(pushErrorCode(new TypeError("something odd"))).toBe("other:TypeError");
    expect(pushErrorCode("a bare string")).toBe("other");
  });

  it("the last one is remembered with its stage", async () => {
    device({ ua: ANDROID_UA, permission: "granted" });
    rememberPushError("resync", { code: "42501", message: "permission denied for table push_subscriptions" });
    const s = await readPushDeviceState("u-1");
    // Postgres words 42501 as "permission denied"; that is the save, not the phone's permission.
    expect(s.lastError).toMatchObject({ stage: "resync", code: "save_refused:42501" });
  });
});

describe("the row", () => {
  it("carries no endpoint, keys or tokens", async () => {
    device({ ua: IPHONE_SAFARI_UA, standalone: true, permission: "granted" });
    getSubscription.mockResolvedValue({ endpoint: ENDPOINT, toJSON: () => ({ keys: { p256dh: "P256-SECRET", auth: "AUTH-SECRET" } }) });
    rows.push({ endpoint: ENDPOINT });
    rememberPushError("enable", new Error(`Registration failed at ${ENDPOINT}`));
    const row = telemetryRow(await readPushDeviceState("u-1"), "u-1", "employee");
    const text = JSON.stringify(row);
    expect(text).not.toContain(ENDPOINT);
    expect(text).not.toContain("QSECRET");
    expect(text).not.toContain("P256-SECRET");
    expect(text).not.toContain("AUTH-SECRET");
    expect(row).toMatchObject({ user_id: "u-1", user_role: "employee", error_type: "PUSH_STATE" });
  });
});

describe("how often", () => {
  const day1 = new Date(2026, 9, 30, 9, 0);
  const day1Later = new Date(2026, 9, 30, 17, 0);
  const day2 = new Date(2026, 9, 31, 9, 0);

  it("once per phone per day while nothing changes", async () => {
    device({ ua: ANDROID_UA, permission: "default" });
    expect(await reportPushDeviceState("u-1", "employee", day1)).toBe(true);
    expect(await reportPushDeviceState("u-1", "employee", day1Later)).toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(await reportPushDeviceState("u-1", "employee", day2)).toBe(true);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("again the same day when the state changes", async () => {
    device({ ua: ANDROID_UA, permission: "default" });
    await reportPushDeviceState("u-1", "employee", day1);
    device({ ua: ANDROID_UA, permission: "granted" });
    getSubscription.mockResolvedValue({ endpoint: ENDPOINT });
    rows.push({ endpoint: ENDPOINT });
    expect(await reportPushDeviceState("u-1", "employee", day1Later)).toBe(true);
    rememberPushError("resync", new Error("Failed to fetch"));
    expect(await reportPushDeviceState("u-1", "employee", day1Later)).toBe(true);
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it("again when another login uses the phone", async () => {
    device({ ua: ANDROID_UA, permission: "default" });
    await reportPushDeviceState("u-1", "employee", day1);
    expect(await reportPushDeviceState("u-2", "employee", day1)).toBe(true);
  });

  it("a refused insert is tried again next time, not marked done", async () => {
    device({ ua: ANDROID_UA, permission: "default" });
    insert.mockResolvedValueOnce({ error: { code: "42501" } });
    expect(await reportPushDeviceState("u-1", "employee", day1)).toBe(false);
    expect(await reportPushDeviceState("u-1", "employee", day1)).toBe(true);
  });
});
