import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * The browser's notification permission is asked in one place: the Turn on button
 * (`usePushNotifications().subscribe`), which asks and then subscribes in the same tap.
 *
 * 03/11/2026, PUSH_STATE from an admin's desktop and an employee's Home Screen app, both:
 * "permission denied, this phone absent, server not_checked". Nothing in the app can undo
 * a denied permission — only the browser's or iOS's settings can. What put it there were
 * the bare prompts the app fired on its own: on page load in NotificationPanel, on the first
 * tap anywhere in DashboardLayout, and on the first click in useWOAlerts. None of them said
 * what the permission was for; a dismissal there counts towards the browser's automatic
 * block; and an Allow there subscribed nothing, so the server still had no device. #790
 * took the floor out of one of the three; the other two still asked everyone.
 */
const SRC = resolve(__dirname, "..");
const ALLOWED = ["hooks/usePushNotifications.ts"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("notification permission", () => {
  it("is asked only by the Turn on button", () => {
    const askers = files(SRC)
      .filter((p) => /\brequestPermission\s*\(/.test(code(readFileSync(p, "utf8"))))
      .map((p) => relative(SRC, p).split("\\").join("/"));
    expect(askers).toEqual(ALLOWED);
  });
});
