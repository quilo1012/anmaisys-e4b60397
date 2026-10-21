/**
 * Where this page is running, as far as push is concerned.
 *
 * iPhone is the awkward one. Safari (iOS/iPadOS 16.4 and later) only offers Web Push to a
 * site that was added to the Home Screen and is opened from its icon; in a normal Safari
 * tab `PushManager` is absent, which used to read as "this browser does not support push".
 * It is not unsupported — it is not installed. The two need different words.
 */
export type PushEnvironment =
  /** Push can be asked for right here. */
  | { kind: "ready" }
  /** iPhone/iPad in a browser tab: add to the Home Screen first. */
  | { kind: "ios-install" }
  /** iPhone/iPad on iOS older than 16.4: nothing to install will help. */
  | { kind: "ios-too-old"; version: string }
  /** No Service Worker / Push API / Notification API at all. */
  | { kind: "unsupported" };

interface Env {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

export function isIOSDevice(userAgent: string, platform = "", maxTouchPoints = 0): boolean {
  if (/iP(hone|ad|od)/.test(userAgent)) return true;
  // iPadOS 13+ asks for the desktop site and says it is a Mac — with a touch screen.
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/** `[major, minor]` from "... OS 16_4 like Mac OS X", or null when the UA does not say. */
export function iosVersion(userAgent: string): [number, number] | null {
  const m = /OS (\d+)[_.](\d+)/.exec(userAgent);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function classifyPushEnvironment(env: Env): PushEnvironment {
  const ios = isIOSDevice(env.userAgent, env.platform, env.maxTouchPoints);
  const complete = env.hasServiceWorker && env.hasPushManager && env.hasNotification;
  if (complete) return { kind: "ready" };
  if (!ios) return { kind: "unsupported" };

  const v = iosVersion(env.userAgent);
  if (v && (v[0] < 16 || (v[0] === 16 && v[1] < 4))) return { kind: "ios-too-old", version: `${v[0]}.${v[1]}` };
  // iOS 16.4+: the pieces are missing because the page is a tab, not the installed app.
  return env.standalone ? { kind: "unsupported" } : { kind: "ios-install" };
}

export function currentPushEnvironment(): PushEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") return { kind: "unsupported" };
  const nav = navigator as Navigator & { standalone?: boolean };
  return classifyPushEnvironment({
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
  });
}
