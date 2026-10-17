import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/i18n/config';
import { buildPost, CONTENT_DIR, loadPostsFrom } from './load';
import { byDateDesc, contentLocaleFor, fold, listHref, noticeNeeded, paginate, parsePage, parseQuery, readingMinutes, relatedPosts, searchPosts } from './logic';
import { parseMarkdown } from './markdown';
import { buildRss } from './rss';
import { CATEGORIES, type Post } from './types';

const post = (over: Partial<Post> & { slug: string }): Post => ({
  locale: 'fr',
  title: 'Titre',
  description: 'Description',
  date: '2026-10-01',
  category: 'guides',
  author: 'team',
  cover: 'forest',
  minutes: 3,
  blocks: [],
  toc: [],
  ...over,
});

const FILE = (extra = '') => `---\ntitle: Un titre\ndescription: Une description\ndate: 2026-10-01\ncategory: guides\n${extra}---\n\n## Section\n\nTexte.\n`;

describe('contentLocaleFor / noticeNeeded', () => {
  it('français pour le français, anglais pour toutes les autres langues', () => {
    for (const l of LOCALES) expect(contentLocaleFor(l)).toBe(l === 'fr' ? 'fr' : 'en');
  });
  it('seules les langues sans article traduit reçoivent l’avis', () => {
    expect(LOCALES.filter(noticeNeeded)).toHaveLength(LOCALES.length - 2);
    expect(noticeNeeded('fr')).toBe(false);
    expect(noticeNeeded('en')).toBe(false);
  });
});

describe('paginate / parsePage', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  it('découpe par pages de 12', () => {
    expect(paginate(items, 1).items).toHaveLength(12);
    expect(paginate(items, 3)).toMatchObject({ page: 3, pages: 3, total: 25, items: [24] });
  });
  it('une liste vide a une page', () => {
    expect(paginate([], 1)).toMatchObject({ page: 1, pages: 1, items: [] });
  });
  it('lit un numéro de page sûr', () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage('3')).toBe(3);
    expect(parsePage(['2', '5'])).toBe(2);
    for (const bad of ['0', '-1', 'abc', '1.5', '', '99999999999']) expect(parsePage(bad)).toBe(1);
  });
});

describe('recherche', () => {
  const posts = [
    post({ slug: 'a', title: 'La fenêtre de 24 heures', description: 'Répondre à temps sur Messenger' }),
    post({ slug: 'b', title: 'Un calendrier éditorial', description: 'Tenir un rythme' }),
  ];
  it('ignore accents et casse', () => {
    expect(fold('Fenêtre')).toBe('fenetre');
    expect(searchPosts(posts, 'FENETRE').map((p) => p.slug)).toEqual(['a']);
  });
  it('exige tous les mots, dans le titre ou la description', () => {
    expect(searchPosts(posts, 'messenger fenetre').map((p) => p.slug)).toEqual(['a']);
    expect(searchPosts(posts, 'messenger calendrier')).toEqual([]);
  });
  it('une recherche vide garde tout', () => {
    expect(searchPosts(posts, '   ')).toHaveLength(2);
  });
  it('nettoie la valeur de ?q=', () => {
    expect(parseQuery('  a   b  ')).toBe('a b');
    expect(parseQuery(undefined)).toBe('');
    expect(parseQuery('x'.repeat(200))).toHaveLength(80);
  });
});

describe('listHref', () => {
  it('construit les adresses de liste', () => {
    expect(listHref({})).toBe('/blog');
    expect(listHref({ category: 'guides' })).toBe('/blog/category/guides');
    expect(listHref({ page: 1 })).toBe('/blog');
    expect(listHref({ category: 'agents', q: 'a b', page: 2 })).toBe('/blog/category/agents?q=a+b&page=2');
  });
});

