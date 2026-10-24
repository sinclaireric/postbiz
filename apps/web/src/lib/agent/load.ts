import type { Repositories } from '@/lib/data/types';
import { toAgentMedia } from './media';
import type { AgentMedia, AgentMessage, AgentThread } from './types';

export interface LoadedThread {
  thread: AgentThread;
  messages: AgentMessage[];
  /** Médias cités par la conversation (pièces jointes et publications préparées), avec leurs URL signées du moment. */
  media: AgentMedia[];
}

/** Une conversation et les médias qu'elle montre : les URL signées sont temporaires, elles ne sont jamais gardées avec les messages. */
export async function loadThread(repos: Pick<Repositories, 'agent' | 'media'>, id: string): Promise<LoadedThread | null> {
  const found = await repos.agent.thread(id);
  if (!found) return null;
  const ids = [...new Set(found.messages.flatMap((m) => [...m.mediaIds, ...m.proposals.flatMap((p) => p.mediaIds)]))];
  const media = ids.length > 0 ? (await repos.media.byIds(ids)).map(toAgentMedia) : [];
  return { ...found, media };
}
