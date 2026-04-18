import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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

  const fetchUserData = async (userId: string) => {
    setRoleLoading(true);
    setRole(null);
    setProfile(null);

    try {
      const [profileRes, roleRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).single(),
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
      setSession(null);
      setUser(null);
      setRole(null);
      setProfile(null);
    };

    const initializeAuth = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();

      if (!mounted) return;

      if (currentSession?.user) {
        setSession(currentSession);
        setUser(currentSession.user);
        void fetchUserData(currentSession.user.id);
      } else {
        clearAuthState();
      }

      setIsReady(true);
    };

    void initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;

      // Explicit sign out only
      if (event === "SIGNED_OUT") {
        clearAuthState();
        setIsReady(true);
        return;
      }

      // Token refresh / initial session — just sync, never clear or refetch role
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        if (newSession?.user) {
          setSession(newSession);
          setUser(newSession.user);
        }
        setIsReady(true);
        return;
      }

      // Real sign-in or user updated — sync session and refetch profile/role
      if (newSession?.user) {
        const userChanged = newSession.user.id !== user?.id;
        setSession(newSession);
        setUser(newSession.user);
        if (event === "SIGNED_IN" && userChanged) {
          void fetchUserData(newSession.user.id);
        } else if (event === "USER_UPDATED") {
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
    setSession(null);
    setUser(null);
    setRole(null);
    setProfile(null);
  };

  const loading = !isReady || roleLoading;

  return (
    <AuthContext.Provider value={{ session, user, role, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
