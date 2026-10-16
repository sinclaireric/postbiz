/**
 * Domaines secondaires : chacun (et son `www.`) redirige en 308 vers le domaine principal, chemin et paramètres conservés.
 * Sans import : ce fichier est lu aussi par next.config.ts, qui ne résout pas l'alias `@/`.
 *
 * Le domaine principal est NEXT_PUBLIC_SITE_URL ; tant qu'il pointe vers une adresse locale (ou qu'il manque), rien n'est redirigé.
 * La liste ci-dessous peut être remplacée par la variable SITE_ALIAS_DOMAINS (noms séparés par des virgules, vide = aucun).
 */
export const ALIAS_DOMAINS: readonly string[] = ['getpostbiz.com', 'trypostiz.com', 'postizz.com', 'post-iz.com'];

export type AliasRedirect = {
  source: string;
  has: { type: 'host'; value: string }[];
  destination: string;
  permanent: true;
};

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** `https://WWW.Exemple.com/` → `www.exemple.com` ; `null` si ce n'est pas un nom de domaine valide. */
export function normalizeHost(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  return HOSTNAME.test(host) ? host : null;
}

/** Lit SITE_ALIAS_DOMAINS (défini, même vide) ou, à défaut, la liste par défaut. */
export function configuredAliases(env: string | undefined): string[] {
  const raw = env === undefined ? ALIAS_DOMAINS : env.split(',');
  return [...new Set(raw.map(normalizeHost).filter((h): h is string => h !== null))];
}

const isLocal = (host: string) => host === 'localhost' || host.endsWith('.localhost') || /^[\d.]+$/.test(host) || host.startsWith('[');

export function aliasRedirects(siteUrl: string | undefined, aliases: readonly string[] = ALIAS_DOMAINS): AliasRedirect[] {
  if (!siteUrl) return [];
  let site: URL;
  try { site = new URL(siteUrl); } catch { return []; }
  if (isLocal(site.hostname)) return [];

  const hosts = new Set<string>();
  for (const alias of aliases) {
    const host = normalizeHost(alias);
    if (!host) continue;
    hosts.add(host);
    hosts.add(host.startsWith('www.') ? host.slice(4) : `www.${host}`);
  }
  hosts.delete(site.host.toLowerCase()); // jamais de boucle : le domaine principal ne se redirige pas lui-même
  hosts.delete(site.hostname.toLowerCase());

  return [...hosts].sort().map((host) => ({
    source: '/:path*',
    has: [{ type: 'host', value: host }],
    destination: `${site.origin}/:path*`,
    permanent: true,
  }));
}
