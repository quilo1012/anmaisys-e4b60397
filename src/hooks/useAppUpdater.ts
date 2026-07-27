import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps the tablet on the latest deployed build without a manual refresh.
 * Vite emits a hashed `/assets/index-*.js` entry that changes on every publish,
 * so we compare the currently-running entry against the one in the freshly
 * fetched index.html. When a new build is out:
 *   - if the app is backgrounded → reload right away (zero interruption);
 *   - if it's in use → expose `updateReady` so the UI can show a prominent
 *     "Update now" banner, and still auto-reload the next time the app is
 *     backgrounded, so we never wipe a half-typed entry or leave the tablet
 *     stuck on a stale build.
 *
 * Returns `{ updateReady, reloadNow }` for the banner in <AppUpdater/>.
 */
export function useAppUpdater() {
  const baselineRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const [updateReady, setUpdateReady] = useState(false);

  const reloadNow = useCallback(() => { location.reload(); }, []);

  useEffect(() => {
    const currentEntry = (): string | null => {
      const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
      const asset = scripts.map((s) => s.src).find((s) => /\/assets\/.*\.js/.test(s));
      return asset ? new URL(asset, location.href).pathname : null;
    };
    baselineRef.current = currentEntry();
    // Only meaningful for a production build (dev has no /assets/ entry).
    if (!baselineRef.current) return;

    let stopped = false;

    const fetchLatestEntry = async (): Promise<string | null> => {
      try {
        const res = await fetch(`/index.html?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return null;
        const html = await res.text();
        const m =
          html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+\.js)"/i) ??
          html.match(/src="([^"]*\/assets\/index[^"]+\.js)"/i);
        return m ? new URL(m[1], location.href).pathname : null;
      } catch {
        return null;
      }
    };

    const onUpdateDetected = () => {
      if (pendingRef.current) return;
      // Backgrounded → reload straight away, no interruption.
      if (document.visibilityState === "hidden") { location.reload(); return; }
      // In use → surface the banner and remember to reload once idle.
      pendingRef.current = true;
      setUpdateReady(true);
    };

    const check = async () => {
      if (stopped || !baselineRef.current) return;
      const latest = await fetchLatestEntry();
      if (latest && latest !== baselineRef.current) onUpdateDetected();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (pendingRef.current) location.reload();
      } else {
        check();
      }
    };

    const interval = window.setInterval(check, 2 * 60 * 1000);
    const first = window.setTimeout(check, 15_000);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { updateReady, reloadNow };
}
