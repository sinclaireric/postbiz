import type { Metadata } from 'next';
import { BlogList } from '@/components/blog/blog-list';
import { getT } from '@/i18n/server';
import { listHref, noticeNeeded, parsePage, parseQuery, searchPosts } from '@/lib/blog/logic';
import { getPosts } from '@/lib/blog/server';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const t = await getT();
  const sp = await searchParams;
  const page = parsePage(sp.page);
  return {
    title: t('meta.blog.title'),
    description: t('meta.blog.description'),
    // Une recherche n'est pas une page à référencer ; les pages suivantes ont leur propre adresse.
    alternates: { canonical: listHref({ page }), types: { 'application/rss+xml': '/blog/rss.xml' } },
    robots: parseQuery(sp.q) ? { index: false, follow: true } : undefined,
  };
}

export default async function BlogPage({ searchParams }: Props) {
  const sp = await searchParams;
  const t = await getT();
  const q = parseQuery(sp.q);
  const posts = searchPosts(await getPosts(t.locale), q);
  return <BlogList posts={posts} locale={t.locale} q={q} page={parsePage(sp.page)} foreign={noticeNeeded(t.locale)} />;
}
