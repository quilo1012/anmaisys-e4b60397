import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  profile: Database["public"]["Tables"]["profiles"]["Row"] | null;
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
  const [profile, setProfile] = useState<Database["public"]["Tables"]["profiles"]["Row"] | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);
  const currentUserIdRef = useRef<string | null>(null);

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
      if (profileRes.data) setProfile(profileRes.data);
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
      const { data: { session: currentSession } } = await supabase.auth.getSession();
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

      // Only explicit sign out clears state
      if (event === "SIGNED_OUT") {
        clearAuthState();
        setIsReady(true);
        return;
      }

      // Token refresh — just sync, never refetch profile or clear
      if (event === "TOKEN_REFRESHED") {
        if (newSession) {
          setSession(newSession);
          setUser(newSession.user);
        }
        return;
      }

      // Initial session, sign-in, user updated
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

  const signOut = async () => {
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
