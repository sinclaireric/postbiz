import { fileExtension, SOURCE_LIMITS, titleFromFileName } from '@postbiz/kb';
import { parsePublicUrl } from '@postbiz/kb/net';
import type { FormError } from '@/lib/form-error';
import { displayName } from '@/lib/media/logic';

// Validation des formulaires « Ajouter un document » et « Ajouter un site ». Côté serveur seulement (le contrôle d'adresse du paquet partagé s'appuie sur Node) :
// la base refait ses propres contrôles, et le worker refuse toute adresse non publique avant d'y toucher.

export interface WebsiteInput {
  url: string;
  title: string;
  scope: 'page' | 'site';
  autoSync: boolean;
}

export interface DocumentInput {
  path: string;
  title: string;
  size: number;
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: FormError };

/** Les champs du formulaire d'un site : l'adresse (« https:// » ajouté si besoin), l'étendue (tout le site par défaut), la relecture hebdomadaire. */
export function normalizeWebsite(url: unknown, scope: unknown, autoSync: unknown): Checked<WebsiteInput> {
  const parsed = parsePublicUrl(String(url ?? ''), { assumeHttps: true });
  if (!parsed.ok) return { ok: false, error: { key: 'app.knowledgePage.errors.invalidUrl' } };
  return {
    ok: true,
    value: {
      url: parsed.url.href,
      title: parsed.url.hostname.replace(/^www\./, '').slice(0, 120),
      scope: scope === 'page' ? 'page' : 'site',
      autoSync: autoSync === 'on' || autoSync === '1' || autoSync === true,
    },
  };
}

/** Un document déjà déposé dans le stockage : dans le dossier de l'organisation, d'un type pris en charge, de la bonne taille. */
export function validateDocument(input: { path: unknown; title: unknown; size: unknown }, orgId: string): Checked<DocumentInput> {
  const path = typeof input.path === 'string' ? input.path : '';
  const name = path.slice(orgId.length + 1);
  if (!path.startsWith(`${orgId}/`) || !name || name.includes('/') || path.includes('..') || path.length > 600) return { ok: false, error: { key: 'app.knowledgePage.errors.fileMissing' } };
  if (!fileExtension(name)) return { ok: false, error: { key: 'app.knowledgePage.errors.unsupportedType' } };
  const size = typeof input.size === 'number' && Number.isFinite(input.size) ? Math.floor(input.size) : 0;
  if (size < 1) return { ok: false, error: { key: 'app.knowledgePage.errors.fileMissing' } };
  if (size > SOURCE_LIMITS.fileBytes) return { ok: false, error: { key: 'app.knowledgePage.errors.fileTooLarge', params: { max: Math.round(SOURCE_LIMITS.fileBytes / 1_048_576) } } };
  const title = (typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '').slice(0, 120) || titleFromFileName(displayName(path));
  return { ok: true, value: { path, title, size } };
}
