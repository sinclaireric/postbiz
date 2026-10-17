import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleBody } from '@/components/blog/markdown';
import { PostCard } from '@/components/blog/post-card';
import { PostCover } from '@/components/blog/post-cover';
import { EndCta, PostCtaCard } from '@/components/blog/post-cta';
import { ShareLinks } from '@/components/blog/share-links';
import { Toc } from '@/components/blog/toc';
import { LogoMark } from '@/components/logo';
import { Container } from '@/components/ui';
import { formatArticleDate } from '@/i18n/format';
import { getT } from '@/i18n/server';
import { relatedPosts } from '@/lib/blog/logic';
import { getPost, getPosts, isForeign } from '@/lib/blog/server';
import { siteUrl } from '@/lib/supabase/env';

type Props = { params: Promise<{ slug: string }> };

const iso = (day: string) => new Date(`${day}T00:00:00Z`).toISOString();

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const t = await getT();
  const post = await getPost(t.locale, slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      url: `/blog/${slug}`,
      publishedTime: iso(post.date),
      modifiedTime: iso(post.updated ?? post.date),
      authors: ['Postbiz'],
      section: t(`blog.categories.${post.category}`),
    },
  };
}

const Chevron = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0 text-subtle rtl:rotate-180">
    <path d="m4.5 3 3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const pill = 'inline-flex h-9 w-fit items-center gap-2.5 rounded-full border border-line bg-surface px-4 text-xs font-medium text-muted shadow-xs';

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const t = await getT();
  const locale = t.locale;
  const [post, posts] = await Promise.all([getPost(locale, slug), getPosts(locale)]);
  if (!post) notFound();

  const url = `${siteUrl}/blog/${slug}`;
  const category = t(`blog.categories.${post.category}`);
  const text = isForeign(locale, post) ? { lang: post.locale, dir: 'ltr' as const } : {};
  const related = relatedPosts(posts, post);
  const labels = { tip: t('blog.callout.tip'), note: t('blog.callout.note'), warning: t('blog.callout.warning') };
  const showUpdated = post.updated && post.updated !== post.date;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: iso(post.date),
      dateModified: iso(post.updated ?? post.date),
      inLanguage: post.locale,
      articleSection: category,
      mainEntityOfPage: url,
      author: { '@type': 'Organization', name: 'Postbiz', url: siteUrl },
      publisher: { '@type': 'Organization', name: 'Postbiz', url: siteUrl },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('blog.title'), item: `${siteUrl}/blog` },
        { '@type': 'ListItem', position: 2, name: category, item: `${siteUrl}/blog/category/${post.category}` },
        { '@type': 'ListItem', position: 3, name: post.title },
      ],
    },
  ];

  return (
    <article>
      {/* `<` échappé : un titre contenant « </script> » ne peut pas fermer la balise */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <div className="bg-surface">
        <Container className="max-w-[1080px] pt-10 pb-8 sm:pt-14">
          <nav aria-label={t('blog.breadcrumb')}>
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <li><Link href="/blog" className="hover:text-ink">{t('blog.title')}</Link></li>
              <li aria-hidden="true"><Chevron /></li>
              <li><Link href={`/blog/category/${post.category}`} className="hover:text-ink">{category}</Link></li>
              <li aria-hidden="true"><Chevron /></li>
              <li aria-current="page" className="max-w-[40ch] truncate font-medium text-ink" {...text}>{post.title}</li>
            </ol>
          </nav>
          <h1 {...text} className="mt-4 text-[clamp(2rem,4.4vw,3.25rem)] leading-[1.08] font-medium tracking-[-0.03em] text-balance">
            {post.title}
          </h1>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className={`${pill} ps-2`}><LogoMark size={22} />{t(`blog.authors.${post.author}.name`)}</span>
            <time dateTime={post.date} className={pill}>{formatArticleDate(locale, post.date)}</time>
            {showUpdated && <span className={pill}>{t('blog.updated', { date: formatArticleDate(locale, post.updated!) })}</span>}
            <span className={pill}>{t('blog.readTime', { minutes: post.minutes })}</span>
          </div>
        </Container>
      </div>

      {/* Bande à deux tons : blanc au-dessus de la couverture, fond de page en dessous, la coupure passant au milieu de l'image */}
      <div style={{ background: 'linear-gradient(to bottom, var(--color-surface) 50%, var(--color-paper) 50%)' }}>
        <Container className="max-w-[1080px]">
          <PostCover title={post.coverTitle ?? post.title} slug={post.slug} theme={post.cover} className="rounded-xl shadow-xs ring-1 ring-black/5" />
        </Container>
      </div>

      <Container className="max-w-[1080px] pt-12 pb-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {isForeign(locale, post) && <p className="mb-6 text-sm text-subtle">{t('blog.availableIn')}</p>}
            {post.toc.length >= 3 && (
              <details className="group mb-8 rounded-xl border border-line bg-surface lg:hidden">
                <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold">
                  {t('blog.toc')}
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="text-muted transition-transform group-open:rotate-180"><path d="m3 5.5 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </summary>
                <ol {...text} className="grid gap-2 border-t border-line px-4 py-3 text-sm">
                  {post.toc.map((h) => (
                    <li key={h.id}><a href={`#${h.id}`} className="text-muted hover:text-ink">{h.text}</a></li>
                  ))}
                </ol>
              </details>
            )}
            <div {...text}><ArticleBody blocks={post.blocks} labels={labels} /></div>

            <hr className="mt-12 mb-6 border-0 border-t border-dashed border-line" />
            <ShareLinks url={url} title={post.title} />

            <div className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-xs">
              <div className="flex items-center gap-3">
                <LogoMark size={40} />
                <div>
                  <p className="text-xs text-muted">{t('blog.articleBy')}</p>
                  <p className="text-lg font-semibold">{t(`blog.authors.${post.author}.name`)}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-muted">{t(`blog.authors.${post.author}.bio`)}</p>
            </div>
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-24 flex flex-col gap-6">
              {post.toc.length >= 2 && <Toc title={t('blog.toc')} items={post.toc.map((h) => ({ id: h.id, text: h.text }))} itemAttrs={text} />}
              <PostCtaCard />
            </div>
          </aside>
        </div>
      </Container>

      <Container className="max-w-[1080px] pb-20">
        <EndCta />
        {related.length > 0 && (
          <section className="mt-20" aria-labelledby="related">
            <h2 id="related" className="text-2xl font-bold tracking-[-0.02em]">{t('blog.related')}</h2>
            <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-3">
              {related.map((p) => (
                <PostCard key={p.slug} post={p} locale={locale} />
              ))}
            </div>
          </section>
        )}
      </Container>
    </article>
  );
}
