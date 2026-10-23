'use server';

import { revalidatePath } from 'next/cache';
import { getRepositories, getSession } from '@/lib/data';
import type { MediaItem, MediaRemoval } from '@/lib/data/types';
import { MEDIA_PAGE_SIZE } from '@/lib/media/logic';

export interface MediaListing {
  items: MediaItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** Une page de la bibliothèque, avec des URL signées neuves (elles expirent) ; `null` si la session n'est plus valide. */
export async function listMediaAction(input: { page: number; search: string }): Promise<MediaListing | null> {
  const session = await getSession();
  if (session.status !== 'ready') return null;
  const repos = await getRepositories(session.ctx);
  const page = Math.max(1, Math.floor(Number(input.page)) || 1);
  const { items, total } = await repos.media.list({ page, pageSize: MEDIA_PAGE_SIZE, search: String(input.search ?? '').slice(0, 100) });
  return { items, total, page, pageSize: MEDIA_PAGE_SIZE };
}

/** Médias demandés par identifiant (par exemple ceux d'une publication à rouvrir). */
export async function mediaByIdsAction(ids: string[]): Promise<MediaItem[]> {
  const session = await getSession();
  if (session.status !== 'ready' || !Array.isArray(ids)) return [];
  const repos = await getRepositories(session.ctx);
  return repos.media.byIds(ids.filter((i): i is string => typeof i === 'string').slice(0, 50));
}

/** Supprime des médias, sauf ceux qu'une publication en attente utilise (renvoyés dans `blocked`). Réservé aux membres qui peuvent écrire. */
export async function deleteMediaAction(ids: string[]): Promise<MediaRemoval | { error: true }> {
  const session = await getSession();
  if (session.status !== 'ready' || session.ctx.org.role === 'viewer' || !Array.isArray(ids)) return { error: true };
  const repos = await getRepositories(session.ctx);
  const result = await repos.media.remove(ids.filter((i): i is string => typeof i === 'string').slice(0, 100));
  revalidatePath('/app/medias');
  return result;
}
