import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * What an iPhone needs from the files themselves. None of this proves a notification
 * arrived — only a real phone can — but each line is a way it fails silently:
 *
 *  - Safari offers push only to a Home Screen app, so the manifest must say standalone and
 *    the page must name an apple-touch-icon.
 *  - iOS requires every push to show a notification (userVisibleOnly): a push handler that
 *    can return without showNotification gets the subscription revoked.
 *  - The icon send-push named (/icons/icon-192.png) did not exist.
 *  - A phone's endpoint belongs to one login (BLOCO 121).
 */
const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const sw = read("public/sw.js");
const html = read("index.html");
const manifest = JSON.parse(read("public/site.webmanifest"));
const fn = read("supabase/functions/send-push/index.ts");

describe("the installed app", () => {
  it("is a standalone web app with icons that exist", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    for (const icon of manifest.icons) expect(existsSync(resolve(root, "public", icon.src.replace(/^\//, ""))), icon.src).toBe(true);
    expect(html).toMatch(/rel="apple-touch-icon"/);
    expect(existsSync(resolve(root, "public/apple-touch-icon.png"))).toBe(true);
    expect(html).toMatch(/apple-mobile-web-app-capable/);
  });
});

describe("the service worker", () => {
  it("always shows a notification from a push", () => {
    const handler = sw.slice(sw.indexOf('addEventListener("push"'), sw.indexOf('addEventListener("pushsubscriptionchange"'));
    expect(handler).toMatch(/event\.waitUntil\(self\.registration\.showNotification\(/);
    expect(handler).not.toMatch(/\breturn;/);
  });

  it("names icons that exist", () => {
    for (const m of sw.matchAll(/"(\/[\w.-]+\.(?:png|ico))"/g)) expect(existsSync(resolve(root, "public", m[1].slice(1))), m[1]).toBe(true);
  });

  it("recovers a rotated subscription and tells the page", () => {
    expect(sw).toMatch(/pushsubscriptionchange/);
    expect(sw).toMatch(/push-subscription-changed/);
  });

  it("only draws 'Open WO' buttons on a work order", () => {
    expect(sw).toMatch(/if \(\(data\.data && data\.data\.wo_id\) \|\| data\.woId\)/);
  });
});

describe("send-push", () => {
  it("names icons that exist", () => {
    for (const m of fn.matchAll(/(?:icon|badge): "(\/[\w.-]+\.png)"/g)) expect(existsSync(resolve(root, "public", m[1].slice(1))), m[1]).toBe(true);
    expect(fn).not.toContain("/icons/icon-192.png");
  });

  it("only forgets a phone the push service says is gone", () => {
    expect(fn).toMatch(/err\.statusCode === 410 \|\| err\.statusCode === 404/);
    // exactly one delete of a subscription row, and it sits under that condition
    expect(fn.match(/from\("push_subscriptions"\)\.delete\(\)/g)).toHaveLength(1);
  });

  it("sends once per phone and says what the push service answered", () => {
    expect(fn).toMatch(/seen\.has\(s\.endpoint\)/);
    expect(fn).toMatch(/failures/);
  });

  it("keeps the private key in a server secret", () => {
    expect(fn).toMatch(/Deno\.env\.get\("VAPID_PRIVATE_KEY"\)/);
    const client = read("src/lib/vapid.ts");
    // The only key in the client is the 87-character public one; a private key is 43.
    expect(client).not.toMatch(/VAPID_PRIVATE/);
    expect(client.match(/"[A-Za-z0-9_-]{40,}"/g)?.map((k) => k.length - 2)).toEqual([87]);
  });
});

describe("BLOCO 121", () => {
  const sql = read("supabase/migrations/20261021240000_a_phone_belongs_to_one_login_and_every_group_message_buzzes.sql");
  it("moves a phone to the login that registers it, and shuts anon out", () => {
    expect(sql).toMatch(/delete from public\.push_subscriptions where endpoint = p_endpoint and user_id <> v_uid/);
    expect(sql).toMatch(/revoke execute on function public\.register_push_subscription\(text, text, text, text\) from anon/);
  });
  it("buzzes again when a group's bell row is renewed, not on every read", () => {
    expect(sql).toMatch(/after update of created_at on public\.notifications/);
    expect(sql).toMatch(/new\.kind = 'chat_group' and new\.read_at is null and new\.created_at > old\.created_at/);
  });
});
