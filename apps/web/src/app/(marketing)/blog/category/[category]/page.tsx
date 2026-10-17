import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogList } from '@/components/blog/blog-list';
import { getT } from '@/i18n/server';
import { inCategory, listHref, noticeNeeded, parsePage, parseQuery, searchPosts } from '@/lib/blog/logic';
import { getPosts } from '@/lib/blog/server';
import { isCategory } from '@/lib/blog/types';

type Props = {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { category } = await params;
  if (!isCategory(category)) return {};
  const t = await getT();
  const sp = await searchParams;
  const name = t(`blog.categories.${category}`);
  return {
    title: name,
    description: t('meta.blog.categoryDescription', { category: name }),
    alternates: { canonical: listHref({ category, page: parsePage(sp.page) }), types: { 'application/rss+xml': '/blog/rss.xml' } },
    robots: parseQuery(sp.q) ? { index: false, follow: true } : undefined,
  };
}

export default async function BlogCategoryPage({ params, searchParams }: Props) {
  const { category } = await params;
  if (!isCategory(category)) notFound();
  const sp = await searchParams;
  const t = await getT();
  const q = parseQuery(sp.q);
  const posts = searchPosts(inCategory(await getPosts(t.locale), category), q);
  return <BlogList posts={posts} locale={t.locale} category={category} q={q} page={parsePage(sp.page)} foreign={noticeNeeded(t.locale)} />;
}
