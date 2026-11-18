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
  pushStateApplies,
  pushVerdict,
  pushVerdictHint,
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
    expect(pushErrorCode({ name: "PermissionStayedDefault" })).toBe("permission_stayed_default");
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

describe("why the server has nothing — said apart from what the permission is", () => {
  // 03/11/2026: "permission denied, this phone absent, server not_checked" on an admin's
  // desktop. Three readings, one cause: with permission denied no subscription can exist,
  // and with none there is nothing to look up. The row now says which link broke, and does
  // not call a desktop a phone.
  it("denied: nothing could be subscribed", async () => {
    device({ ua: ANDROID_UA, permission: "denied" });
    expect((await readPushDeviceState("u-1")).reason).toBe("permission_denied");
  });

  it("never asked: notifications were never turned on here", async () => {
    device({ ua: ANDROID_UA, permission: "default" });
    expect((await readPushDeviceState("u-1")).reason).toBe("not_enabled");
  });

  it("allowed, but no service worker", async () => {
    device({ ua: ANDROID_UA, permission: "granted", worker: "none" });
    expect((await readPushDeviceState("u-1")).reason).toBe("no_worker");
  });

  it("allowed, worker up, but never subscribed", async () => {
    device({ ua: IPHONE_SAFARI_UA, standalone: true, permission: "granted" });
    getSubscription.mockResolvedValue(null);
    expect((await readPushDeviceState("u-1")).reason).toBe("not_subscribed");
  });

  it("subscribed here, but the server never got it", async () => {
    device({ ua: IPHONE_SAFARI_UA, standalone: true, permission: "granted" });
    getSubscription.mockResolvedValue({ endpoint: ENDPOINT });
    expect((await readPushDeviceState("u-1")).reason).toBe("not_saved");
  });

  it("all agree: no reason", async () => {
    device({ ua: IPHONE_SAFARI_UA, standalone: true, permission: "granted" });
    getSubscription.mockResolvedValue({ endpoint: ENDPOINT });
    rows.push({ endpoint: ENDPOINT });
    expect((await readPushDeviceState("u-1")).reason).toBeNull();
  });

  it("the line says device, and why", async () => {
    device({ ua: ANDROID_UA, permission: "denied" });
    const row = telemetryRow(await readPushDeviceState("u-1"), "u-1", "admin");
    expect(row.message).toContain("this device absent");
    expect(row.message).not.toContain("this phone");
    expect(row.message).toContain("why permission_denied");
    expect(row.metadata.reason).toBe("permission_denied");
  });
});

describe("an iPhone Home Screen app still at 'default'", () => {
  it("never tapped: why not_enabled, and no last error", async () => {
    device({ ua: IPHONE_SAFARI_UA, standalone: true, permission: "default", worker: "none" });
    const s = await readPushDeviceState("u1");
    expect([s.display, s.permission, s.local, s.server, s.reason, s.lastError])
      .toEqual(["standalone", "default", "absent", "not_checked", "not_enabled", null]);
  });

  it("tapped Turn on and iOS answered 'default': the same reason, told apart by the last error", async () => {
    device({ ua: IPHONE_SAFARI_UA, standalone: true, permission: "default", worker: "none" });
    rememberPushError("enable", { name: "PermissionStayedDefault" });
    const s = await readPushDeviceState("u1");
    expect(s.reason).toBe("not_enabled");
    expect(s.lastError?.code).toBe("permission_stayed_default");
    expect(telemetryRow(s, "u1", "employee").message).toContain("last error enable:permission_stayed_default");
  });
});

/**
 * 18/11/2026: eight of the 50 PUSH_STATE rows were the line tablets (Line 1–6, Capsules
 * Line, Gel Machine) saying "android browser tab: permission unsupported" every morning.
 * Push is not offered on a shared tablet, so there is nothing for them to report.
 */
