import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Keeps the tablet on the latest deployed build without a manual refresh.
 * Vite emits a hashed `/assets/index-*.js` entry that changes on every publish,
 * so we compare the currently-running entry against the one in the freshly
 * fetched index.html. When a new build is out we reload **when it's safe**:
 *   - if the app is backgrounded → reload right away (zero interruption);
 *   - if it's in use → show a sticky "Update" toast and reload the next time the
 *     app is backgrounded, so we never wipe a half-typed entry.
 */
export function useAppUpdater() {
  const baselineRef = useRef<string | null>(null);
  const pendingReloadRef = useRef(false);

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

    const reloadWhenSafe = () => {
      if (document.visibilityState === "hidden") {
        location.reload();
        return;
      }
      if (pendingReloadRef.current) return;
      pendingReloadRef.current = true;
      toast("A new version is available", {
        description: "Tap to update now — it refreshes automatically when idle.",
        action: { label: "Update", onClick: () => location.reload() },
        duration: Infinity,
        id: "app-update",
      });
    };

    const check = async () => {
      if (stopped || !baselineRef.current) return;
      const latest = await fetchLatestEntry();
      if (latest && latest !== baselineRef.current) reloadWhenSafe();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (pendingReloadRef.current) location.reload();
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
}
