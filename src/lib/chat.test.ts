import { describe, it, expect } from "vitest";
import {
  avatarProblem, CHAT_FILE_MAX_BYTES, dayLabel, fileProblem, fileType, initials, layoutThread,
  listTime, matchesSearch, mergeMessages, pairFolder, parseConversationKey, sortConversations,
  storageSafeName, type ConversationSummary,
} from "./chat";

const A = "0b6c8a2e-1111-4111-8111-111111111111";
const B = "f2d1c3b4-2222-4222-8222-222222222222";

describe("where a private conversation keeps its files", () => {
  it("is one folder for the pair, whoever asks", () => {
    expect(pairFolder(A, B)).toBe(pairFolder(B, A));
    expect(pairFolder(B, A)).toBe(`dm/${A}_${B}`);
  });
});

describe("what may be sent", () => {
  it("takes the business files and refuses the rest", () => {
    expect(fileProblem({ name: "rota.pdf", type: "application/pdf", size: 100 })).toBeNull();
    expect(fileProblem({ name: "plan.xlsx", type: "", size: 100 })).toBeNull();
    expect(fileProblem({ name: "run.exe", type: "application/x-msdownload", size: 100 })).toMatch(/only/);
    expect(fileProblem({ name: "page.html", type: "text/html", size: 100 })).toMatch(/only/);
    expect(fileProblem({ name: "big.pdf", type: "application/pdf", size: CHAT_FILE_MAX_BYTES + 1 })).toMatch(/limit/);
    expect(fileProblem({ name: "empty.pdf", type: "application/pdf", size: 0 })).toMatch(/empty/);
  });

  it("knows a file by its name when the browser does not say", () => {
    expect(fileType({ name: "Photo.JPG", type: "" })).toBe("image/jpeg");
    expect(fileType({ name: "noext", type: "" })).toBe("");
  });

  it("takes only small images as a photo", () => {
    expect(avatarProblem({ name: "me.png", type: "image/png", size: 1000 })).toBeNull();
    expect(avatarProblem({ name: "me.gif", type: "image/gif", size: 1000 })).toMatch(/JPEG/);
    expect(avatarProblem({ name: "me.jpg", type: "image/jpeg", size: 3 * 1024 * 1024 })).toMatch(/limit/);
  });

  it("stores a file under a name with no folders or odd characters", () => {
    expect(storageSafeName("../../etc/passwd")).not.toContain("/");
    expect(storageSafeName("Rota w/c 12 Oct (final).PDF")).toBe("Rota_w_c_12_Oct_final.pdf");
    expect(storageSafeName("ação.docx")).toMatch(/^acao\.docx$/);
    expect(storageSafeName(".pdf")).toBe("pdf");
  });
});

describe("a thread", () => {
  const msg = (id: string, at: string, sender = A) => ({ id, created_at: at, sender_id: sender });

  it("is one copy of each message, oldest first, whichever way it arrived", () => {
    const page = [msg("2", "2026-10-19T10:01:00Z"), msg("1", "2026-10-19T10:00:00Z")];
    const live = [msg("2", "2026-10-19T10:01:00Z"), msg("3", "2026-10-19T10:02:00Z")];
    expect(mergeMessages(page, live).map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("lets the server's copy replace the one shown while sending", () => {
    const pending = [{ ...msg("x", "2026-10-19T10:00:00Z"), body: "hi", pending: true }];
    const server = [{ ...msg("x", "2026-10-19T10:00:01Z"), body: "hi", pending: false }];
    expect(mergeMessages(pending, server)).toEqual(server);
  });

  it("orders two messages of the same instant the same way every time", () => {
    const t = "2026-10-19T10:00:00Z";
    expect(mergeMessages([msg("b", t), msg("a", t)]).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("puts a date line before each day and starts a run when the sender changes", () => {
    const now = new Date(2026, 9, 19, 12, 0);
    const rows = layoutThread([
      msg("1", new Date(2026, 9, 18, 9, 0).toISOString()),
      msg("2", new Date(2026, 9, 19, 9, 0).toISOString()),
      msg("3", new Date(2026, 9, 19, 9, 1).toISOString()),
      msg("4", new Date(2026, 9, 19, 9, 2).toISOString(), B),
      msg("5", new Date(2026, 9, 19, 9, 30).toISOString(), B),
    ], now);
    expect(rows.map((r) => r.day ?? `${r.message!.id}${r.startsRun ? "*" : ""}`))
      .toEqual(["Yesterday", "1*", "Today", "2*", "3", "4*", "5*"]);
  });

  it("names days the way people say them", () => {
    const now = new Date(2026, 9, 19, 12, 0);
    expect(dayLabel(new Date(2026, 9, 12, 8).toISOString(), now)).toBe("Monday 12 October");
    expect(dayLabel(new Date(2025, 9, 12, 8).toISOString(), now)).toBe("12 October 2025");
  });

  it("shows a short time in the list", () => {
    const now = new Date(2026, 9, 19, 12, 0);
    expect(listTime(new Date(2026, 9, 19, 8, 5).toISOString(), now)).toBe("08:05");
    expect(listTime(new Date(2026, 9, 18, 8, 5).toISOString(), now)).toBe("Yesterday");
    expect(listTime(null, now)).toBe("");
  });
});

describe("the conversation list", () => {
  const c = (name: string, unread: number, lastAt: string | null): ConversationSummary => ({
    key: `dm:${A}`, kind: "dm", id: A, name, subtitle: "Supervisor", avatarPath: null, lastAt, preview: null, unread,
  });

  it("puts unread first, then the most recent, then by name", () => {
    const out = sortConversations([
      c("Old", 0, "2026-10-01T00:00:00Z"), c("Never", 0, null), c("Unread", 2, "2026-09-01T00:00:00Z"),
      c("New", 0, "2026-10-19T00:00:00Z"),
    ]);
    expect(out.map((x) => x.name)).toEqual(["Unread", "New", "Old", "Never"]);
  });

  it("finds a name whatever the accents, case, spaces or word order", () => {
    const daniel = c("Daniel Quiló", 0, null);
    for (const q of ["Daniel Quiló", "daniel quilo", "DANIEL", "Quiló", "quilo", "  quil  ", "quilo daniel", "dan qui"]) {
      expect(matchesSearch(daniel, q), q).toBe(true);
    }
    expect(matchesSearch(daniel, "daniel almeida")).toBe(false);
    expect(matchesSearch(c("Ana Quilo", 0, null), "quiló")).toBe(true);
  });

  it("finds by name or job", () => {
    expect(matchesSearch(c("Ana Silva", 0, null), "silva")).toBe(true);
    expect(matchesSearch(c("Ana Silva", 0, null), "superv")).toBe(true);
    expect(matchesSearch(c("Ana Silva", 0, null), "bob")).toBe(false);
  });

  it("reads only well-formed conversation links", () => {
    expect(parseConversationKey(`group:${A}`)).toEqual({ kind: "group", id: A });
    expect(parseConversationKey("group:'; drop table")).toBeNull();
    expect(initials("ana maria silva")).toBe("AS");
    expect(initials("")).toBe("?");
  });
});
