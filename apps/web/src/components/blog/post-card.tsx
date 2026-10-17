import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import { formatArticleDate } from '@/i18n/format';
import { getT } from '@/i18n/server';
import { isForeign } from '@/lib/blog/server';
import type { Post } from '@/lib/blog/types';
import { LogoMark } from '../logo';
import { PostCover } from './post-cover';

/** Carte d'article, comme sur le blog de Chatbase : couverture 16/9, titre, résumé, puis auteur et date. */
export async function PostCard({ post, locale }: { post: Post; locale: Locale }) {
  const t = await getT();
  // Texte dans une autre langue que celle du site : on le dit au navigateur et on le garde de gauche à droite.
  const text = isForeign(locale, post) ? { lang: post.locale, dir: 'ltr' as const } : {};
  return (
    <article className="flex h-full flex-col justify-between">
      <Link href={`/blog/${post.slug}`} className="group flex flex-col gap-2">
        <div className="overflow-hidden rounded-lg bg-wash">
          <PostCover title={post.coverTitle ?? post.title} slug={post.slug} theme={post.cover} className="transition-transform duration-300 ease-out group-hover:scale-[1.025]" />
        </div>
        <h2 {...text} className="mt-1 text-xl leading-6 font-medium text-ink transition-colors group-hover:text-forest-2">{post.title}</h2>
        <p {...text} className="line-clamp-3 text-muted">{post.description}</p>
      </Link>
      <div className="mt-3 flex items-center gap-2 text-sm font-medium select-none">
        <LogoMark size={20} />
        <span>{t(`blog.authors.${post.author}.name`)}</span>
        <span aria-hidden="true" className="h-0.5 w-0.5 rounded-full bg-muted" />
        <time dateTime={post.date}>{formatArticleDate(locale, post.date)}</time>
      </div>
    </article>
  );
}
