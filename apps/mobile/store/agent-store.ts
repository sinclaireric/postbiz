import { create } from "zustand";

import { demoReply } from "@/lib/agent-demo";
import type { AgentMessage, AgentProposal, AgentThread, AgentToolName } from "@/lib/agent-protocol";
import {
  agentErrorMessage,
  deleteThread,
  listThreads,
  loadThread,
  NOT_CONFIGURED,
  agentConfigured,
  streamAgentChat,
  type ProposalUpdate,
} from "@/lib/agent";
import { DEMO } from "@/lib/demo";
import { mediaByIds, type MediaItem } from "@/lib/media";
import { useAuthStore } from "@/store/auth-store";
import { useOrgStore } from "@/store/org-store";
import type { Channel } from "@/types";
import { uuidv4 } from "@/utils/uuid";

// Conversations de l'agent. Les données sont celles du web (tables `agent_threads` et `agent_messages`, RLS) ; la réponse de l'agent vient de la route du web.
// En mode démo (EXPO_PUBLIC_DEMO=1), la réponse est simulée et les conversations ne vivent qu'en mémoire.

export type AgentRun = { text: string; tool: AgentToolName | null };

type SendInput = {
  text: string;
  /** Les canaux que l'agent a le droit d'utiliser (ceux que l'utilisateur a cochés). */
  channels: Channel[];
  media: MediaItem[];
};

type AgentState = {
  threads: AgentThread[];
  threadsLoaded: boolean;
  activeId: string | null;
  messages: AgentMessage[];
  /** Médias cités par la conversation (pièces jointes et publications préparées), avec leurs URL signées du moment. */
  media: Record<string, MediaItem>;
  /** Le message qui vient d'être envoyé, affiché avant que la réponse n'arrive. */
  pendingUser: AgentMessage | null;
  /** La réponse en cours d'écriture ; null quand l'agent ne travaille pas. */
  run: AgentRun | null;
  error: string | null;

  loadThreads: () => Promise<void>;
  openThread: (id: string) => Promise<void>;
  newThread: () => void;
  /** Rend vrai si l'échange est enregistré ; faux sinon (le message doit alors revenir dans le champ de saisie). */
  send: (input: SendInput) => Promise<boolean>;
  stop: () => void;
  removeThread: (id: string) => Promise<void>;
  addMedia: (items: MediaItem[]) => void;
  /** Après l'enregistrement de publications dans le calendrier : leur état change dans la conversation. */
  applySaved: (messageId: string, updates: ProposalUpdate[]) => void;
  clearError: () => void;
  reset: () => void;
};

