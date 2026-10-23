import { create } from "zustand";

import { supabase } from "@/lib/supabase";
import type { Channel, ChannelNetwork } from "@/types";

type ChannelsState = {
  channels: Channel[];
  loaded: boolean;
  error: string | null;

  /** Lecture seule : les canaux sont créés par le callback OAuth (service_role), jamais par le client. */
  load: (orgId: string) => Promise<void>;
  reset: () => void;
};

export const useChannelsStore = create<ChannelsState>((set) => ({
  channels: [],
  loaded: false,
  error: null,

  load: async (orgId) => {
    const { data, error } = await supabase
      .from("integrations")
      .select("id, provider, name, username, picture_url, status")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });
    if (error) {
      set({ error: "Impossible de charger les canaux.", loaded: true });
      return;
    }
    set({
      loaded: true,
      error: null,
      channels: (data ?? []).map((i) => ({
        id: i.id as string,
        name: i.name as string,
        network: i.provider as ChannelNetwork,
        avatar: (i.picture_url as string | null) ?? "",
        username: i.username as string | null,
        status: i.status as Channel["status"],
      })),
    });
  },

  reset: () => set({ channels: [], loaded: false, error: null }),
}));
