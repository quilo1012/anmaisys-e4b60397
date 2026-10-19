import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Messages, in a real browser: the list and the thread side by side on a desk, one at
 * a time on a phone, a message going out and a send that fails and is retried.
 *
 * Same fixture as every-screen-empty and mobile-shell: a fake session and every
 * Supabase call answered here. Nothing reaches the network; Realtime simply does not
 * connect, which is also how the screen must behave when it cannot.
 */

const PROJECT_REF = "ybtrzqzliepknpzqdajx";
const ME = "00000000-0000-4000-8000-0000000000ad";
const ANA = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";
const FAKE_SESSION = {
  access_token: "fixture-access-token",
  refresh_token: "fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4_102_444_800,
  user: {
    id: ME, aud: "authenticated", role: "authenticated", email: "fixture-sup@fixture.local",
    app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
  },
};

const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

interface Calls { send: unknown[]; failNextSend: boolean }

async function stub(page: Page, calls: Calls) {
  await page.addInitScript(
    ([ref, session]) => window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)),
    [PROJECT_REF, FAKE_SESSION] as const,
  );
  const groupMessages = [
    { id: "33333333-0000-4000-8000-000000000001", group_id: GROUP, sender_id: ANA, body: "Line 3 is down", reply_to_id: null, created_at: at(30), chat_attachments: [] },
    { id: "33333333-0000-4000-8000-000000000002", group_id: GROUP, sender_id: ME, body: "On my way", reply_to_id: null, created_at: at(20), chat_attachments: [] },
  ];
  await page.route(/supabase\.co/, async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("supervisor");
    if (url.includes("/rpc/has_role") || url.includes("/rpc/is_owner")) return json(false);
    if (url.includes("/rpc/list_dm_partners")) return json([{ user_id: ANA, name: "Ana Silva", email: null, line_labels: "Packing" }]);
    if (url.includes("/rpc/chat_my_dm_summaries")) {
      return json([{ partner_id: ANA, last_at: at(5), last_body: "Can I swap Saturday?", last_from_me: false, last_has_audio: false, unread: 1 }]);
    }
    if (url.includes("/rpc/chat_my_groups")) {
      return json([{
        id: GROUP, kind: "department", name: "Packing team", description: null, department: "Packing", team: null,
        avatar_path: null, my_role: "manager", member_count: 6, last_at: at(20), last_sender_name: "You",
        last_body: "On my way", last_has_files: false, unread: 0,
      }]);
    }
    if (url.includes("/rpc/chat_people")) {
      return json([
        { user_id: ANA, name: "Ana Silva", avatar_path: null, job: "Operator" },
        { user_id: ME, name: "Sam Supervisor", avatar_path: null, job: "Supervisor" },
      ]);
    }
    if (url.includes("/rpc/chat_send_group_message")) {
      if (calls.failNextSend) {
        calls.failNextSend = false;
        return json({ code: "P0001", message: "Network hiccup" }, 400);
      }
      const body = req.postDataJSON();
      calls.send.push(body);
      groupMessages.unshift({ id: body.p_id, group_id: GROUP, sender_id: ME, body: body.p_body, reply_to_id: body.p_reply_to, created_at: new Date().toISOString(), chat_attachments: [] });
      return json(body.p_id);
    }
    if (url.includes("/rest/v1/chat_group_messages")) return json(groupMessages);
    if (url.includes("/rest/v1/direct_messages") && url.includes("or=")) {
      return json([
        { id: "44444444-0000-4000-8000-000000000001", sender_id: ANA, sender_name: "Ana Silva", recipient_id: ME, message: "Can I swap Saturday?", image_url: null, audio_url: null, read_at: null, created_at: at(5), chat_attachments: [] },
      ]);
    }
    if (url.includes("/profiles")) {
      return json([{ id: ME, name: "Sam Supervisor", email: FAKE_SESSION.user.email, active: true, avatar_path: null }]);
    }
    if (url.includes("/rpc/") && /single|maybe/.test(url)) return json(null);
    return json([]);
  });
}

/** Elements past the right edge and not inside a scroller: cut off, not reachable. */
async function clipped(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= vw + 1) return;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === "auto" || ov === "scroll" || ov === "hidden") return;
      }
      out.push(`${Math.round(r.right)}px ${el.tagName} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
    });
    return out.slice(0, 5);
  });
}

test.describe("on a desk", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("lists groups and private conversations, opens a group, sends", async ({ page }) => {
    const calls: Calls = { send: [], failNextSend: false };
    await stub(page, calls);
    await page.goto(`/dashboard/messages?c=group:${GROUP}`);

    const list = page.getByRole("complementary", { name: "Conversations" });
    await expect(list.getByText("Packing team")).toBeVisible();
    await expect(list.getByText("Ana Silva")).toBeVisible();
    await expect(list.getByLabel("1 unread")).toBeVisible();

    await expect(page.getByText("Line 3 is down")).toBeVisible();
    await expect(page.getByRole("separator", { name: "Today" })).toBeVisible();

    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill("Thanks, all sorted");
    await box.press("Enter");
    await expect(page.getByText("Thanks, all sorted")).toBeVisible();
    expect(calls.send).toHaveLength(1);
    expect(calls.send[0]).toMatchObject({ p_group: GROUP, p_body: "Thanks, all sorted" });
    await expect(box).toHaveValue("");
    await page.screenshot({ path: "e2e/.results/messages-desk.png" });
  });

  test("a send that fails says so and goes on Retry, as the same message", async ({ page }) => {
    const calls: Calls = { send: [], failNextSend: true };
    await stub(page, calls);
    await page.goto(`/dashboard/messages?c=group:${GROUP}`);
    await expect(page.getByText("Line 3 is down")).toBeVisible();
    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill("Second try");
    await box.press("Shift+Enter");
    await expect(box).toHaveValue("Second try\n");
    await box.press("Enter");
    const retry = page.getByRole("button", { name: /Retry/ });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(retry).toHaveCount(0);
    expect(calls.send).toHaveLength(1);
    await expect(page.getByText("Second try")).toHaveCount(1);
  });

  test("the bell's link opens the group", async ({ page }) => {
    await stub(page, { send: [], failNextSend: false });
    await page.goto(`/dashboard/messages?group=${GROUP}`);
    await expect(page).toHaveURL(new RegExp(`c=group(%3A|:)${GROUP}`));
    await expect(page.getByText("Line 3 is down")).toBeVisible();
  });
});

for (const width of [360, 390]) {
  test.describe(`phone ${width}px`, () => {
    test.use({ viewport: { width, height: 780 } });

    test("list first, then the thread, then back; nothing cut off", async ({ page }) => {
      await stub(page, { send: [], failNextSend: false });
      await page.goto("/dashboard/messages");
      const ana = page.getByRole("button", { name: /Ana Silva/ });
      await expect(ana).toBeVisible();
      expect(await clipped(page)).toEqual([]);

      await ana.click();
      await expect(page.getByText("Can I swap Saturday?").last()).toBeVisible();
      await expect(page.getByRole("button", { name: "Back to conversations" })).toBeVisible();
      const send = page.getByRole("button", { name: /Send message|Record voice message/ });
      expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await clipped(page)).toEqual([]);
      await page.screenshot({ path: `e2e/.results/messages-phone-${width}.png` });

      await page.getByRole("button", { name: "Back to conversations" }).click();
      await expect(ana).toBeVisible();
    });
  });
}