const TITLE_MAX = 80;
const title = (text: string) => {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_MAX ? `${oneLine.slice(0, TITLE_MAX - 1).trimEnd()}…` : oneLine;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Conversations du mode démo : en mémoire, perdues à la fermeture de l'application. */
const demoMessages = new Map<string, AgentMessage[]>();

let controller: AbortController | null = null;

const initial = { threads: [], threadsLoaded: false, activeId: null, messages: [], media: {}, pendingUser: null, run: null, error: null } satisfies Partial<AgentState>;

export const useAgentStore = create<AgentState>((set, get) => {
  /** Ajoute au dictionnaire les médias dont les messages ont besoin, relus dans la médiathèque (URL signées). */
  const fetchMedia = async (messages: AgentMessage[]) => {
    const org = useOrgStore.getState().current;
    if (!org || DEMO) return;
    const known = get().media;
    const wanted = [...new Set(messages.flatMap((m) => [...m.mediaIds, ...m.proposals.flatMap((p) => p.mediaIds)]))].filter((id) => !known[id]);
    if (wanted.length === 0) return;
    const items = await mediaByIds(org.id, wanted).catch(() => [] as MediaItem[]);
    get().addMedia(items);
  };

  const finish = (patch: Partial<AgentState> = {}) => set({ run: null, pendingUser: null, ...patch });

  return {
    ...initial,

    loadThreads: async () => {
      const org = useOrgStore.getState().current;
      const user = useAuthStore.getState().user;
      if (DEMO || !org || !user) return set({ threadsLoaded: true });
      set({ threads: await listThreads(org.id, user.id).catch(() => []), threadsLoaded: true });
    },

    openThread: async (id) => {
      const org = useOrgStore.getState().current;
      const user = useAuthStore.getState().user;
      get().stop();
      if (DEMO) {
        const messages = demoMessages.get(id);
        if (messages) set({ activeId: id, messages, error: null });
        return;
      }
      if (!org || !user) return;
      const found = await loadThread(org.id, user.id, id).catch(() => null);
      if (!found) return set({ error: agentErrorMessage("not_found") });
      set({ activeId: found.thread.id, messages: found.messages, error: null });
      await fetchMedia(found.messages);
    },

    newThread: () => {
      get().stop();
      set({ activeId: null, messages: [], pendingUser: null, run: null, error: null });
    },

    send: async ({ text, channels, media: attached }) => {
      if (get().run) return false;
      const org = useOrgStore.getState().current;
      const user = useAuthStore.getState().user;
      if (!org || !user) {
        set({ error: agentErrorMessage("forbidden") });
        return false;
      }
      if (!DEMO && !agentConfigured()) {
        set({ error: NOT_CONFIGURED });
        return false;
      }

      get().addMedia(attached);
      set({
        error: null,
        pendingUser: { id: "pending", role: "user", text, proposals: [], mediaIds: attached.map((m) => m.id), createdAt: new Date().toISOString() },
        run: { text: "", tool: null },
      });
      const mine = (controller = new AbortController());

      if (DEMO) {
        // Réponse simulée : la même mise en forme que le vrai agent, sans appel à l'IA.
        await wait(500);
        if (mine.signal.aborted) return (finish(), false);
        const reply = demoReply(text, channels.map((c) => ({ id: c.id, name: c.name, network: c.network })), new Date(), uuidv4);
        const at = Date.now();
        const user_: AgentMessage = { id: uuidv4(), role: "user", text, proposals: [], mediaIds: attached.map((m) => m.id), createdAt: new Date(at).toISOString() };
        const agent_: AgentMessage = { id: uuidv4(), role: "assistant", text: reply.text, proposals: reply.proposals as AgentProposal[], mediaIds: [], createdAt: new Date(at + 1).toISOString() };
        const id = get().activeId ?? uuidv4();
        const messages = [...(demoMessages.get(id) ?? []), user_, agent_];
        demoMessages.set(id, messages);
        const thread: AgentThread = { id, title: get().threads.find((t) => t.id === id)?.title ?? title(text), updatedAt: agent_.createdAt };
        finish({ activeId: id, messages, threads: [thread, ...get().threads.filter((t) => t.id !== id)] });
        return true;
      }

      let failure: string | null = null;
      let saved = false;
      await streamAgentChat(
        {
          threadId: get().activeId,
          message: text,
          channelIds: channels.map((c) => c.id),
          mediaIds: attached.map((m) => m.id),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        },
        (event) => {
          if (event.type === "text") set((s) => ({ run: s.run ? { text: s.run.text + event.delta, tool: null } : s.run }));
          else if (event.type === "tool") set((s) => ({ run: s.run ? { ...s.run, tool: event.name } : s.run }));
          else if (event.type === "done") {
            saved = true;
            // Le message enregistré remplace la réponse en cours d'affichage dans le même rendu : pas de doublon un instant.
            set((s) => ({
              messages: [...s.messages, event.user, event.assistant],
              threads: [event.thread, ...s.threads.filter((t) => t.id !== event.thread.id)],
              activeId: event.thread.id,
              run: null,
              pendingUser: null,
            }));
          } else if (event.type === "error") failure = agentErrorMessage(event.code);
        },
        mine.signal,
      );

      if (saved) {
        await fetchMedia(get().messages.slice(-2));
        return true;
      }
      // Rien n'a été enregistré : le message revient dans le champ, prêt à être renvoyé.
      finish(failure ? { error: failure } : {});
      return false;
    },

    stop: () => {
      controller?.abort();
      controller = null;
      finish();
    },

    removeThread: async (id) => {
      const org = useOrgStore.getState().current;
      const user = useAuthStore.getState().user;
      if (DEMO) demoMessages.delete(id);
      else if (!org || !user || !(await deleteThread(org.id, user.id, id))) return set({ error: agentErrorMessage("failed") });
      set((s) => ({ threads: s.threads.filter((t) => t.id !== id) }));
      if (get().activeId === id) get().newThread();
    },

    addMedia: (items) => set((s) => ({ media: { ...s.media, ...Object.fromEntries(items.map((m) => [m.id, m])) } })),

    applySaved: (messageId, updates) => {
      const patch = (messages: AgentMessage[]) =>
        messages.map((m) => (m.id !== messageId ? m : { ...m, proposals: m.proposals.map((p) => { const u = updates.find((x) => x.id === p.id); return u ? { ...p, ...u } : p; }) }));
      set((s) => ({ messages: patch(s.messages) }));
      const id = get().activeId;
      if (DEMO && id) demoMessages.set(id, patch(demoMessages.get(id) ?? []));
    },

    clearError: () => set({ error: null }),

    reset: () => {
      controller?.abort();
      controller = null;
      demoMessages.clear();
      set({ ...initial });
    },
  };
});
