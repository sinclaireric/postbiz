import { Parser } from 'htmlparser2';
import { cleanText, truncate } from '../text.ts';

// Une page web, en texte lisible : le contenu principal (titres « # », paragraphes, listes « - », tableaux), sans les menus, bannières de cookies, texte dissimulé
// (taille nulle, transparent, hors écran) ni scripts. Le pied de page de la page d'accueil est gardé (adresse, téléphone, horaires : ce que les clients demandent), ainsi que les données structurées de
// l'entreprise (JSON-LD) quand le site en fournit. Aucun JavaScript n'est exécuté : un site qui n'affiche rien sans lui est signalé (`spaLikely`).

interface El {
  name: string;
  attrs: Record<string, string>;
  children: Array<El | string>;
  parent: El | null;
}

const MAX_DEPTH = 300;
const MAX_NODES = 400_000;
const MAX_TEXT = 300_000;

function parse(html: string): El {
  const root: El = { name: '#root', attrs: {}, children: [], parent: null };
  let current = root;
  let depth = 0;
  let skipped = 0;
  let nodes = 0;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (skipped > 0 || depth >= MAX_DEPTH || nodes >= MAX_NODES) {
          skipped++;
          return;
        }
        const el: El = { name, attrs, children: [], parent: current };
        current.children.push(el);
        current = el;
        depth++;
        nodes++;
      },
      ontext(data) {
        if (skipped > 0 || nodes >= MAX_NODES) return;
        const last = current.children[current.children.length - 1];
        if (typeof last === 'string') current.children[current.children.length - 1] = last + data;
        else current.children.push(data);
      },
      onclosetag() {
        if (skipped > 0) {
          skipped--;
          return;
        }
        current = current.parent ?? root;
        depth = Math.max(0, depth - 1);
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();
  return root;
}

const walkEls = (el: El, visit: (e: El) => void): void => {
  for (const child of el.children) {
    if (typeof child === 'string') continue;
    visit(child);
    walkEls(child, visit);
  }
};
const findFirst = (root: El, test: (e: El) => boolean): El | null => {
  for (const child of root.children) {
    if (typeof child === 'string') continue;
    if (test(child)) return child;
    const inner = findFirst(child, test);
    if (inner) return inner;
  }
  return null;
};
const plainText = (el: El): string => el.children.map((c) => (typeof c === 'string' ? c : plainText(c))).join('');

/** Éléments sans texte utile (ou qui ne sont pas du contenu de page). */
const DROP = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed', 'audio', 'video', 'source', 'track', 'map', 'area', 'select', 'option', 'optgroup',
  'button', 'input', 'textarea', 'datalist', 'dialog', 'link', 'meta', 'head', 'base', 'param', 'picture', 'img',
]);
/** Éléments qui commencent et finissent un paragraphe. */
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hr', 'li',
  'main', 'nav', 'ol', 'p', 'section', 'summary', 'table', 'tbody', 'thead', 'tfoot', 'ul', 'caption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

/**
 * Texte dissimulé à l'œil mais lu par un modèle (taille nulle, transparent, hors écran, rogné) : jamais gardé. Ni `display:none` ni l'attribut `hidden` : les réponses d'une
 * foire aux questions en accordéon en sont pourvues tant qu'on ne les ouvre pas, et c'est justement ce que la base doit savoir.
 */
