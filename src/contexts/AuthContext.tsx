import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { logSystemError } from "@/lib/telemetry";
import { setIsOwner } from "@/lib/permissions";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { classifyBootSession, clearSessionEndNotice, noteSessionEnded } from "@/lib/sessionRestore";
import { releaseThisDevicePush } from "@/hooks/usePushNotifications";

type AppRole = Database["public"]["Enums"]["app_role"];

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  /** The break-glass account (public.app_owner). Passes every permission check. */
  isOwner: boolean;
  profile: Omit<Database["public"]["Tables"]["profiles"]["Row"], "labor_rate"> | null;
  loading: boolean;
  authError: string | null;
  /** True while a background silent re-login is being attempted (shared tablet
   *  refresh-token revocation recovery). ProtectedRoute uses this to avoid
   *  bouncing the user to /login during the recovery window. */
  silentReLoginInFlight: boolean;
  /** A session is stored but the server could not be reached to renew it. The
   *  person is still signed in; screens wait and retry instead of asking for the
   *  password. See lib/sessionRestore. */
  reconnecting: boolean;
  retryAuth: () => Promise<void>;
  signOut: (reason?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  role: null,
  isOwner: false,
  profile: null,
  loading: true,
  authError: null,
  silentReLoginInFlight: false,
  reconnecting: false,
  retryAuth: async () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

/** Returns the current shift label based on Europe/London local hour. */
export function currentShift(now: Date = new Date()): "Day" | "Night" {
  const h = parseInt(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "numeric",
      hour12: false,
    }).format(now),
    10,
  );
  return h >= 6 && h < 18 ? "Day" : "Night";
}

