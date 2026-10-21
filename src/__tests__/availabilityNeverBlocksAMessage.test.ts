import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Availability is shown, never enforced. Busy, Away, Do Not Disturb, Offline and On
 * Holiday describe a person; none of them is a reason to refuse them a message.
 *
 * Nothing in the code that sends can read a status (it does not import the presence
 * modules), and the migration that stores statuses writes no policy or trigger on the
 * message tables. If either changes, this fails and asks for the decision to be made on
 * purpose.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("a status never stops a message", () => {
  const SENDING = [
    "src/hooks/useDirectMessages.ts",
    "src/hooks/useChat.ts",
    "src/components/chat/Composer.tsx",
    "src/components/workforce/MessageSupervisorDialog.tsx",
  ];

  for (const file of SENDING) {
    it(`${file} does not know about availability`, () => {
      const src = read(file);
      expect(src).not.toMatch(/communicationPresence|useCommunicationPresence|usePresenceOf|useMyAvailability|AvailabilityStatus/);
      expect(src).not.toMatch(/do_not_disturb|on_holiday|communication_presence_for|communication_my_availability/);
    });
  }

  it("the migration writes no policy or trigger on the message tables", () => {
    const dir = resolve(ROOT, "supabase/migrations");
    const file = readdirSync(dir).find((f) => /the_presence_draft_gets_its_migration/.test(f));
    expect(file, "presence migration present").toBeTruthy();
    const sql = readFileSync(resolve(dir, file!), "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(create|drop|alter)\s+(or\s+replace\s+)?(policy|trigger)\b[^;]*\b(direct_messages|chat_)/i);
    expect(sql).not.toMatch(/\balter\s+table\s+(if\s+exists\s+)?(only\s+)?public\.(direct_messages|chat_)/i);
    expect(sql).not.toMatch(/\b(insert|update|delete)\b[^;]*\bpublic\.(direct_messages|chat_)/i);
    expect(sql).not.toMatch(/\bgrant\b[^;]*\bpublic\.(direct_messages|chat_)/i);
  });

  it("the picker says out loud that Offline and On Holiday still receive messages", () => {
    const src = read("src/lib/communicationPresence.ts");
    expect(src).toMatch(/offline: "Appear offline\. You still receive messages\."/);
    expect(src).toMatch(/on_holiday: "Away on leave\. You still receive messages\."/);
  });
});