const HIDDEN_STYLE = /visibility\s*:\s*hidden|font-size\s*:\s*0(?:px|em|rem|pt|%)?\s*(?:;|$|!)|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$|!)|(?:left|top|text-indent)\s*:\s*-\d{3,}|clip\s*:\s*rect\(\s*0/i;
const SCREEN_READER = /(^|[\s_-])(sr-only|sr_only|visually-hidden|visuallyhidden|screen-reader-text|skip-link|skip-to-content|assistive-text)([\s_-]|$)/i;
/** Zones qui ne sont pas le contenu : cookies, fenêtres, infolettre, fil d'Ariane, partage, commentaires, colonnes latérales, recherche. */
const NOISE_CLASS = /(^|[\s_-])(cookies?|cookie-?banner|cookie-?notice|consent|gdpr|rgpd|onetrust|didomi|tarteaucitron|cmp|cc-window|cc-banner|popup|modal|overlay|lightbox|newsletter|breadcrumbs?|share|sharing|social-?share|related-?posts?|comments?|comment-?form|respond|sidebar|widget-?area|searchform|search-?form|skip-?links?|edit-?section|editsection)([\s_-]|$)/i;

function isHidden(el: El): boolean {
  const a = el.attrs;
  if (a.style && HIDDEN_STYLE.test(a.style)) return true;
  return SCREEN_READER.test(a.class ?? '');
}

function isNoise(el: El): boolean {
  if (['body', 'html', 'main', 'article', '#root'].includes(el.name)) return false;
  const label = `${el.attrs.class ?? ''} ${el.attrs.id ?? ''}`.trim();
  if (label && NOISE_CLASS.test(label)) return true;
  const role = el.attrs.role;
  return role === 'dialog' || role === 'alertdialog' || role === 'search' || role === 'navigation' || role === 'complementary';
}

/**
 * Une liste qui n'est qu'une suite de liens courts (menu, liste des langues, index, étiquettes) : de la navigation, pas du contenu. Au moins 8 éléments, presque tout leur texte
 * dans des liens, et courts. Une liste de produits avec leur prix, ou une liste d'articles avec un résumé, a du texte hors des liens et reste.
 */
function isLinkList(el: El): boolean {
  const items = el.children.filter((c): c is El => typeof c !== 'string' && c.name === 'li' && !isHidden(c));
  if (items.length < 8) return false;
  let total = 0;
  let linked = 0;
  for (const item of items) {
    total += plainText(item).replace(/\s+/g, ' ').trim().length;
    walkEls(item, (e) => {
      if (e.name === 'a') linked += plainText(e).replace(/\s+/g, ' ').trim().length;
    });
  }
  return total > 0 && linked / total >= 0.85 && total / items.length <= 60;
}

interface RenderOptions {
  /** Garder les zones de repères de la page (en-tête, navigation, colonnes latérales) : second essai quand la page paraît vide. */
  lenient: boolean;
  /** Garder le pied de page (accueil). */
  keepFooter: boolean;
}

/** Une zone de page : le pied de page du site ou son en-tête (enfants directs de <body> ou rôles `contentinfo` / `banner`), pas celui d'un article. */
const isPageLevel = (el: El): boolean => el.parent?.name === 'body' || el.parent?.name === '#root' || el.parent?.name === 'html' || el.attrs.role === 'contentinfo' || el.attrs.role === 'banner';

class Writer {
  readonly blocks: string[] = [];
  private line = '';
  private prefix = '';
  push(text: string): void {
    this.line += text;
  }
  flush(): void {
    const text = this.line
      .replace(/[ \t\r\f\v]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
    this.line = '';
    if (!text) return;
    this.blocks.push(`${this.prefix}${text}`);
    this.prefix = '';
  }
  /** Le prochain paragraphe sera une puce de liste. */
  bullet(): void {
    this.flush();
    this.prefix = '- ';
  }
  /** Fin d'un élément de liste : écrit ce qui reste, et la puce ne vaut plus pour la suite (un élément vide ne la laisse pas au paragraphe suivant). */
  endBullet(): void {
    this.flush();
    this.prefix = '';
  }
}

function render(el: El, w: Writer, o: RenderOptions): void {
  for (const child of el.children) {
    if (typeof child === 'string') {
      w.push(child);
      continue;
    }
    const name = child.name;
    if (DROP.has(name) || isHidden(child)) continue;
    if (isNoise(child)) continue;
    if (!o.lenient) {
      if (name === 'nav' || name === 'aside') continue;
      if ((name === 'ul' || name === 'ol') && isLinkList(child)) continue;
      if (name === 'header' && isPageLevel(child)) continue;
      if (name === 'footer' && isPageLevel(child) && !o.keepFooter) continue;
    }

    if (/^h[1-6]$/.test(name)) {
      w.flush();
      const inner = new Writer();
      render(child, inner, o);
      inner.flush();
      const text = inner.blocks.join(' ').replace(/^[-\s]+/, '').trim();
      if (text) w.blocks.push(`${'#'.repeat(Number(name[1]))} ${truncate(text, 200)}`);
      continue;
    }
    if (name === 'tr') {
      w.flush();
      const cells = child.children
        .filter((c): c is El => typeof c !== 'string' && (c.name === 'td' || c.name === 'th') && !isHidden(c))
        .map((cell) => {
          const inner = new Writer();
          render(cell, inner, o);
          inner.flush();
          return inner.blocks.join(' ').replace(/\s+/g, ' ').trim();
        })
        .filter(Boolean);
      if (cells.length > 0) w.blocks.push(cells.join(' | '));
      continue;
    }
    if (name === 'li') {
      w.bullet();
      render(child, w, o);
      w.endBullet();
      continue;
    }
    if (name === 'br') {
      w.push('\n');
      continue;
    }
    if (name === 'pre') {
      w.flush();
      const text = plainText(child).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
      if (text) w.blocks.push(text);
      continue;
    }
    if (name === 'a') {
      render(child, w, o);
      // Une adresse électronique ou un numéro cachés derrière un lien : on les écrit si le texte du lien ne les contient pas.
      const href = child.attrs.href ?? '';
      let target = /^mailto:/i.test(href) ? (href.slice(7).split('?')[0] ?? '') : /^tel:/i.test(href) ? href.slice(4) : '';
      try {
        target = decodeURIComponent(target);
      } catch {
        // un « % » mal formé : on garde la chaîne telle quelle
      }
      if (target) {
        const compact = (v: string) => v.replace(/[\s().-]/g, '').toLowerCase();
        if (!compact(plainText(child)).includes(compact(target))) w.push(` (${target})`);
      }
      continue;
    }

    const block = BLOCK.has(name);
    if (block) w.flush();
    render(child, w, o);
    if (block) w.flush();
  }
}

/** Les faits de l'entreprise déclarés dans les données structurées (JSON-LD, schema.org) : adresse, téléphone, horaires. */
export function businessFacts(jsonLd: string[]): string {
  const lines: string[] = [];
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
  const day = (v: unknown) => str(v).replace(/^https?:\/\/schema\.org\//i, '');

  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) return node.slice(0, 50).forEach((n) => visit(n, depth + 1));
    const o = node as Record<string, unknown>;
    if (o['@graph']) visit(o['@graph'], depth + 1);
    const address = typeof o.address === 'object' && o.address !== null ? (o.address as Record<string, unknown>) : null;
    const hours = [...list(o.openingHours).map(str).filter(Boolean)];
    const specs = list(o.openingHoursSpecification).filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null);
    const hasFacts = address || o.telephone || o.email || hours.length > 0 || specs.length > 0;
    if (!hasFacts || !o['@type']) return;
    const out: string[] = [];
    if (str(o.name)) out.push(`Nom : ${str(o.name)}`);
    if (address) {
      const where = [str(address.streetAddress), [str(address.postalCode), str(address.addressLocality)].filter(Boolean).join(' '), str(address.addressRegion), str(address.addressCountry)].filter(Boolean).join(', ');
      if (where) out.push(`Adresse (address) : ${where}`);
    } else if (str(o.address)) out.push(`Adresse (address) : ${str(o.address)}`);
    if (str(o.telephone)) out.push(`Téléphone (phone) : ${str(o.telephone)}`);
    if (str(o.email)) out.push(`E-mail : ${str(o.email)}`);
    for (const h of hours) out.push(`Horaires (opening hours) : ${h}`);
    for (const s of specs) {
      const days = list(s.dayOfWeek).map(day).filter(Boolean).join(', ');
      const opens = str(s.opens);
      const closes = str(s.closes);
      if (days || opens) out.push(`Horaires (opening hours) : ${days}${opens ? ` ${opens}${closes ? `–${closes}` : ''}` : ''}`.trim());
    }
    if (str(o.priceRange)) out.push(`Gamme de prix (price range) : ${str(o.priceRange)}`);
    if (out.length > 1) lines.push(out.join('\n'));
  };

  for (const raw of jsonLd.slice(0, 10)) {
    if (raw.length > 200_000) continue;
    try {
      visit(JSON.parse(raw), 0);
    } catch {
      // un JSON-LD mal formé est ignoré
    }
  }
  return [...new Set(lines)].slice(0, 3).join('\n\n');
}

