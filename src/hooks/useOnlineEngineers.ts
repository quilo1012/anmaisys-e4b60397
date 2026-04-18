import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface OnlineEngineer {
  id: string;
  name: string;
  last_seen_at: string;
}

interface PresencePayload {
  user_id: string;
  name: string;
  role: string;
  online_at: string;
}

/**
 * Tracks online engineers via Supabase Realtime Presence.
 * - Engineers broadcast their presence on this channel.
 * - Admins/managers (and anyone subscribed) read the presence state.
 */
export function useOnlineEngineers() {
  const { user, role, profile } = useAuth();
  const [engineers, setEngineers] = useState<OnlineEngineer[]>([]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase.channel("engineers-online", {
      config: { presence: { key: user.id } },
    });

    const syncState = () => {
      const state = channel.presenceState<PresencePayload>();
      const flat = Object.values(state).flat() as PresencePayload[];
      const onlyEngineers = flat.filter((p) => p.role === "engineer");
      // Dedup by user_id (a user could have multiple tabs)
      const map = new Map<string, OnlineEngineer>();
      for (const p of onlyEngineers) {
        map.set(p.user_id, {
          id: p.user_id,
          name: p.name,
          last_seen_at: p.online_at,
        });
      }
      setEngineers(Array.from(map.values()));
    };

    channel
      .on("presence", { event: "sync" }, syncState)
      .on("presence", { event: "join" }, syncState)
      .on("presence", { event: "leave" }, syncState)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && role === "engineer") {
          await channel.track({
            user_id: user.id,
            name: profile?.name ?? user.email ?? "Engineer",
            role,
            online_at: new Date().toISOString(),
          } satisfies PresencePayload);
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [user, role, profile?.name]);

  return { data: engineers };
}
