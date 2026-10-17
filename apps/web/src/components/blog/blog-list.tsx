import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import { getT } from '@/i18n/server';
import { listHref, paginate } from '@/lib/blog/logic';
import { CATEGORIES, type Category, type Post } from '@/lib/blog/types';
import { buttonClass } from '../ui';
import { PostCard } from './post-card';

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-subtle">
    <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
    <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * Page de liste du blog, mise en page du blog de Chatbase : barre latérale collante (recherche, catégories) à gauche,
 * titre puis grille de deux colonnes à droite. Sert `/blog` et `/blog/category/<catégorie>`.
 */
export async function BlogList({ posts, locale, category, q, page, foreign }: { posts: Post[]; locale: Locale; category?: Category; q: string; page: number; foreign: boolean }) {
  const t = await getT();
  const paged = paginate(posts, page);
  if (page > paged.pages) notFound(); // `?page=99` : une page qui n'existe pas n'est pas la dernière
  const base = category ? `/blog/category/${category}` : '/blog';

  const categoryLinks = [
    { id: undefined, href: listHref({ q }), label: t('blog.categories.all') },
    ...CATEGORIES.map((id) => ({ id, href: listHref({ category: id, q }), label: t(`blog.categories.${id}`) })),
  ];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8 md:grid md:grid-cols-[176px_minmax(0,1fr)] md:py-14">
      <aside className="md:border-e md:border-line md:pe-6">
        <div className="flex flex-col gap-5 md:sticky md:top-24">
          <form role="search" action={base} method="get" className="relative">
            <label htmlFor="blog-search" className="sr-only">{t('blog.searchLabel')}</label>
            <SearchIcon />
            <input
              id="blog-search"
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t('blog.searchPlaceholder')}
              maxLength={80}
              className="h-9 w-full rounded-md border border-line bg-surface ps-9 pe-3 text-sm placeholder:text-subtle"
            />
          </form>
          <nav aria-label={t('blog.categoriesLabel')}>
            <p className="hidden text-xs text-muted md:block">{t('blog.categoriesLabel')}</p>
            <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:mt-3 md:flex-col md:gap-3 md:overflow-visible md:px-0 md:pb-0">
              {categoryLinks.map((c) => {
                const active = c.id === category;
                return (
                  <li key={c.id ?? 'all'} className="shrink-0">
                    <Link
                      href={c.href}
                      aria-current={active ? 'page' : undefined}
                      className={`block text-sm font-medium max-md:rounded-full max-md:border max-md:px-3.5 max-md:py-1.5 ${
                        active ? 'text-ink max-md:border-ink max-md:bg-ink max-md:text-white md:font-bold' : 'text-muted hover:text-ink max-md:border-line max-md:bg-surface'
                      }`}
                    >
                      {c.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </aside>

      <div className="mt-8 md:mt-0 md:ps-12 lg:ps-16">
        <h1 className="text-[clamp(2.25rem,4vw,3rem)] leading-none font-bold tracking-[-0.035em]">{category ? t(`blog.categories.${category}`) : t('blog.title')}</h1>
        <p className="mt-4 text-lg text-muted">{q ? t('blog.searchResults', { query: q }) : t('blog.subtitle')}</p>
        {foreign && <p className="mt-2 text-sm text-subtle">{t('blog.availableIn')}</p>}

        {paged.items.length ? (
          <div className="mt-10 grid grid-cols-1 gap-12 md:grid-cols-2">
            {paged.items.map((post) => (
              <PostCard key={post.slug} post={post} locale={locale} />
            ))}
          </div>
        ) : (
          <div className="mt-10 rounded-2xl border border-dashed border-line p-10 text-center">
            <p className="text-muted">{t('blog.empty')}</p>
            {q && <Link href={listHref({ category })} className={`${buttonClass('secondary', 'sm')} mt-4`}>{t('blog.clearSearch')}</Link>}
          </div>
        )}

        {paged.pages > 1 && (
          <nav aria-label={t('blog.pagination.label')} className="mt-14 flex items-center justify-between gap-4">
            {paged.page > 1 ? (
              <Link href={listHref({ category, q, page: paged.page - 1 })} rel="prev" className={buttonClass('secondary', 'sm')}>
                <span aria-hidden="true" className="rtl:rotate-180">←</span> {t('blog.pagination.previous')}
              </Link>
            ) : <span />}
            <p className="text-sm text-muted">{t('blog.pagination.page', { page: paged.page, pages: paged.pages })}</p>
            {paged.page < paged.pages ? (
              <Link href={listHref({ category, q, page: paged.page + 1 })} rel="next" className={buttonClass('secondary', 'sm')}>
                {t('blog.pagination.next')} <span aria-hidden="true" className="rtl:rotate-180">→</span>
              </Link>
            ) : <span />}
          </nav>
        )}
      </div>
    </div>
  );
}
