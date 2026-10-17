import Link from 'next/link';
import { Container, buttonClass } from '@/components/ui';
import { getT } from '@/i18n/server';

export default async function BlogNotFound() {
  const t = await getT();
  return (
    <Container className="max-w-2xl py-24 text-center sm:py-32">
      <p className="text-sm font-bold tracking-[0.14em] text-muted uppercase">404</p>
      <h1 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] leading-[1.08] font-semibold tracking-[-0.03em]">{t('blog.notFound.title')}</h1>
      <p className="mt-4 text-lg text-muted">{t('blog.notFound.text')}</p>
      <Link href="/blog" className={`${buttonClass('primary', 'lg')} mt-8`}>{t('blog.backToBlog')}</Link>
    </Container>
  );
}
