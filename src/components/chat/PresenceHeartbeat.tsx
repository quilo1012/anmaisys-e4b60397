import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isSharedTabletSession } from "@/lib/sharedTabletSession";
import { PRESENCE_HEARTBEAT_MS } from "@/lib/communicationPresence";
import { hasLiveSession } from "@/lib/liveSession";
import { authenticatedRpc } from "@/lib/authenticatedRpc";
import { MY_AVAILABILITY_KEY, PRESENCE_KEY } from "@/hooks/useCommunicationPresence";

const TAB_KEY = "an_presence_tab";


/** One id per browser tab, kept for the life of the tab. Never shared between tabs. */
export function presenceTabId(storage?: Pick<Storage, "getItem" | "setItem"> | null): string {
  const fresh = () => (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      }));
  let store: Pick<Storage, "getItem" | "setItem"> | null = null;
  try { store = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null); } catch { store = null; }
  try {
    const known = store?.getItem(TAB_KEY);
    if (known && /^[0-9a-f-]{36}$/i.test(known)) return known;
    const id = fresh();
    store?.setItem(TAB_KEY, id);
    return id;
  } catch {
    return fresh();
  }
}

/** Ends this tab's lease now (sign-out). Never throws: signing out must not wait on presence. */
export async function endMyPresence(): Promise<void> {
  try {
    if (!(await hasLiveSession())) return;
    await authenticatedRpc("communication_end_presence", { p_tab_id: presenceTabId() });
  } catch { /* the lease runs out in 180 s */ }
}

/**
 * Mounted once, at the top of the app (not in the page layout, which remounts on every
 * navigation): says "this tab is open" every 60 seconds and listens for changes.
 *
 *  - A beat renews a 180-second lease on the SERVER's clock, so a missed beat or two does
 *    not flip anybody, and a closed laptop reads Offline within three minutes without
 *    anyone doing anything. The lease never touches the person's CHOICE.
 *  - A tab that closes politely ends its own lease on `pagehide` (best effort: the
 *    browser may cancel the call, and the lease then simply runs out). Since the token
 *    check went in, that call waits on `getSession()` first, so a page torn down fast
 *    loses the polite ending slightly more often than it used to. Deliberate: the
 *    180-second lease is the designed backstop and costs one stale tile for a minute,
 *    while firing the call without a token buys nothing and writes a guaranteed 401
 *    into Root Diagnostics — the very noise this guard exists to stop.
 *  - Realtime delivers a marker when somebody connects, disconnects or changes their
 *    choice; it carries no status, so the list is re-read through the same check.
 *  - A shared line tablet is a place, not a person: it never holds a lease.
 */
export function PresenceHeartbeat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || isSharedTabletSession()) return;
    const tab = presenceTabId();
    let warned = false;
    let pending: ReturnType<typeof setTimeout> | undefined;

    const beat = async () => {
      try {
        // Sem token nao se bate. A concessao de 180 s cobre o intervalo, e a batida
        // seguinte passa assim que o refresh chegar — saltar nao e um erro e nao se
        // regista como tal.
        if (!(await hasLiveSession())) return;
        const { error } = await authenticatedRpc("communication_touch_presence", { p_tab_id: tab });
        if (error && !warned) { warned = true; console.warn("Presence heartbeat refused:", error.message); }
        if (!error) warned = false;
      } catch { /* offline: the next beat tries again */ }
    };
    const leave = () => { void endMyPresence(); };
    const wake = () => { if (document.visibilityState === "visible") void beat(); };
    // Several markers in a moment (somebody opening three tabs) are one re-read.
    const refresh = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: [PRESENCE_KEY] });
        void qc.invalidateQueries({ queryKey: [MY_AVAILABILITY_KEY] });
      }, 250);
    };

    void beat();
    const timer = setInterval(() => void beat(), PRESENCE_HEARTBEAT_MS);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("pagehide", leave);

    const channel = supabase
      .channel(`communication-presence:${userId}:${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "communication_presence_changes" }, refresh)
      .subscribe();

    return () => {
      clearInterval(timer);
      if (pending) clearTimeout(pending);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("pagehide", leave);
      void supabase.removeChannel(channel);
      // Not ending the lease here: unmounting is a sign-out or a reload, and pagehide / the
      // 180-second lease cover both. Ending it on every unmount would flicker the person.
    };
  }, [userId, qc]);

  return null;
}
