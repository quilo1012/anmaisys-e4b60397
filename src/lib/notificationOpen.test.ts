import { describe, it, expect } from "vitest";
import { openedNotificationFromTag } from "./notificationOpen";

const ID = "0b4b8a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

describe("openedNotificationFromTag", () => {
  it("reads the bell row's id from a tag the database trigger wrote", () => {
    expect(openedNotificationFromTag(`overtime_cancelled:${ID}`)).toEqual({ by: "id", id: ID });
    expect(openedNotificationFromTag(`chat_message:${ID.toUpperCase()}`)).toEqual({ by: "id", id: ID });
  });

  it("reads the ask from the office's overtime push", () => {
    expect(openedNotificationFromTag(`overtime-ask-${ID}`)).toEqual({ by: "ask", requestId: ID });
  });

  it("ignores tags with no bell row behind them", () => {
    for (const t of [null, undefined, "", "test:1730000000000", "line-chat-l1", `overtime-decision-${ID}`, `x:${ID}; drop`]) {
      expect(openedNotificationFromTag(t)).toBeNull();
    }
  });
});
