import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './frontmatter';
import { blocksText, headingsOf, inlineText, parseInline, parseMarkdown, safeHref, slugify, type Block } from './markdown';

const first = (src: string): Block => parseMarkdown(src)[0]!;

describe('parseFrontmatter', () => {
  it('lit les clés, les guillemets et sépare le corps', () => {
    const { data, body } = parseFrontmatter('---\ntitle: "Un titre: avec deux-points"\ndate: 2026-10-01\n# commentaire\ncategory:guides\n---\n\nTexte');
    expect(data).toEqual({ title: 'Un titre: avec deux-points', date: '2026-10-01', category: 'guides' });
    expect(body).toBe('\nTexte');
  });

  it('tolère les fins de ligne Windows et le BOM', () => {
    expect(parseFrontmatter('﻿---\r\ntitle: A\r\n---\r\nB').data).toEqual({ title: 'A' });
  });

  it('sans en-tête : tout est du corps', () => {
    expect(parseFrontmatter('Bonjour')).toEqual({ data: {}, body: 'Bonjour' });
  });

  it('refuse une ligne qui n’est pas « clé: valeur »', () => {
    expect(() => parseFrontmatter('---\npas de deux points\n---\n')).toThrow(/Frontmatter invalide/);
  });
});

describe('slugify', () => {
  it('retire accents et ponctuation', () => {
    expect(slugify('La fenêtre de 24 heures : pourquoi ?')).toBe('la-fenetre-de-24-heures-pourquoi');
  });
  it('garde les lettres non latines', () => {
    expect(slugify('Привет, мир')).toBe('привет-мир');
  });
});

describe('safeHref', () => {
  it('accepte les adresses sûres', () => {
    for (const ok of ['/tarifs', '#section', 'https://postbiz.com/x', 'http://a.b', 'mailto:a@b.c']) expect(safeHref(ok)).toBe(ok);
  });
  it('refuse javascript:, data:, // et les adresses sans schéma', () => {
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', '//evil.test', 'evil.test', 'vbscript:x']) expect(safeHref(bad)).toBeNull();
  });
});

describe('parseInline', () => {
  it('gras, italique, code, lien', () => {
    expect(parseInline('a **b** *c* `d` [e](/f)')).toEqual([
      { t: 'text', text: 'a ' },
      { t: 'strong', children: [{ t: 'text', text: 'b' }] },
      { t: 'text', text: ' ' },
      { t: 'em', children: [{ t: 'text', text: 'c' }] },
      { t: 'text', text: ' ' },
      { t: 'code', text: 'd' },
      { t: 'text', text: ' ' },
      { t: 'link', href: '/f', children: [{ t: 'text', text: 'e' }] },
    ]);
  });

  it('ne mélange pas snake_case avec de l’italique', () => {
    expect(inlineText(parseInline('la variable snake_case_name reste entière'))).toBe('la variable snake_case_name reste entière');
    expect(parseInline('snake_case_name')).toEqual([{ t: 'text', text: 'snake_case_name' }]);
  });

  it('une étoile seule ou entourée d’espaces reste du texte', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', text: '2 * 3 * 4' }]);
  });

  it('ne met pas en forme à l’intérieur d’un code', () => {
    expect(parseInline('`**pas gras**`')).toEqual([{ t: 'code', text: '**pas gras**' }]);
  });

  it('gère les échappements', () => {
    expect(parseInline('\\*pas italique\\*')).toEqual([{ t: 'text', text: '*pas italique*' }]);
  });

  it('un lien dangereux devient du texte simple', () => {
    expect(parseInline('[clic](javascript:alert(1))')).toEqual([{ t: 'text', text: 'clic' }]);
  });

  it('le HTML brut reste du texte (React l’échappera)', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([{ t: 'text', text: '<script>alert(1)</script>' }]);
  });

  it('accepte des parenthèses dans l’adresse', () => {
    expect(parseInline('[w](https://fr.wikipedia.org/wiki/A_(b))')).toEqual([{ t: 'link', href: 'https://fr.wikipedia.org/wiki/A_(b)', children: [{ t: 'text', text: 'w' }] }]);
  });
});

