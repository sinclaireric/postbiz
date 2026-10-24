import type { MediaItem } from '@/lib/data/types';
import type { AgentMedia } from './types';

/** Un média de la bibliothèque tel que l'agent et les cartes le montrent (l'image elle-même seulement pour une image, comme dans le calendrier). */
export const toAgentMedia = (m: MediaItem): AgentMedia => ({
  id: m.id, kind: m.kind, name: m.name, alt: m.alt, url: m.kind === 'image' ? m.url : null,
  thumbUrl: m.thumbUrl ?? (m.kind === 'image' ? m.url : null), durationSeconds: m.durationSeconds,
});
