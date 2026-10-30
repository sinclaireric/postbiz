import zlib from 'node:zlib';
import { Parser } from 'htmlparser2';

// Plans de site (sitemap.xml) : la liste des pages qu'un site déclare. Un fichier peut être un index qui renvoie vers d'autres plans.

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}
export interface ParsedSitemap {
  /** Pages (éléments <url>). */
  urls: SitemapEntry[];
  /** Autres plans de site (éléments <sitemap> d'un index). */
  sitemaps: string[];
}

/** Décompresse un plan de site .xml.gz (octets 1f 8b), au plus `maxBytes` ; un autre contenu est rendu tel quel. */
export function gunzipIfNeeded(body: Buffer, maxBytes: number): Buffer {
  if (body.length < 2 || body[0] !== 0x1f || body[1] !== 0x8b) return body;
  try {
    return zlib.gunzipSync(body, { maxOutputLength: maxBytes });
  } catch {
    return Buffer.alloc(0);
  }
}

/** Lit un plan de site (XML), ou, à défaut, une liste d'adresses une par ligne. Au plus `max` entrées. */
export function parseSitemap(text: string, max = 10_000): ParsedSitemap {
  const out: ParsedSitemap = { urls: [], sitemaps: [] };
  if (!text.includes('<')) {
    for (const line of text.split(/\r\n|\r|\n/)) {
      const loc = line.trim();
      if (/^https?:\/\//i.test(loc) && out.urls.length < max) out.urls.push({ loc });
    }
    return out;
  }

  let container: 'url' | 'sitemap' | null = null;
  let field: 'loc' | 'lastmod' | null = null;
  let loc = '';
  let lastmod = '';
  let buffer = '';
  // Les extensions (image:loc, video:content_loc, xhtml:link…) portent un préfixe : seuls les éléments sans préfixe sont ceux du plan de site.
  const plain = (name: string) => (name.includes(':') ? '' : name.toLowerCase());

  const parser = new Parser(
    {
      onopentag(name) {
        const n = plain(name);
        if (n === 'url' || n === 'sitemap') {
          container = n;
          loc = '';
          lastmod = '';
        } else if (container && (n === 'loc' || n === 'lastmod')) {
          field = n;
          buffer = '';
        }
      },
      ontext(data) {
        if (field) buffer += data;
      },
      onclosetag(name, isImplied) {
        const n = plain(name);
        // Un fichier coupé net : les éléments laissés ouverts sont refermés d'office par l'analyseur ; une entrée incomplète est écartée.
        if (isImplied) {
          if (n === field) field = null;
          if (n === container) container = null;
          return;
        }
        if (field && n === field) {
          if (field === 'loc') loc = buffer.trim();
          else lastmod = buffer.trim();
          field = null;
        } else if (container && n === container) {
          if (loc) {
            if (container === 'url' && out.urls.length < max) out.urls.push(lastmod ? { loc, lastmod } : { loc });
            else if (container === 'sitemap' && out.sitemaps.length < 50) out.sitemaps.push(loc);
          }
          container = null;
        }
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(text);
  parser.end();
  return out;
}
