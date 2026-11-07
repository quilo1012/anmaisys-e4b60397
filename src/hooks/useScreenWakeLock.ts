import { useEffect } from "react";

/**
 * Keeps the screen on while `enabled`, where the browser offers a screen wake lock. The
 * maintenance tablet sits on the Engineer dashboard waiting for orders; once its screen
 * sleeps, the page is frozen and the siren cannot sound (07/11/2026, Q6). The browser drops
 * the lock whenever the page is hidden, so it is taken again each time the page comes back.
 * Where there is no wake lock (older iOS), nothing happens.
 */
export function useScreenWakeLock(enabled: boolean) {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!enabled || !wakeLock) return;
    let sentinel: { release: () => Promise<void> } | null = null;
    let stopped = false;

    const take = async () => {
      if (document.visibilityState !== "visible" || sentinel) return;
      try {
        const s = await wakeLock.request("screen");
        if (stopped) { void s.release(); return; }
        sentinel = s;
        (s as unknown as EventTarget).addEventListener?.("release", () => { sentinel = null; });
      } catch {
        // Refused (battery saver, no user gesture yet): the next visibility change tries again.
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void take(); };

    void take();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (sentinel) void sentinel.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}
