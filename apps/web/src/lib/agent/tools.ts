import type { IntegrationItem, MediaItem, Repositories } from '@/lib/data/types';
import { networkName } from '@/lib/networks';
import type { AgentToolbox } from './run';
import { utcToLocal } from './time';

const MAX_POSTS = 30;
const MAX_MEDIA = 18;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Les outils de lecture de l'agent, au-dessus des dépôts de données de l'utilisateur connecté. Rien n'est écrit ici, et rien ne passe
 * par une autre voie que ces dépôts : la RLS de la base reste la seule autorité sur ce que l'agent voit.
 */
export function createToolbox(repos: Pick<Repositories, 'posts' | 'media'>, integrations: readonly IntegrationItem[], timeZone: string, now: Date): AgentToolbox {
  const channelName = new Map(integrations.map((i) => [i.id, `${networkName(i.networkId)} "${i.name}"`]));
  const today = utcToLocal(now, timeZone).slice(0, 10);

  return {
    async listPosts({ from, to, channelId }) {
      const start = from && DAY.test(from) ? from : today;
      const end = to && DAY.test(to) ? to : shiftDay(start, 30);
      const posts = (await repos.posts.list())
        .filter((p) => p.publishAt && (!channelId || p.integrationId === channelId))
        .map((p) => ({ post: p, local: utcToLocal(p.publishAt!, timeZone) }))
        .filter(({ local }) => local.slice(0, 10) >= start && local.slice(0, 10) <= end)
        .sort((a, b) => a.local.localeCompare(b.local));
      return {
        window: { from: start, to: end, timezone: timeZone },
        total: posts.length,
        posts: posts.slice(0, MAX_POSTS).map(({ post, local }) => ({
          channel_id: post.integrationId, channel: channelName.get(post.integrationId) ?? `${networkName(post.networkId)} "${post.accountName}"`,
          state: post.state, publish_at_local: local, text: clip(post.content, 160), media: post.media.length,
        })),
      };
    },

    async listMedia({ search }) {
      const { items, total } = await repos.media.list({ page: 1, pageSize: MAX_MEDIA, search });
      return {
        items,
        text: { total, shown: items.length, media: items.map((m) => ({ id: m.id, name: m.name, kind: m.kind, width: m.width, height: m.height, ...(m.alt ? { alt: clip(m.alt, 120) } : {}) })) },
      };
    },

    mediaByIds: (ids: string[]): Promise<MediaItem[]> => repos.media.byIds(ids),
  };
}
