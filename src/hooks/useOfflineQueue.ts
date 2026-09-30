import { useState, useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";

/**
 * Whether the server can actually be reached.
 *
 * `navigator.onLine` answers a narrower question than it looks like it does: it
 * says whether the device has a network interface that is up. On a factory access
 * point the normal failure is that the tablet stays perfectly associated while the
 * uplink behind it is dead — so `onLine` stays TRUE, no `offline` event ever fires,
 * and the banner that depends on it never appears. That is precisely the case the
 * operator needs told about, because their production entry is being lost.
 *
 * So the browser's answer is treated as one input, not the answer: `onLine === false`
 * is trusted immediately (the device knows when its own radio is off), and otherwise
 * a cheap HEAD against PostgREST decides. Two consecutive failures are needed before
 * declaring the server unreachable, so one dropped packet does not flash a red banner
 * across the line.
 *
 * The probe is deliberately small, deliberately not a table read, and deliberately
 * does not go through the supabase client: it asks the API root with the publishable
 * key, so it costs nothing, cannot be refused by RLS, and cannot be held up by a
 * stale session.
 */

/** How often to ask, while things look fine. */
const PROBE_INTERVAL_MS = 30_000;
/** How often to ask, once they do not — so recovery is noticed quickly. */
const PROBE_INTERVAL_WHEN_DOWN_MS = 8_000;
/** One dropped packet is not an outage. */
const FAILURES_BEFORE_OFFLINE = 2;
/** Shorter than the global request deadline: a reachability check that takes ten
 *  seconds has already answered the question. */
const PROBE_TIMEOUT_MS = 6_000;

async function serverReachable(): Promise<boolean> {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) return true; // nothing to probe against; do not cry wolf
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/rest/v1/`, {
        method: "HEAD",
        headers: { apikey: key },
        cache: "no-store",
        signal: controller.signal,
      });
      // Any answer at all — including a 4xx — means the server is there, which is
      // the only thing being asked.
      return res.status > 0;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export function useOfflineDetection() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  // `isOnline` drives the banner; this ref is what the probe loop reads, so the
  // interval does not need to be torn down and rebuilt on every state change.
  const onlineRef = useRef(isOnline);
  const failures = useRef(0);

  useEffect(() => {
    onlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const announce = (next: boolean) => {
      if (cancelled || next === onlineRef.current) return;
      onlineRef.current = next;
      setIsOnline(next);
      if (next) {
        toast({ title: "✅ Back online", description: "Connection restored." });
      } else {
        toast({
          title: "⚠️ No connection to the server",
          description: "Anything you save now will not be stored. The numbers you have typed stay on screen.",
          variant: "destructive",
        });
      }
    };

    const probe = async () => {
      if (cancelled) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        // The device knows its own radio is off — no need to ask the network.
        failures.current = FAILURES_BEFORE_OFFLINE;
        announce(false);
      } else if (await serverReachable()) {
        failures.current = 0;
        announce(true);
      } else {
        failures.current += 1;
        if (failures.current >= FAILURES_BEFORE_OFFLINE) announce(false);
      }
      if (cancelled) return;
      timer = setTimeout(
        probe,
        onlineRef.current ? PROBE_INTERVAL_MS : PROBE_INTERVAL_WHEN_DOWN_MS,
      );
    };

    // The browser's own events are still worth listening to — they are instant,
    // where the probe is on an interval.
    const handleOnline = () => {
      failures.current = 0;
      void probe();
    };
    const handleOffline = () => {
      failures.current = FAILURES_BEFORE_OFFLINE;
      announce(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    timer = setTimeout(probe, PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { isOnline };
}