describe("who reports", () => {
  it("not a line tablet's operator login", async () => {
    device({ ua: ANDROID_UA, push: false });
    expect(await reportPushDeviceState("line-1", "operator")).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("not any login signed in through a shared tablet", async () => {
    device({ ua: ANDROID_UA, permission: "default" });
    localStorage.setItem("an_tablet_cred", "{}");
    expect(await reportPushDeviceState("u-1", "employee")).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("everyone else, as before", async () => {
    device({ ua: ANDROID_UA, permission: "default" });
    expect(await reportPushDeviceState("u-1", "employee")).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("the rule on its own", () => {
    expect(pushStateApplies("operator", false)).toBe(false);
    expect(pushStateApplies("employee", true)).toBe(false);
    expect(pushStateApplies("engineer", false)).toBe(true);
    expect(pushStateApplies(null, false)).toBe(true);
  });
});

/**
 * What each reading asks of the reader. On 18/11/2026 Root Diagnostics drew all 50 the same
 * grey: 22 working phones, 20 waiting on their owner, 8 tablets — and read as 50 errors.
 */
describe("the verdict on a row", () => {
  const meta = (m: Record<string, unknown>) => ({ permission: "granted", worker: "active", local: "present", server: "registered", reason: null, last_error: null, ...m });

  it("working when every link is there", () => {
    expect(pushVerdict(meta({}))).toBe("ok");
  });

  it("the person's, for a Safari tab, never turned on, or blocked", () => {
    expect(pushVerdict(meta({ environment: "ios-install", permission: "unsupported", reason: "unsupported" }))).toBe("person");
    expect(pushVerdict(meta({ permission: "default", local: "absent", server: "not_checked", reason: "not_enabled" }))).toBe("person");
    expect(pushVerdict(meta({ permission: "denied", local: "absent", server: "not_checked", reason: "permission_denied" }))).toBe("person");
    expect(pushVerdict(meta({ permission: "default", reason: "not_enabled", last_error: { stage: "enable", code: "permission_stayed_default" } }))).toBe("person");
  });

  it("ours when the phone said yes and the chain broke", () => {
    for (const reason of ["no_worker", "not_subscribed", "not_saved", "server_unreadable"]) {
      expect(pushVerdict(meta({ reason }))).toBe("fault");
    }
  });

  it("ours when the save itself was refused, whatever the permission", () => {
    expect(pushVerdict(meta({ permission: "default", reason: "not_enabled", last_error: { stage: "enable", code: "save_refused:42501" } }))).toBe("fault");
  });

  it("ours when a blocked device is still on the server's list", () => {
    // The Engineer desktop, 18/11 06:20.
    expect(pushVerdict(meta({ permission: "denied", local: "present", server: "registered", reason: "permission_denied" }))).toBe("fault");
  });

  it("an unknown reason is a fault — the direction that catches things", () => {
    expect(pushVerdict(meta({ reason: "something_new" }))).toBe("fault");
    expect(pushVerdict(null)).toBe("fault");
  });

  it("rows from before `reason` existed are judged the same way", () => {
    const old = { permission: "granted", worker: "active", local: "present", server: "registered" };
    expect(pushVerdict(old)).toBe("ok");
    expect(pushVerdict({ ...old, server: "missing" })).toBe("fault");
    expect(pushVerdict({ permission: "default", worker: "none", local: "absent", server: "not_checked" })).toBe("person");
  });

  it("says what to do in words", () => {
    expect(pushVerdictHint(meta({ environment: "ios-install", permission: "unsupported", reason: "unsupported" }))).toMatch(/Add to Home Screen/);
    expect(pushVerdictHint(meta({ permission: "denied", local: "absent", server: "not_checked", reason: "permission_denied" }))).toMatch(/settings/);
    expect(pushVerdictHint(meta({}))).toMatch(/^Working/);
    expect(pushVerdictHint(meta({ reason: "not_saved" }))).toMatch(/^Fault/);
  });
});
