import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { chunkCrashEvidence, isChunkLoadError } from "@/lib/chunkCrashEvidence";

/**
 * Why a screen would not download, recorded at the moment it would not.
 *
 * /dashboard/operator/my-production crashed twice six seconds apart on 10/09 with
 * `Failed to fetch dynamically imported module: …/MyProductionPage-DvfHMdmg.js`, and
 * the log could not say which of two very different things had happened. Both leave
 * the identical message:
 *
 *  - a deploy landed while the tablet held an older index.html. This host deletes the
 *    previous build's files — the crashing chunk AND the entry bundle that named it
 *    both answer 404 today — so every lazy screen that tab has not already loaded is
 *    gone for good, and the answer is to get it onto the new index.html;
 *  - the tablet lost the network for a moment. Nothing is missing, the retries simply
 *    ran out, and reloading is the wrong reflex.
 *
 * `lazyWithReload` and the ErrorBoundary each already reload on their own guess, and
 * on 10/09 neither guess worked. Rather than add a third, ask the two questions whose
 * answers separate the cases and put them in the crash: what does the chunk URL
 * answer now, and does the index.html being served still name the bundle this page is
 * running? A 404 with a stale entry is the first case; a network failure, or a 200 on
 * a chunk that just would not load, is the second.
 */

const CHUNK = "https://anmaisys.lovable.app/assets/MyProductionPage-DvfHMdmg.js";
const chunkError = () => new TypeError(`Failed to fetch dynamically imported module: ${CHUNK}`);

describe("recognising the failure", () => {
  it("knows a chunk-load error from a crash inside the module", () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
  });
});

describe("the evidence a chunk crash carries", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    window.fetch = fetchMock as unknown as typeof fetch;
    document.head.innerHTML =
      '<script type="module" src="https://anmaisys.lovable.app/assets/index-CzO8q2VT.js"></script>';
    sessionStorage.clear();
  });

  afterEach(() => {
    document.head.innerHTML = "";
  });

  const servedIndex = (entry: string) =>
    new Response(`<!doctype html><script type="module" crossorigin src="${entry}"></script>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  it("names the deploy that took the chunk away", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 404 })) // the chunk itself
      .mockResolvedValueOnce(servedIndex("/assets/index-NEWHASH.js")); // index.html now

    const e = await chunkCrashEvidence(chunkError());

    expect(e.chunkUrl).toBe(CHUNK);
    expect(e.chunkStatus).toBe(404);
    expect(e.runningEntry).toBe("/assets/index-CzO8q2VT.js");
    expect(e.servedEntry).toBe("/assets/index-NEWHASH.js");
    expect(e.entryIsStale).toBe(true);
  });

  it("says so when the page is already on the current build and the chunk is still missing", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(servedIndex("/assets/index-CzO8q2VT.js"));

    const e = await chunkCrashEvidence(chunkError());

    expect(e.entryIsStale).toBe(false);
    expect(e.chunkStatus).toBe(404);
  });

  it("distinguishes a network failure from a missing file", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const e = await chunkCrashEvidence(chunkError());

    expect(e.chunkStatus).toBe("unreachable");
    expect(e.servedEntry).toBe(null);
    expect(e.entryIsStale).toBe(null);
  });

  it("records whether the retry-and-reload path had already fired in this tab", async () => {
    sessionStorage.setItem("__lovable_chunk_reload_at", String(Date.now()));
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(servedIndex("/assets/index-NEWHASH.js"));

    const e = await chunkCrashEvidence(chunkError());

    expect(e.reloadedAlready).toBe(true);
  });

  it("asks nothing at all when the crash is not a chunk failure", async () => {
    const e = await chunkCrashEvidence(new Error("Cannot read properties of undefined"));

    expect(e).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
