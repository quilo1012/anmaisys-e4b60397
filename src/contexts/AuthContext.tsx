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
    // 1. Restore session from storage first
    supabase.auth.getSession().then(({ data: { session: restored } }) => {
      setSession(restored);
      setUser(restored?.user ?? null);
      if (restored?.user) {
        fetchUserData(restored.user.id).finally(() => setIsReady(true));
      } else {
        setIsReady(true);
      }
    });

    // 2. Listen for subsequent changes (token refresh, sign-in, sign-out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (event === "INITIAL_SESSION") {
          // Already handled by getSession above — skip
          return;
        }

        if (event === "SIGNED_OUT") {
          setSession(null);
          setUser(null);
          setRole(null);
          setProfile(null);
          return;
        }

        if (newSession?.user) {
          setSession(newSession);
          setUser(newSession.user);
          // Refresh role data on new sign-in or token refresh
          if (event === "SIGNED_IN") {
            setTimeout(() => fetchUserData(newSession.user.id), 0);
          }
        }
      }
    );

    return () => subscription.unsubscribe();
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
