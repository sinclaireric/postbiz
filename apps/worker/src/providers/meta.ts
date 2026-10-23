// Constantes et aides communes aux réseaux Meta (Facebook, Instagram).

/** Version de l'API Graph (la même que celle de la connexion des canaux, voir supabase/functions/_shared/meta/graph.ts). */
export const GRAPH_VERSION = 'v23.0';

/** Les seuls serveurs auxquels on envoie un jeton Meta : `settings.graph_host` vient de la base, jamais d'un serveur choisi par un tiers. */
export const GRAPH_HOSTS = ['graph.facebook.com', 'graph.instagram.com'] as const;

export function graphHost(settings: Record<string, unknown>): (typeof GRAPH_HOSTS)[number] {
  const host = settings.graph_host;
  return (GRAPH_HOSTS as readonly string[]).includes(host as string) ? (host as (typeof GRAPH_HOSTS)[number]) : 'graph.facebook.com';
}
