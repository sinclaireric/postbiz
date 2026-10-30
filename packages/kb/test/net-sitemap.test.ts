import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gunzipIfNeeded, parseSitemap } from '../src/net/sitemap.ts';

describe('parseSitemap', () => {
  it('lit un plan de site avec dates, entités et espaces de noms', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>https://exemple.fr/</loc><lastmod>2026-10-01</lastmod><changefreq>weekly</changefreq></url>
  <url>
    <loc>
      https://exemple.fr/produit?id=1&amp;lang=fr
    </loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://exemple.fr/en/product"/>
    <image:image><image:loc>https://exemple.fr/photo.jpg</image:loc></image:image>
  </url>
  <url><loc>https://exemple.fr/contact</loc></url>
</urlset>`;
    expect(parseSitemap(xml)).toEqual({
      urls: [{ loc: 'https://exemple.fr/', lastmod: '2026-10-01' }, { loc: 'https://exemple.fr/produit?id=1&lang=fr' }, { loc: 'https://exemple.fr/contact' }],
      sitemaps: [],
    });
  });

  it('lit un index de plans de site', () => {
    const xml = '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://exemple.fr/pages.xml</loc><lastmod>2026-10-01</lastmod></sitemap><sitemap><loc>https://exemple.fr/blog.xml</loc></sitemap></sitemapindex>';
    expect(parseSitemap(xml)).toEqual({ urls: [], sitemaps: ['https://exemple.fr/pages.xml', 'https://exemple.fr/blog.xml'] });
  });

  it('lit une liste d’adresses en texte, une par ligne', () => {
    expect(parseSitemap('https://exemple.fr/a\r\n\r\nhttp://exemple.fr/b\nce n’est pas une adresse\nftp://x.fr/c').urls.map((u) => u.loc)).toEqual(['https://exemple.fr/a', 'http://exemple.fr/b']);
  });

  it('plafonne le nombre d’entrées et résiste au XML cassé ou vide', () => {
    const many = `<urlset>${Array.from({ length: 50 }, (_, i) => `<url><loc>https://exemple.fr/${i}</loc></url>`).join('')}</urlset>`;
    expect(parseSitemap(many, 10).urls).toHaveLength(10);
    expect(parseSitemap('<urlset><url><loc>https://exemple.fr/a</loc></url><url><loc>https://exemple.fr/b</lo')).toMatchObject({ urls: [{ loc: 'https://exemple.fr/a' }] });
    expect(parseSitemap('')).toEqual({ urls: [], sitemaps: [] });
    expect(parseSitemap('<html><body>pas un plan</body></html>')).toEqual({ urls: [], sitemaps: [] });
    expect(parseSitemap('<urlset><url><loc></loc></url><url><lastmod>2026-01-01</lastmod></url></urlset>').urls).toEqual([]);
  });

  it('ignore un <loc> hors d’une entrée et ne confond pas une entrée avec la suivante', () => {
    const xml = '<urlset><loc>https://exemple.fr/hors</loc><url><loc>https://exemple.fr/a</loc><lastmod>2026-01-01</lastmod></url><url><loc>https://exemple.fr/b</loc></url></urlset>';
    expect(parseSitemap(xml).urls).toEqual([{ loc: 'https://exemple.fr/a', lastmod: '2026-01-01' }, { loc: 'https://exemple.fr/b' }]);
  });
});

describe('gunzipIfNeeded', () => {
  it('décompresse un .xml.gz et rend le reste tel quel', () => {
    const xml = Buffer.from('<urlset><url><loc>https://exemple.fr/</loc></url></urlset>');
    expect(gunzipIfNeeded(zlib.gzipSync(xml), 10_000).toString()).toBe(xml.toString());
    expect(gunzipIfNeeded(xml, 10_000)).toBe(xml);
    expect(gunzipIfNeeded(Buffer.alloc(0), 10_000).length).toBe(0);
  });

  it('refuse une bombe : au-delà du plafond, rien', () => {
    expect(gunzipIfNeeded(zlib.gzipSync(Buffer.alloc(5_000_000)), 100_000).length).toBe(0);
    expect(gunzipIfNeeded(Buffer.from([0x1f, 0x8b, 0x00, 0x01]), 100_000).length).toBe(0);
  });
});
