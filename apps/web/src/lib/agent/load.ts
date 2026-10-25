import type { Repositories } from '@/lib/data/types';
import { publicJob } from './job';
import { toAgentMedia } from './media';
import type { AgentMedia, AgentMessage, AgentThread, AgentVideoJob } from './types';

export interface LoadedThread {
  thread: AgentThread;
  messages: AgentMessage[];
  /** Médias cités par la conversation (pièces jointes et publications préparées), avec leurs URL signées du moment. */
  media: AgentMedia[];
  /** Les vidéos lancées par la conversation, dans leur état du moment. */
  jobs: AgentVideoJob[];
}

/** Une conversation et les médias qu'elle montre : les URL signées sont temporaires, elles ne sont jamais gardées avec les messages. */
export async function loadThread(repos: Pick<Repositories, 'agent' | 'media' | 'generation'>, id: string): Promise<LoadedThread | null> {
  const found = await repos.agent.thread(id);
  if (!found) return null;
  const records = await repos.generation.jobs([...new Set(found.messages.flatMap((m) => m.jobIds))]);
  const ids = [...new Set([...found.messages.flatMap((m) => [...m.mediaIds, ...m.proposals.flatMap((p) => p.mediaIds)]), ...records.flatMap((j) => (j.mediaId ? [j.mediaId] : []))])];
  const media = ids.length > 0 ? (await repos.media.byIds(ids)).map(toAgentMedia) : [];
  return { ...found, media, jobs: records.map(publicJob) };
}
