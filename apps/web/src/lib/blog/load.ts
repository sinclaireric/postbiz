import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter';
import { blocksText, headingsOf, parseMarkdown } from './markdown';
import { byDateDesc, countWords, readingMinutes } from './logic';
import { AUTHORS, CATEGORIES, CONTENT_LOCALES, COVER_THEMES, type AuthorId, type Category, type ContentLocale, type CoverTheme, type Post } from './types';

/** Dossier des articles : `content/blog/<identifiant>/<fr|en>.md`, à la racine de l'application web. */
export const CONTENT_DIR = path.join(process.cwd(), 'content', 'blog');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T | undefined, where: string, key: string): T {
  const v = value ?? fallback;
  if (v === undefined || !(allowed as readonly string[]).includes(v)) throw new Error(`${where} : « ${key} » doit valoir ${allowed.join(', ')} (reçu : ${value ?? 'rien'})`);
  return v as T;
}

/** Construit un article à partir du texte d'un fichier. Une erreur de contenu échoue au build avec le nom du fichier. */
export function buildPost(slug: string, locale: ContentLocale, source: string, where = `${slug}/${locale}.md`): Post | null {
  if (!SLUG.test(slug)) throw new Error(`${where} : le dossier « ${slug} » doit être en minuscules, chiffres et tirets`);
  const { data, body } = parseFrontmatter(source);
  const need = (key: string) => {
    const v = data[key]?.trim();
    if (!v) throw new Error(`${where} : « ${key} » manque dans l'en-tête`);
    return v;
  };

  const title = need('title');
  const description = need('description');
  const date = need('date');
  if (!validDate(date)) throw new Error(`${where} : « date » doit être AAAA-MM-JJ (reçu : ${date})`);
  const updated = data.updated?.trim() || undefined;
  if (updated && !validDate(updated)) throw new Error(`${where} : « updated » doit être AAAA-MM-JJ (reçu : ${updated})`);
  if (data.draft === 'true' && process.env.NODE_ENV === 'production') return null;

  const blocks = parseMarkdown(body);
  if (!blocks.length) throw new Error(`${where} : l'article est vide`);

  return {
    slug,
    locale,
    title,
    description,
    date,
    updated,
    category: oneOf<Category>(data.category, CATEGORIES, undefined, where, 'category'),
    author: oneOf<AuthorId>(data.author, AUTHORS, 'team', where, 'author'),
    cover: oneOf<CoverTheme>(data.cover, COVER_THEMES, 'forest', where, 'cover'),
    coverTitle: data.coverTitle?.trim() || undefined,
    minutes: readingMinutes(countWords(blocksText(blocks))),
    blocks,
    toc: headingsOf(blocks).filter((h) => h.level === 2),
  };
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Tous les articles dans la langue demandée, le plus récent d'abord. Si un article n'existe pas dans cette langue,
 * on prend l'autre : un article n'est jamais absent du blog parce qu'il n'est pas encore traduit.
 */
export async function loadPostsFrom(dir: string, preferred: ContentLocale): Promise<Post[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }

  const order = [preferred, ...CONTENT_LOCALES.filter((l) => l !== preferred)];
  const posts: Post[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const locale of order) {
      const source = await readIfExists(path.join(dir, entry.name, `${locale}.md`));
      if (source === null) continue;
      const post = buildPost(entry.name, locale, source);
      if (post) posts.push(post);
      break;
    }
  }
  return posts.sort(byDateDesc);
}
