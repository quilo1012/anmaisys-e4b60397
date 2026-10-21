import { describe, expect, it } from "vitest";
import { classifyPushEnvironment, iosVersion, isIOSDevice } from "@/lib/pushEnvironment";

const IPHONE_17 = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_16_3 = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 Version/16.3 Mobile/15E148 Safari/604.1";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const all = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, standalone: false };
const none = { hasServiceWorker: true, hasPushManager: false, hasNotification: false, standalone: false };

describe("pushEnvironment", () => {
  it("an iPhone in a Safari tab is 'install first', not 'unsupported'", () => {
    expect(classifyPushEnvironment({ userAgent: IPHONE_17, ...none })).toEqual({ kind: "ios-install" });
  });

  it("the installed iPhone app, where PushManager exists, is ready", () => {
    expect(classifyPushEnvironment({ userAgent: IPHONE_17, ...all, standalone: true })).toEqual({ kind: "ready" });
  });

  it("an iPhone older than 16.4 is told to update, whatever it does", () => {
    expect(classifyPushEnvironment({ userAgent: IPHONE_16_3, ...none })).toEqual({ kind: "ios-too-old", version: "16.3" });
  });

  it("an iPad that says it is a Mac is still an iPad", () => {
    expect(isIOSDevice(CHROME.replace("Windows NT 10.0; Win64; x64", "Macintosh; Intel Mac OS X 10_15_7"), "MacIntel", 5)).toBe(true);
    expect(isIOSDevice(CHROME, "Win32", 0)).toBe(false);
  });

  it("an installed iPhone app that still lacks push is unsupported, not 'install'", () => {
    expect(classifyPushEnvironment({ userAgent: IPHONE_17, ...none, standalone: true })).toEqual({ kind: "unsupported" });
  });

  it("a desktop browser with the APIs is ready; without them it is unsupported", () => {
    expect(classifyPushEnvironment({ userAgent: CHROME, ...all })).toEqual({ kind: "ready" });
    expect(classifyPushEnvironment({ userAgent: CHROME, ...none })).toEqual({ kind: "unsupported" });
  });

  it("reads the iOS version", () => {
    expect(iosVersion(IPHONE_17)).toEqual([17, 4]);
    expect(iosVersion(CHROME)).toBeNull();
  });
});