/** Race a promise against a timeout — rejects with Error("timeout") on expiry. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function logAuthSession(_event?: string, _details?: Record<string, unknown>) {}


function isExpired(session: Session | null) {
  return !!session?.expires_at && session.expires_at * 1000 <= Date.now();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [isOwner, setOwner] = useState(false);
  const [profile, setProfile] = useState<Omit<Database["public"]["Tables"]["profiles"]["Row"], "labor_rate"> | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [silentReLoginInFlight, setSilentReLoginInFlight] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const currentUserIdRef = useRef<string | null>(null);
  const roleRef = useRef<AppRole | null>(null);
  const lastKnownSessionRef = useRef<Session | null>(null);

  const explicitSignOutRef = useRef(false);
  const reLoginInFlightRef = useRef(false);
  const implicitSignOutRecoveryRef = useRef(false);
  const reconnectRef = useRef<() => void>(() => {});

  const TABLET_CRED_KEY = "an_tablet_cred";
  const DEACTIVATED_UNTIL_KEY = "an_account_deactivated_until";

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    if (session) lastKnownSessionRef.current = session;
  }, [session]);

  /** Race a promise against a hard timeout so a stalled silent re-login can
   *  never keep the boot spinner up indefinitely. */
  const raceWithFallback = <T, F = T>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> =>
    Promise.race([
      p,
      new Promise<F>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);


  /**
   * Keeps the shared-tablet stored refresh token equal to the session's current one.
   * Called from every place a session is accepted (sync, keep-alive, TOKEN_REFRESHED),
   * not only one listener branch: a refresh that lands in a path that skipped the cred
   * update leaves a stale snapshot, and re-using a rotated token is what makes Supabase
   * revoke the whole session. No-op when no tablet credential exists.
   */
  const keepTabletCredentialCurrent = (s: Session) => {
    if (!s.refresh_token) return;
    try {
      const raw = localStorage.getItem(TABLET_CRED_KEY);
      if (!raw) return;
      const cred = JSON.parse(raw) as { accountId?: string; refresh_token?: string };
      if (cred?.refresh_token && cred.refresh_token !== s.refresh_token) {
        localStorage.setItem(
          TABLET_CRED_KEY,
          JSON.stringify({ accountId: cred.accountId, refresh_token: s.refresh_token }),
        );
      }
    } catch { /* storage unavailable: nothing to keep */ }
  };

  const tryTabletRelogin = async (): Promise<boolean> => {
    if (reLoginInFlightRef.current) return false;
    // If the account was just deactivated, skip silent re-login for 60s.
    try {
      const until = Number(localStorage.getItem(DEACTIVATED_UNTIL_KEY) || 0);
      if (until && Date.now() < until) return false;
    } catch { /* ignore */ }

    let raw: string | null = null;
    try { raw = localStorage.getItem(TABLET_CRED_KEY); } catch { return false; }
    if (!raw) return false;

    let cred: { refresh_token?: string; email?: string } | null = null;
    try { cred = JSON.parse(raw); } catch { return false; }
    // Legacy credential shape (email+password) is no longer supported — wipe it.
    if (!cred?.refresh_token) {
      try { localStorage.removeItem(TABLET_CRED_KEY); } catch { /* ignore */ }
      return false;
    }

    reLoginInFlightRef.current = true;
    setSilentReLoginInFlight(true);
    logAuthSession("tablet refresh-token recovery started", {
      userId: currentUserIdRef.current,
    });
    try {
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: cred.refresh_token,
      });
      if (error || !data.session) {
        // Refresh token revoked/expired — wipe so we don't loop.
        try { localStorage.removeItem(TABLET_CRED_KEY); } catch { /* ignore */ }
        logAuthSession("tablet refresh-token recovery failed", {
          userId: currentUserIdRef.current,
          error: error?.message || "No session returned",
        });
        logSystemError("API_ERROR", `Tablet silent re-login failed: ${error?.message || "no session"} — dropped to login`, {
          metadata: { userId: currentUserIdRef.current },
        });
        return false;
      }
      // Rotate stored refresh_token to the new one.
      try {
        localStorage.setItem(
          TABLET_CRED_KEY,
          JSON.stringify({
            accountId: (cred as { accountId?: string }).accountId,
            refresh_token: data.session.refresh_token,
          }),
        );
      } catch { /* ignore */ }
      logAuthSession("tablet refresh-token recovery succeeded", {
        userId: data.session.user.id,
        expiresAt: data.session.expires_at,
      });
      return true;
    } catch (error) {
      logAuthSession("tablet refresh-token recovery threw", {
        userId: currentUserIdRef.current,
        error: error instanceof Error ? error.message : "unknown",
      });
      return false;
    } finally {
      reLoginInFlightRef.current = false;
      setSilentReLoginInFlight(false);
    }

  };

  const forceSignOutInactive = async () => {
    logAuthSession("forced signOut: account deactivated", {
      userId: currentUserIdRef.current,
    });
    try {
      // Suppress the silent-relogin path for a minute.
      localStorage.setItem(DEACTIVATED_UNTIL_KEY, String(Date.now() + 60_000));
      localStorage.removeItem(TABLET_CRED_KEY);
    } catch { /* ignore */ }
    explicitSignOutRef.current = true;
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    currentUserIdRef.current = null;
    lastKnownSessionRef.current = null;
    setSession(null);
    setUser(null);
    setRole(null);
    setOwner(false);
    setIsOwner(false);
    setProfile(null);
    toast.error("Your account has been deactivated. Contact your supervisor.");
    // Hard redirect to clear any in-memory state
    setTimeout(() => {
      window.location.replace("/login");
    }, 100);
  };

  const fetchUserData = async (userId: string) => {
    setRoleLoading(true);
    setAuthError(null);
    try {
      const result = await raceWithFallback(
        Promise.all([
          supabase
            .from("profiles")
            .select("id, name, email, shift, active, ui_preferences, last_seen_at, created_at, updated_at")
            .eq("id", userId)
            .single(),
          supabase.rpc("get_user_role", { _user_id: userId }),
          supabase.rpc("is_owner", { _uid: userId }),
        ]),
        12_000,
        null,
      );

      if (!result) {
        throw new Error("The backend is taking too long to load your access permissions.");
      }

      const [profileRes, roleRes, ownerRes] = result;
      // The owner check is a safety valve, not a gate: if it fails we simply do not
      // hand out the valve, and the role decides as usual.
      const owner = !ownerRes.error && ownerRes.data === true;
      setOwner(owner);
      setIsOwner(owner);
      if (profileRes.error) throw profileRes.error;
      if (roleRes.error) throw roleRes.error;

      if (profileRes.data) {
        // If account is deactivated, immediately sign out and bail
        if (profileRes.data.active === false) {
          await forceSignOutInactive();
          return;
        }
        setProfile(profileRes.data);
      }
      if (roleRes.data) {
        setRole(roleRes.data);
        setAuthError(null);
      } else {
        throw new Error("No access role is assigned to this account.");
      }
    } catch (error) {
      // keep existing role/profile on error
      if (!roleRef.current) {
        const message = error instanceof Error ? error.message : "Unable to load your access permissions.";
        setAuthError(message);
      }
    } finally {
      setRoleLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const clearAuthState = (reason: string) => {
      logAuthSession("clearing auth state", {
        reason,
        userId: currentUserIdRef.current,
        hadSession: !!lastKnownSessionRef.current,
      });
      currentUserIdRef.current = null;
      lastKnownSessionRef.current = null;
      setSession(null);
      setUser(null);
      setRole(null);
      setOwner(false);
      setIsOwner(false);
      setProfile(null);
      setAuthError(null);
    };

    const syncSessionUser = (newSession: Session) => {
      stopReconnecting();
      keepTabletCredentialCurrent(newSession);
      lastKnownSessionRef.current = newSession;
      setSession(newSession);
      setUser(newSession.user);
      setAuthError(null);
      const isNewUser = currentUserIdRef.current !== newSession.user.id;
      if (isNewUser) {
        currentUserIdRef.current = newSession.user.id;
        void fetchUserData(newSession.user.id);
      }
    };

    // While the stored session cannot be renewed for want of a network, retry on
    // a timer and as soon as the device says it is back online. supabase-js's own
    // auto-refresh ticker is also retrying; whichever succeeds first emits
    // TOKEN_REFRESHED, which lands in syncSessionUser below.
    let reconnectTimer: ReturnType<typeof setInterval> | null = null;
    const stopReconnecting = () => {
      if (reconnectTimer) clearInterval(reconnectTimer);
      reconnectTimer = null;
      window.removeEventListener("online", reconnectNow);
      setReconnecting(false);
    };
    const startReconnecting = () => {
      setReconnecting(true);
      if (reconnectTimer) return;
      reconnectTimer = setInterval(reconnectNow, 15_000);
      window.addEventListener("online", reconnectNow);
    };
    function reconnectNow() {
      void readStoredSession();
    }
    reconnectRef.current = reconnectNow;

    const readStoredSession = async () => {
      let result = null;
      try {
        result = await raceWithFallback(supabase.auth.getSession(), 10_000, null);
      } catch {
        result = null;
      }
      if (!mounted) return;
      const boot = classifyBootSession(result);
      if (boot.kind === "signed-in") {
        syncSessionUser(boot.session);
      } else if (boot.kind === "reconnecting") {
        startReconnecting();
      } else {
        // Nothing usable stored: attempt silent Tablet re-login before giving up.
        // Hard 5s timeout so a slow/stuck refresh never keeps the spinner up.
        const ok = await raceWithFallback(tryTabletRelogin(), 5000, false);
        if (!ok && mounted) {
          stopReconnecting();
          if (boot.kind === "ended") noteSessionEnded("expired");
          clearAuthState(`boot:${boot.kind}`);
        }
        // On success, the SIGNED_IN event will populate state.
      }
      setIsReady(true);
    };

    void readStoredSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;

      // SIGNED_OUT: if it was an explicit user/admin sign-out, clear and stop.
      // If it was a server-side token revocation on a shared Tablet account,
      // try to silently re-login using the persisted Tablet credentials so
      // the operator never bounces back to the login screen.
      if (event === "SIGNED_OUT") {
        const lastSession = lastKnownSessionRef.current;
        logAuthSession("SIGNED_OUT event received", {
          explicit: explicitSignOutRef.current,
          userId: currentUserIdRef.current,
          hadLastSession: !!lastSession,
          lastSessionExpired: isExpired(lastSession),
          inRecovery: implicitSignOutRecoveryRef.current,
        });

        if (explicitSignOutRef.current) {
          explicitSignOutRef.current = false;
          clearAuthState("explicit-sign-out");
          setIsReady(true);
          return;
        }
        if (implicitSignOutRecoveryRef.current) {
          logAuthSession("duplicate implicit SIGNED_OUT ignored during recovery", {
            userId: currentUserIdRef.current,
          });
          return;
        }
        // Implicit sign-out (revoked refresh token, expired session, etc.)
        void (async () => {
          implicitSignOutRecoveryRef.current = true;
          try {
            const ok = await raceWithFallback(tryTabletRelogin(), 5000, false);
            if (!mounted) return;
            if (ok) {
              setIsReady(true);
              return;
            }

            const stillValid = !!lastSession && !isExpired(lastSession);
            if (stillValid) {
              try {
                const restored = await raceWithFallback(
                  supabase.auth.setSession({
                    access_token: lastSession.access_token,
                    refresh_token: lastSession.refresh_token,
                  }),
                  10_000,
                  null,
                );
                if (!mounted) return;
                const restoredSession = restored?.data?.session;
                if (restoredSession?.user) {
                  logAuthSession("implicit SIGNED_OUT recovered from last valid session", {
                    userId: restoredSession.user.id,
                    expiresAt: restoredSession.expires_at,
                  });
                  syncSessionUser(restoredSession);
                  setIsReady(true);
                  return;
                }
                if (restored?.error) {
                  logAuthSession("last valid session restore returned error", {
                    userId: lastSession.user.id,
                    error: restored.error.message,
                  });
                }
              } catch (error) {
                logAuthSession("last valid session restore threw", {
                  userId: lastSession.user.id,
                  error: error instanceof Error ? error.message : "unknown",
                });
              }

              logAuthSession("implicit SIGNED_OUT ignored while access token is still valid", {
                userId: lastSession.user.id,
                expiresAt: lastSession.expires_at,
              });
              lastKnownSessionRef.current = lastSession;
              setSession(lastSession);
              setUser(lastSession.user);
              setAuthError("Session refresh was interrupted. Keeping the current session active.");
              setIsReady(true);
              return;
            }

            noteSessionEnded("expired");
            clearAuthState("implicit-sign-out:expired-or-unrecoverable");
            setIsReady(true);
          } finally {
            implicitSignOutRecoveryRef.current = false;
          }
          // If ok, the new SIGNED_IN event will re-populate state.
        })();

        return;
      }

      // Token refresh — just sync, never clear, and refetch profile only for a user not yet loaded
      if (event === "TOKEN_REFRESHED") {
        if (newSession) {
          if (currentUserIdRef.current !== newSession.user.id) {
            // A refresh that lands after a boot that could not reach the server:
            // this is the moment the session is restored, so load role and profile.
            syncSessionUser(newSession);
            setIsReady(true);
          } else {
            lastKnownSessionRef.current = newSession;
            setSession(newSession);
            setUser(newSession.user);
          }
          // Keep the shared-tablet stored credential in sync with the rotated
          // refresh_token. Supabase rotates it every ~1h; without this the stored
          // an_tablet_cred token goes stale, so a later silent re-login uses an
          // already-rotated token — which Supabase rejects (reuse detection can
          // revoke the whole session) and the tablet drops to /login. Only touch
          // it when a tablet credential exists.
          if (newSession.refresh_token) {
            try {
              const raw = localStorage.getItem(TABLET_CRED_KEY);
              if (raw) {
                const cred = JSON.parse(raw) as { accountId?: string; refresh_token?: string };
                if (cred?.refresh_token && cred.refresh_token !== newSession.refresh_token) {
                  localStorage.setItem(
                    TABLET_CRED_KEY,
                    JSON.stringify({ accountId: cred.accountId, refresh_token: newSession.refresh_token }),
                  );
                }
              }
            } catch { /* ignore */ }
          }
        }
        // If refresh produced no session, do NOT clear — keep current state.
        // Supabase will retry; clearing here causes spurious logouts on tab switch.
        return;
      }

      // INITIAL_SESSION with no session: do NOT clear if we already have a user.
      // This event fires on tab focus/visibility changes and can spuriously be null.
      if (event === "INITIAL_SESSION" && !newSession && currentUserIdRef.current) {
        return;
      }

      // Sign-in, user updated, or initial session with valid user
      if (newSession?.user) {
        syncSessionUser(newSession);
        if (event === "USER_UPDATED") {
          void fetchUserData(newSession.user.id);
        }
      }
      setIsReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (reconnectTimer) clearInterval(reconnectTimer);
      window.removeEventListener("online", reconnectNow);
    };
  }, []);

  // Proactive keep-alive: every 5 min, force a session check so refresh tokens
  // rotate well before expiry (defends against tablets that sleep for hours).
  // Also wake-up listener on tab visibility change.
  useEffect(() => {
    let mounted = true;
    const ping = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        // If supabase already has a fresh session, sync it silently.
        if (data.session) {
          keepTabletCredentialCurrent(data.session);
          lastKnownSessionRef.current = data.session;
          setSession(data.session);
          setUser(data.session.user);
        }
      } catch {
        // Network blip — keep current state, never clear.
      }
    };
    const interval = setInterval(ping, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Realtime: if admin deactivates this user's profile while logged in, sign out instantly.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`profile-active-watch-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const newActive = (payload.new as { active?: boolean } | null)?.active;
          if (newActive === false) {
            void forceSignOutInactive();
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const signOut = async (reason = "user-requested") => {
    // Mark this as an explicit user-initiated sign-out so the SIGNED_OUT
    // listener does not attempt a silent Tablet re-login.
    logAuthSession("explicit signOut requested", {
      reason,
      userId: currentUserIdRef.current,
      stack: new Error().stack,
    });
    explicitSignOutRef.current = true;
    clearSessionEndNotice();
    try {
      // Wipe persisted Tablet credentials on explicit sign-out only.
      localStorage.removeItem("an_tablet_cred");
    } catch { /* ignore */ }
    await releaseThisDevicePush();
    // The Home Screen icon must not keep showing the last person's unread count.
    try {
      void (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.().catch(() => {});
    } catch { /* no badging here */ }
    // `local` ends this device's session, on the server too. The default, `global`,
    // revoked every session the account had, so signing out of the office PC also
    // signed the same person out of their phone, and one tablet signing out of a
    // shared line account signed out every other tablet on it.
    await supabase.auth.signOut({ scope: "local" });
    currentUserIdRef.current = null;
    lastKnownSessionRef.current = null;
    setSession(null);
    setUser(null);
    setRole(null);
    setOwner(false);
    setIsOwner(false);
    setProfile(null);
    setAuthError(null);
    setReconnecting(false);
  };

  const retryAuth = async () => {
    setAuthError(null);
    const activeUserId = currentUserIdRef.current || user?.id;
    if (activeUserId) {
      await fetchUserData(activeUserId);
      return;
    }

    reconnectRef.current();
  };

  // Loading is only true on initial boot, never during token refreshes
  const loading = !isReady || (!!session && !role && roleLoading);

  return (
    <AuthContext.Provider value={{ session, user, role, isOwner, profile, loading, authError, silentReLoginInFlight, reconnecting, retryAuth, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
