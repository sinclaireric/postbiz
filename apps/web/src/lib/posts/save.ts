import type { T } from '@/i18n/types';
import type { Repositories } from '@/lib/data/types';
import { errorText } from '@/lib/form-error';
import { supportsFirstComment, validatePost, type PostMode } from '@/lib/posts/logic';

export interface SavePostRequest {
  content: string;
  /** Les canaux visés : une publication par canal, toutes avec le même texte et les mêmes médias. */
  integrationIds: string[];
  /** Date de publication (ISO ou valeur de champ datetime-local déjà convertie) ; vide pour un brouillon sans date. */
  publishAt: string | null;
  mode: PostMode;
  firstComment: string;
  /** Médias joints, dans l'ordre d'affichage : seul l'identifiant (et le texte alternatif) vient de l'appelant. */
  media: { id: string; alt: string }[];
}

export type SavePostResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Enregistre une publication (brouillon ou programmée) avec toutes les règles de l'application : canaux actifs, médias de la bibliothèque,
 * limites par réseau, premier commentaire, date. Utilisé par le composeur du calendrier et par l'agent : une seule voie d'écriture, celle de
 * l'utilisateur connecté (la RLS de la base reste l'autorité). Le rôle de l'utilisateur (lecteur) est vérifié par l'appelant.
 */
export async function savePost(repos: Repositories, t: T, req: SavePostRequest): Promise<SavePostResult> {
  // Le type et les dimensions des médias viennent de la bibliothèque, jamais du navigateur.
  const library = await repos.media.byIds(req.media.map((m) => m.id));
  if (library.length !== req.media.length) return { ok: false, errors: [t('app.validation.mediaMissing')] };
  const attached = req.media.map((m, i) => ({ id: m.id, kind: library[i]!.kind, alt: m.alt }));
  const checked = req.media.map((_, i) => ({ kind: library[i]!.kind, width: library[i]!.width, height: library[i]!.height, name: library[i]!.name }));

  const integrations = await repos.workspace.integrations();
  const chosen = integrations.filter((i) => req.integrationIds.includes(i.id));
  const inactive = chosen.filter((i) => i.status !== 'active');
  if (inactive.length > 0) return { ok: false, errors: [t('app.composer.errReconnect', { names: inactive.map((i) => i.name).join(', ') })] };

  const errors = validatePost({ content: req.content, networkIds: chosen.map((i) => i.networkId), publishAt: req.publishAt, mode: req.mode, firstComment: req.firstComment, media: checked });
  if (errors.length > 0) return { ok: false, errors: errors.map((e) => errorText(t, e)) };

  const res = await repos.posts.create({
    // Le premier commentaire part avec les canaux qui savent le publier ; les autres reçoivent la publication seule.
    targets: chosen.map((i) => ({ integrationId: i.id, firstComment: req.firstComment && supportsFirstComment(i.networkId) ? req.firstComment : null })),
    content: req.content,
    media: attached,
    publishAt: req.publishAt ? new Date(req.publishAt).toISOString() : null,
    mode: req.mode,
  });
  if (!res.ok) return { ok: false, errors: [res.error ? errorText(t, res.error) : t('app.composer.errSave')] };
  return { ok: true };
}
