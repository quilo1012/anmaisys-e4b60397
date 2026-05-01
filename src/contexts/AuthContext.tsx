import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";

type AppRole = Database["public"]["Enums"]["app_role"];

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  profile: Omit<Database["public"]["Tables"]["profiles"]["Row"], "labor_rate"> | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  role: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [profile, setProfile] = useState<Omit<Database["public"]["Tables"]["profiles"]["Row"], "labor_rate"> | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);
  const currentUserIdRef = useRef<string | null>(null);

  const explicitSignOutRef = useRef(false);
  const reLoginInFlightRef = useRef(false);

  const TABLET_CRED_KEY = "an_tablet_cred";
  const DEACTIVATED_UNTIL_KEY = "an_account_deactivated_until";

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

    let cred: { email?: string; password?: string } | null = null;
    try { cred = JSON.parse(raw); } catch { return false; }
    if (!cred?.email || !cred?.password) return false;

    reLoginInFlightRef.current = true;
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: cred.email,
        password: cred.password,
      });
      if (error) {
        // Bad credentials — wipe the stored creds so we don't loop.
        try { localStorage.removeItem(TABLET_CRED_KEY); } catch { /* ignore */ }
        return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      reLoginInFlightRef.current = false;
    }
  };

  const forceSignOutInactive = async () => {
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
    setSession(null);
    setUser(null);
    setRole(null);
    setProfile(null);
    toast.error("Your account has been deactivated. Contact your supervisor.");
    // Hard redirect to clear any in-memory state
    setTimeout(() => {
      window.location.replace("/login");
    }, 100);
  };

  const fetchUserData = async (userId: string) => {
    setRoleLoading(true);
    try {
      const [profileRes, roleRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, name, email, shift, active, ui_preferences, last_seen_at, created_at, updated_at")
          .eq("id", userId)
          .single(),
        supabase.rpc("get_user_role", { _user_id: userId }),
      ]);
      if (profileRes.data) {
        // If account is deactivated, immediately sign out and bail
        if (profileRes.data.active === false) {
          await forceSignOutInactive();
          return;
        }
        setProfile(profileRes.data);
      }
      if (roleRes.data) setRole(roleRes.data);
    } catch {
      // keep existing role/profile on error
    } finally {
      setRoleLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const clearAuthState = () => {
      currentUserIdRef.current = null;
      setSession(null);
      setUser(null);
      setRole(null);
      setProfile(null);
    };

    const syncSessionUser = (newSession: Session) => {
      setSession(newSession);
      setUser(newSession.user);
      const isNewUser = currentUserIdRef.current !== newSession.user.id;
      if (isNewUser) {
        currentUserIdRef.current = newSession.user.id;
        void fetchUserData(newSession.user.id);
      }
    };

    const initializeAuth = async () => {
      // Try to get the current session first
      let { data: { session: currentSession } } = await supabase.auth.getSession();

      // If no session but tokens may exist (failed refresh), attempt explicit refresh
      // This handles transient refresh-token failures across tabs/devices without logging out
      if (!currentSession) {
        try {
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed?.session) currentSession = refreshed.session;
        } catch {
          // Refresh failed (no token at all) — user is genuinely logged out
        }
      }

      if (!mounted) return;

      if (currentSession?.user) {
        syncSessionUser(currentSession);
      } else {
        clearAuthState();
      }
      setIsReady(true);
    };

    void initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;

      // SIGNED_OUT: if it was an explicit user/admin sign-out, clear and stop.
      // If it was a server-side token revocation on a shared Tablet account,
      // try to silently re-login using the persisted Tablet credentials so
      // the operator never bounces back to the login screen.
      if (event === "SIGNED_OUT") {
        if (explicitSignOutRef.current) {
          explicitSignOutRef.current = false;
          clearAuthState();
          setIsReady(true);
          return;
        }
        // Implicit sign-out (revoked refresh token, expired session, etc.)
        void (async () => {
          const ok = await tryTabletRelogin();
          if (!ok) {
            clearAuthState();
            setIsReady(true);
          }
          // If ok, the new SIGNED_IN event will re-populate state.
        })();
        return;
      }

      // Token refresh — just sync, never refetch profile or clear
      if (event === "TOKEN_REFRESHED") {
        if (newSession) {
          setSession(newSession);
          setUser(newSession.user);
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

  const signOut = async () => {
    // Mark this as an explicit user-initiated sign-out so the SIGNED_OUT
    // listener does not attempt a silent Tablet re-login.
    explicitSignOutRef.current = true;
    try {
      // Wipe persisted Tablet credentials on explicit sign-out only.
      localStorage.removeItem("an_tablet_cred");
    } catch { /* ignore */ }
    await supabase.auth.signOut();
    currentUserIdRef.current = null;
    setSession(null);
    setUser(null);
    setRole(null);
    setProfile(null);
  };

  // Loading is only true on initial boot, never during token refreshes
  const loading = !isReady || (!!session && !role && roleLoading);

  return (
    <AuthContext.Provider value={{ session, user, role, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