describe('relatedPosts', () => {
  const all = [
    post({ slug: 'cur', category: 'guides', date: '2026-10-05' }),
    post({ slug: 'g-old', category: 'guides', date: '2026-09-01' }),
    post({ slug: 'p-new', category: 'product', date: '2026-10-10' }),
    post({ slug: 'g-new', category: 'guides', date: '2026-10-02' }),
    post({ slug: 'a-1', category: 'agents', date: '2026-09-15' }),
  ];
  it('même catégorie d’abord, jamais l’article courant', () => {
    expect(relatedPosts(all, all[0]!).map((p) => p.slug)).toEqual(['g-new', 'g-old', 'p-new']);
  });
  it('complète avec les autres catégories', () => {
    expect(relatedPosts(all, all[0]!, 4).map((p) => p.slug)).toEqual(['g-new', 'g-old', 'p-new', 'a-1']);
  });
  it('trie du plus récent au plus ancien, ex æquo par identifiant', () => {
    const sorted = [post({ slug: 'b', date: '2026-01-01' }), post({ slug: 'a', date: '2026-01-01' }), post({ slug: 'c', date: '2026-02-01' })].sort(byDateDesc);
    expect(sorted.map((p) => p.slug)).toEqual(['c', 'a', 'b']);
  });
});

describe('readingMinutes', () => {
  it('au moins une minute, environ 220 mots par minute', () => {
    expect(readingMinutes(10)).toBe(1);
    expect(readingMinutes(440)).toBe(2);
    expect(readingMinutes(1100)).toBe(5);
  });
});

describe('buildPost', () => {
  it('construit un article complet', () => {
    const p = buildPost('mon-article', 'fr', FILE('cover: lime\ncoverTitle: Court\n'))!;
    expect(p).toMatchObject({ slug: 'mon-article', locale: 'fr', title: 'Un titre', category: 'guides', cover: 'lime', coverTitle: 'Court', author: 'team', minutes: 1 });
    expect(p.toc).toEqual([{ id: 'section', text: 'Section', level: 2 }]);
  });

  it('refuse un en-tête incomplet ou invalide, en nommant le fichier', () => {
    expect(() => buildPost('a', 'fr', '---\ntitle: x\n---\ncorps', 'a/fr.md')).toThrow(/a\/fr\.md.*description/);
    expect(() => buildPost('a', 'fr', FILE().replace('2026-10-01', '2026-13-45'))).toThrow(/date/);
    expect(() => buildPost('a', 'fr', FILE().replace('guides', 'inconnue'))).toThrow(/category/);
    expect(() => buildPost('a', 'fr', FILE('cover: rose\n'))).toThrow(/cover/);
    expect(() => buildPost('a', 'fr', FILE('updated: hier\n'))).toThrow(/updated/);
    expect(() => buildPost('Mon Article', 'fr', FILE())).toThrow(/minuscules/);
    expect(() => buildPost('a', 'fr', '---\ntitle: t\ndescription: d\ndate: 2026-10-01\ncategory: guides\n---\n')).toThrow(/vide/);
  });

  it('un brouillon est écarté en production', () => {
    const env = process.env as Record<string, string | undefined>;
    const before = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      expect(buildPost('a', 'fr', FILE('draft: true\n'))).toBeNull();
      env.NODE_ENV = 'development';
      expect(buildPost('a', 'fr', FILE('draft: true\n'))).not.toBeNull();
    } finally {
      env.NODE_ENV = before;
    }
  });
});