export interface HtmlPage {
  title: string;
  description: string;
  /** Texte de la page (intertitres « # », listes « - »), nettoyé. */
  text: string;
  /** Adresses des liens de la page, telles qu'écrites (relatives ou absolues), sans doublon. */
  links: string[];
  canonical: string | null;
  noindex: boolean;
  lang: string | null;
  /** Presque aucun texte, mais un site fait de scripts : son contenu n'apparaît qu'avec JavaScript, que Postbiz n'exécute pas. */
  spaLikely: boolean;
  /** Le texte a été coupé à la limite par page. */
  truncated: boolean;
}

/** Lit une page HTML. `keepFooter` : page d'accueil du site (on garde le pied de page, et les données structurées de l'entreprise). */
export function extractHtml(html: string, o: { keepFooter?: boolean } = {}): HtmlPage {
  const root = parse(html);

  let title = '';
  let description = '';
  let canonical: string | null = null;
  let noindex = false;
  let lang: string | null = null;
  let scripts = 0;
  let appRoot = false;
  let noscriptJs = false;
  const jsonLd: string[] = [];
  const links = new Set<string>();

  walkEls(root, (e) => {
    const a = e.attrs;
    switch (e.name) {
      case 'html':
        lang = a.lang?.trim() || null;
        break;
      case 'title':
        if (!title) title = cleanText(plainText(e)).replace(/\n+/g, ' ');
        break;
      case 'meta': {
        const key = (a.name ?? a.property ?? '').toLowerCase();
        const content = (a.content ?? '').trim();
        if (key === 'description') description = cleanText(content);
        else if (key === 'og:description' && !description) description = cleanText(content);
        if (key === 'robots' && /noindex/i.test(content)) noindex = true;
        break;
      }
      case 'link':
        if (/\bcanonical\b/i.test(a.rel ?? '') && a.href) canonical = a.href.trim();
        break;
      case 'script':
        scripts++;
        if (/ld\+json/i.test(a.type ?? '')) jsonLd.push(plainText(e));
        break;
      case 'noscript':
        if (/javascript|activez|enable|activer|js/i.test(plainText(e))) noscriptJs = true;
        break;
      case 'a': {
        const href = (a.href ?? '').trim();
        if (href && !/^(#|javascript:|mailto:|tel:|data:|sms:|whatsapp:)/i.test(href) && links.size < 2_000) links.add(href);
        break;
      }
      default:
        if (['root', 'app', '__next', '__nuxt', 'app-root', 'q-app'].includes(a.id ?? '') || a['ng-app'] !== undefined || a['data-reactroot'] !== undefined) {
          if (e.children.every((c) => typeof c === 'string' ? c.trim() === '' : false)) appRoot = true;
        }
    }
  });

  const body = findFirst(root, (e) => e.name === 'body') ?? root;
  const main = findFirst(body, (e) => e.name === 'main' || e.attrs.role === 'main');
  const article = !main ? findFirst(body, (e) => e.name === 'article') : null;
  const keepFooter = o.keepFooter === true;

  const draw = (scope: El, lenient: boolean): string[] => {
    const w = new Writer();
    render(scope, w, { lenient, keepFooter });
    w.flush();
    return w.blocks;
  };

  let blocks = draw(main ?? article ?? body, false);
  // Le pied de page de l'accueil (hors du <main>) : adresse, téléphone, horaires.
  if (keepFooter && (main || article)) {
    const footer = findFirst(body, (e) => e.name === 'footer' && isPageLevel(e) && !isHidden(e));
    if (footer) {
      const w = new Writer();
      render({ name: '#root', attrs: {}, children: [footer], parent: null }, w, { lenient: false, keepFooter: true });
      w.flush();
      blocks.push(...w.blocks);
    }
  }
  // Une page presque vide : on réessaie sans écarter les zones de repères (en-tête, navigation, colonnes), pour ne rien perdre sur un site mal construit.
  if (blocks.join('').length < 60) {
    const lenient = draw(body, true);
    if (lenient.join('').length > blocks.join('').length) blocks = lenient;
  }

  // Un même paragraphe de suite (menu répété) n'est gardé qu'une fois ; pas de lignes vides de sens.
  const kept: string[] = [];
  for (const b of blocks) {
    if (b.length < 2 || /^[-\s\p{P}]+$/u.test(b)) continue;
    if (kept[kept.length - 1] !== b) kept.push(b);
  }
  if (keepFooter) {
    const facts = businessFacts(jsonLd);
    if (facts) kept.push(facts);
  }

  let text = cleanText(kept.join('\n\n'));
  let truncated = false;
  if (text.length > MAX_TEXT) {
    text = text.slice(0, MAX_TEXT);
    truncated = true;
  }
  if (!title) {
    const h1 = findFirst(body, (e) => e.name === 'h1');
    title = h1 ? cleanText(plainText(h1)).replace(/\n+/g, ' ') : '';
  }
  // Peu de texte hors description : on garde la description de la page, qui dit l'essentiel.
  if (text.length < 300 && description && !text.includes(description)) text = cleanText(`${description}\n\n${text}`);

  // Un site qui ne s'affiche que par JavaScript : presque pas de texte, et soit une racine d'application vide, soit un message « activez JavaScript », soit rien du tout
  // malgré des scripts. Une petite page ordinaire avec quelques scripts (statistiques, thème) n'en est pas un.
  const chars = text.replace(/\s+/g, '').length;
  const spaLikely = chars < 200 && (appRoot || noscriptJs || (chars < 20 && scripts >= 2));
  return { title: truncate(title, 200), description: truncate(description, 400), text, links: [...links], canonical, noindex, lang, spaLikely, truncated };
}
