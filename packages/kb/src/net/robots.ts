// robots.txt (RFC 9309) : ce que le propriétaire d'un site permet aux robots de lire. Postbiz s'y conforme toujours.

export interface RobotsRules {
  /** Le chemin (avec sa requête, « /page?a=1 ») peut-il être lu ? */
  allows(pathAndQuery: string): boolean;
  /** Délai demandé entre deux requêtes, en secondes (non standard mais très répandu), ou null. */
  crawlDelay: number | null;
  /** Adresses des plans de site déclarés (lignes « Sitemap: »). */
  sitemaps: string[];
}

/** Pas de robots.txt (ou sans règles pour nous) : tout est permis. */
export const ALLOW_ALL: RobotsRules = { allows: () => true, crawlDelay: null, sitemaps: [] };
/** robots.txt illisible (erreur du serveur) : par prudence, rien n'est permis. */
export const DISALLOW_ALL: RobotsRules = { allows: () => false, crawlDelay: null, sitemaps: [] };

interface Rule {
  allow: boolean;
  /** Longueur du motif : à longueur égale, « Allow » l'emporte, et le plus long l'emporte sur le plus court. */
  length: number;
  regex: RegExp;
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay: number | null;
}

function compile(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/**
 * Lit un robots.txt pour le robot `agent` (le « jeton » de produit de son User-Agent, ex. `PostbizBot`). Les groupes qui nomment notre robot l'emportent sur
 * le groupe `*` ; les règles d'un groupe se comparent par la longueur du motif (le plus long gagne, « Allow » en cas d'égalité) ; `*` et `$` sont admis.
 */
export function parseRobots(text: string, agent: string): RobotsRules {
  const token = agent.toLowerCase().split('/')[0]!.trim();
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let inAgents = false;

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      // Des lignes User-agent qui se suivent partagent le même groupe ; une ligne après des règles ouvre un nouveau groupe.
      if (!current || !inAgents) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      inAgents = true;
    } else if (field === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (current && (field === 'allow' || field === 'disallow')) {
      inAgents = false;
      // « Disallow: » vide : aucune restriction.
      if (value) current.rules.push({ allow: field === 'allow', length: value.length, regex: compile(value) });
    } else if (current && field === 'crawl-delay') {
      inAgents = false;
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    } else {
      inAgents = false;
    }
  }

  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && a !== '' && token.includes(a)));
  const chosen = named.length > 0 ? named : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  const delays = chosen.map((g) => g.crawlDelay).filter((d): d is number => d !== null);
  return {
    sitemaps,
    crawlDelay: delays.length > 0 ? Math.max(...delays) : null,
    allows(pathAndQuery) {
      const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!rule.regex.test(path)) continue;
        if (!best || rule.length > best.length || (rule.length === best.length && rule.allow && !best.allow)) best = rule;
      }
      return best ? best.allow : true;
    },
  };
}