describe('loadPostsFrom', () => {
  it('prend la langue demandée, sinon l’autre, et trie par date', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'blog-'));
    try {
      await mkdir(path.join(dir, 'ancien'));
      await mkdir(path.join(dir, 'recent'));
      await mkdir(path.join(dir, 'seulement-en'));
      await writeFile(path.join(dir, 'ancien', 'fr.md'), FILE().replace('Un titre', 'Ancien FR').replace('2026-10-01', '2026-08-01'));
      await writeFile(path.join(dir, 'ancien', 'en.md'), FILE().replace('Un titre', 'Old EN').replace('2026-10-01', '2026-08-01'));
      await writeFile(path.join(dir, 'recent', 'fr.md'), FILE().replace('Un titre', 'Récent FR').replace('2026-10-01', '2026-10-10'));
      await writeFile(path.join(dir, 'seulement-en', 'en.md'), FILE().replace('Un titre', 'Only EN').replace('2026-10-01', '2026-09-01'));
      await writeFile(path.join(dir, 'README.txt'), 'ignoré');

      const fr = await loadPostsFrom(dir, 'fr');
      expect(fr.map((p) => `${p.slug}:${p.locale}`)).toEqual(['recent:fr', 'seulement-en:en', 'ancien:fr']);
      const en = await loadPostsFrom(dir, 'en');
      expect(en.map((p) => `${p.slug}:${p.locale}`)).toEqual(['recent:fr', 'seulement-en:en', 'ancien:en']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('un dossier de contenu absent donne un blog vide', async () => {
    expect(await loadPostsFrom(path.join(tmpdir(), 'nexiste-pas-blog'), 'fr')).toEqual([]);
  });
});

describe('buildRss', () => {
  it('échappe le XML et suit RSS 2.0', () => {
    const xml = buildRss({
      siteUrl: 'https://postbiz.test',
      title: 'Blog <b> & co',
      description: 'd',
      language: 'fr',
      posts: [post({ slug: 'a-b', title: 'A & B <script>', description: 'x "y" \'z\'' })],
    });
    expect(xml).toContain('<title>Blog &lt;b&gt; &amp; co</title>');
    expect(xml).toContain('<title>A &amp; B &lt;script&gt;</title>');
    expect(xml).toContain('<link>https://postbiz.test/blog/a-b</link>');
    expect(xml).toContain('<pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate>');
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('<guid isPermaLink="true">https://postbiz.test/blog/a-b</guid>');
  });
});

/** Le contenu réel du dépôt : une faute dans un article doit faire échouer les tests, pas la production. */
describe('articles du dépôt', () => {
  it('se chargent dans les deux langues, avec les mêmes identifiants', async () => {
    const [fr, en] = await Promise.all([loadPostsFrom(CONTENT_DIR, 'fr'), loadPostsFrom(CONTENT_DIR, 'en')]);
    expect(fr.length).toBeGreaterThanOrEqual(6);
    expect(fr.map((p) => p.slug).sort()).toEqual(en.map((p) => p.slug).sort());
    expect(fr.every((p) => p.locale === 'fr') && en.every((p) => p.locale === 'en')).toBe(true);
  });

  it('chaque catégorie a au moins un article, chaque article un sommaire et une couverture courte', async () => {
    const fr = await loadPostsFrom(CONTENT_DIR, 'fr');
    for (const c of CATEGORIES) expect(fr.some((p) => p.category === c), c).toBe(true);
    for (const p of fr) {
      expect(p.toc.length, p.slug).toBeGreaterThanOrEqual(3);
      expect((p.coverTitle ?? p.title).length, `${p.slug} : titre de couverture`).toBeLessThanOrEqual(45);
      expect(p.description.length, `${p.slug} : description`).toBeLessThanOrEqual(260);
      expect(p.date <= '2026-12-31', p.slug).toBe(true);
    }
  });

  it('chaque lien interne d’un article mène à une page qui existe', async () => {
    const known = new Set(['/', '/blog', '/canaux', '/tarifs', '/contact', '/signup', '/produit/inbox', '/produit/planification']);
    const posts = [...(await loadPostsFrom(CONTENT_DIR, 'fr')), ...(await loadPostsFrom(CONTENT_DIR, 'en'))];
    for (const p of posts) known.add(`/blog/${p.slug}`);

    const links = (blocks: ReturnType<typeof parseMarkdown>): string[] =>
      blocks.flatMap((b): string[] => {
        const inline = (nodes: { t: string; href?: string; children?: unknown[] }[]): string[] =>
          nodes.flatMap((n) => (n.t === 'link' ? [n.href!] : n.children ? inline(n.children as never) : []));
        switch (b.t) {
          case 'paragraph':
            return inline(b.children as never);
          case 'list':
            return b.items.flatMap((i) => [...inline(i.children as never), ...links(i.blocks)]);
          case 'quote':
          case 'callout':
            return links(b.children);
          case 'table':
            return [...b.head, ...b.rows.flat()].flatMap((c) => inline(c as never));
          default:
            return [];
        }
      });
    for (const p of posts) for (const href of links(p.blocks)) if (href.startsWith('/')) expect(known.has(href), `${p.slug} (${p.locale}) → ${href}`).toBe(true);
  });
});
