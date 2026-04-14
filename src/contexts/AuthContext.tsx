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
    let mounted = true;

    // 1. Set up listener FIRST — INITIAL_SESSION is the authoritative event
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;

        if (event === "SIGNED_OUT") {
          setSession(null);
          setUser(null);
          setRole(null);
          setProfile(null);
          setIsReady(true);
          return;
        }

        if (newSession?.user) {
          setSession(newSession);
          setUser(newSession.user);

          if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
            // Use setTimeout to avoid Supabase auth deadlock
            setTimeout(() => {
              if (mounted) {
                fetchUserData(newSession.user.id).finally(() => {
                  if (mounted) setIsReady(true);
                });
              }
            }, 0);
          } else if (event === "TOKEN_REFRESHED") {
            // Just update session, keep existing role/profile
            setIsReady(true);
          }
        } else if (event === "INITIAL_SESSION" && !newSession) {
          // No stored session — user is not logged in
          setIsReady(true);
        }
      }
    );

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