describe('parseMarkdown', () => {
  it('titres : le niveau 1 devient 2, au-delà de 4 devient 4, ancres uniques', () => {
    const blocks = parseMarkdown('# Un\n\n## Deux\n\n## Deux\n\n###### Six');
    expect(headingsOf(blocks)).toEqual([
      { id: 'un', text: 'Un', level: 2 },
      { id: 'deux', text: 'Deux', level: 2 },
      { id: 'deux-2', text: 'Deux', level: 2 },
      { id: 'six', text: 'Six', level: 4 },
    ]);
  });

  it('un paragraphe réunit ses lignes', () => {
    expect(first('une ligne\nsuite')).toEqual({ t: 'paragraph', children: [{ t: 'text', text: 'une ligne suite' }] });
  });

  it('listes à puces et numérotées', () => {
    const [a, b] = parseMarkdown('- un\n- deux\n\n1. premier\n2. second');
    expect(a).toMatchObject({ t: 'list', ordered: false });
    expect((a as Extract<Block, { t: 'list' }>).items.map((i) => inlineText(i.children))).toEqual(['un', 'deux']);
    expect(b).toMatchObject({ t: 'list', ordered: true });
    expect((b as Extract<Block, { t: 'list' }>).items).toHaveLength(2);
  });

  it('liste imbriquée et suite de ligne', () => {
    const list = first('- parent\n  suite du parent\n  - enfant 1\n  - enfant 2\n- autre') as Extract<Block, { t: 'list' }>;
    expect(list.items).toHaveLength(2);
    expect(inlineText(list.items[0]!.children)).toBe('parent suite du parent');
    const nested = list.items[0]!.blocks[0] as Extract<Block, { t: 'list' }>;
    expect(nested.t).toBe('list');
    expect(nested.items.map((i) => inlineText(i.children))).toEqual(['enfant 1', 'enfant 2']);
  });

  it('une liste aérée reste une seule liste', () => {
    const blocks = parseMarkdown('- un\n\n- deux\n\n- trois');
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Extract<Block, { t: 'list' }>).items).toHaveLength(3);
  });

  it('bloc de code : contenu brut, langue conservée, titres ignorés dedans', () => {
    expect(first('```bash\n# pas un titre\npnpm dev\n```')).toEqual({ t: 'code', lang: 'bash', text: '# pas un titre\npnpm dev' });
  });

  it('bloc de code jamais fermé : jusqu’à la fin', () => {
    expect(first('```\nabc')).toEqual({ t: 'code', lang: '', text: 'abc' });
  });

  it('citation et encadrés', () => {
    expect(first('> Une phrase.')).toMatchObject({ t: 'quote' });
    const callout = first('> [!TIP]\n> Un **conseil**.');
    expect(callout).toMatchObject({ t: 'callout', kind: 'tip' });
    expect(blocksText([callout])).toBe('Un conseil.');
    expect(first('> [!warning]\n> Attention')).toMatchObject({ kind: 'warning' });
  });

  it('tableau avec alignements et cellules manquantes', () => {
    const table = first('| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 |\n| x \\| y | 4 | 5 |') as Extract<Block, { t: 'table' }>;
    expect(table.t).toBe('table');
    expect(table.align).toEqual(['left', 'center', 'right']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toHaveLength(3);
    expect(inlineText(table.rows[1]![0]!)).toBe('x | y');
  });

  it('image seule : adresses sûres uniquement', () => {
    expect(first('![Un schéma](/blog/schema.png)')).toEqual({ t: 'image', src: '/blog/schema.png', alt: 'Un schéma' });
    expect(parseMarkdown('![x](http://insecure.test/a.png)')).toEqual([]);
    expect(parseMarkdown('![x](javascript:alert(1))')).toEqual([]);
  });

  it('séparateur', () => {
    expect(parseMarkdown('avant\n\n---\n\naprès').map((b) => b.t)).toEqual(['paragraph', 'hr', 'paragraph']);
  });

  it('une liste interrompt un paragraphe', () => {
    expect(parseMarkdown('Intro :\n- a\n- b').map((b) => b.t)).toEqual(['paragraph', 'list']);
  });

  it('un nombre suivi d’un point en milieu de phrase n’est pas une liste', () => {
    expect(parseMarkdown('Version 2.0 sortie en 2026. Bravo').map((b) => b.t)).toEqual(['paragraph']);
  });
});

describe('blocksText', () => {
  it('rassemble le texte lisible, sans le code', () => {
    const blocks = parseMarkdown('## Titre\n\nUn **mot** ici.\n\n- un\n- deux\n\n```\nignoré\n```');
    expect(blocksText(blocks).split(/\s+/).filter(Boolean)).toEqual(['Titre', 'Un', 'mot', 'ici.', 'un', 'deux']);
  });
});
