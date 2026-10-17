import { DEFAULT_LOCALE, LOCALE_META, isLocale } from '@/i18n/config';
import { loadMessages } from '@/i18n/messages';
import { lookup } from '@/i18n/translate';
import { CONTENT_DIR, loadPostsFrom } from '@/lib/blog/load';
import { contentLocaleFor } from '@/lib/blog/logic';
import { buildRss } from '@/lib/blog/rss';
import { siteUrl } from '@/lib/supabase/env';

/**
 * Flux RSS du blog. Les lecteurs de flux n'envoient ni cookie ni langue choisie : anglais par défaut,
 * et `/blog/rss.xml?lang=fr` pour la version française.
 */
export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get('lang');
  const locale = isLocale(asked) ? asked : DEFAULT_LOCALE;
  const content = contentLocaleFor(locale);
  const [posts, messages] = await Promise.all([loadPostsFrom(CONTENT_DIR, content), loadMessages(content)]);

  const xml = buildRss({
    siteUrl,
    title: `${lookup(messages, 'blog.title')} · Postbiz`,
    description: lookup(messages, 'blog.subtitle') ?? '',
    language: LOCALE_META[content].tag,
    posts,
  });
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
