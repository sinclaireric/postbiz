import type { VideoJobRecord } from '@/lib/data/types';
import type { AgentVideoJob } from './types';

/** Une tâche vidéo telle que le navigateur et le mobile la voient : sans l'identifiant chez le fournisseur ni l'état interne de la prise en charge. */
export const publicJob = (r: VideoJobRecord): AgentVideoJob => ({ id: r.id, status: r.status, orientation: r.orientation, prompt: r.prompt, mediaId: r.mediaId, error: r.error, createdAt: r.createdAt });
