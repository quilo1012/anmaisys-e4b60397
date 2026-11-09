import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A target typed by hand on the RAG board must survive a Sync from SharePoint that
 * says nothing about that cell.
 *
 * 09/11/2026: the sync cleared the whole week for every line SharePoint returned,
 * then re-inserted only what SharePoint had. A target typed for a day SharePoint has
 * no plan for (Tablet Line, Wed 11/11, 777) vanished on the next sync, and the owner
 * read it as "I can't set a target by hand".
 *
 * Owner's rule: the last write wins. A sync that brings a plan for the cell replaces
 * the typed one; typing after a sync wins until the next sync brings a plan there.
 */
const page = readFileSync(
  resolve(__dirname, "../pages/dashboard/RAGWeeklyPage.tsx"),
  "utf8",
);

describe("Sync from SharePoint and hand-typed targets", () => {
  it("does not delete rows whose plan was typed by hand", () => {
    const del = page.slice(page.indexOf(".delete()"), page.indexOf(".delete()") + 400);
    expect(del).toContain('.in("line", syncedLines)');
    expect(del).toContain('.or("plan_source.is.null,plan_source.neq.manual")');
  });

  it("keeps a typed plan when SharePoint brings no plan for that cell", () => {
    expect(page).toMatch(/keepManualPlan\s*=\s*\n?\s*isSharePoint\s*&&\s*\n?\s*prev\?\.plan_source === "manual"/);
    expect(page).toContain("plan_qty: keepManualPlan ? Number(prev?.plan_qty ?? 0)");
  });

  it("refreshes the target history after a write", () => {
    expect(page).toContain('invalidateQueries({ queryKey: ["rag-plan-history"] })');
  });
});
