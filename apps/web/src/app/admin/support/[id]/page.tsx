import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SupportThreadView, type SupportThreadLabels } from '@/components/admin/support-thread';
import { formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/server';
import { requireAdmin } from '@/lib/admin/guard';
import { loadSupportConversation } from '@/lib/admin/support-data';
import { SUPPORT_THREAD_LIMIT } from '@/lib/support/logic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('admin.nav.support') };
}
export const dynamic = 'force-dynamic';

export default async function AdminSupportThreadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const t = await getT();
  const { id } = await params;
  const thread = await loadSupportConversation(id);
  if (!thread) notFound();

  const failed = t('admin.support.errors.failed');
  const labels: SupportThreadLabels = {
    support: t('admin.support.thread.support'),
    reply: t('admin.support.reply.label'),
    placeholder: t('admin.support.reply.placeholder'),
    send: t('admin.support.reply.send'),
    sending: t('admin.support.reply.sending'),
    hint: t('admin.support.reply.hint'),
    resolve: t('admin.support.reply.resolve'),
    reopen: t('admin.support.reply.reopen'),
    resolvedNote: t('admin.support.thread.resolvedNote'),
    truncated: t('admin.support.thread.truncated', { count: formatNumber(t.locale, SUPPORT_THREAD_LIMIT) }),
    profile: t('admin.support.thread.profile'),
    workspace: t('admin.support.thread.workspace'),
    empty: t('admin.support.thread.empty'),
    errors: {
      invalid_message: t('admin.support.errors.invalid_message'),
      message_too_long: t('admin.support.errors.message_too_long'),
      rate_limited: failed,
      too_many_unanswered: failed,
      failed,
      not_found: t('admin.support.errors.not_found'),
      forbidden: t('admin.support.errors.forbidden'),
    },
  };

  return (
    <>
      <Link href="/admin/support" className="text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">← {t('admin.support.thread.back')}</Link>
      <h1 className="mt-2 mb-5 text-[28px] font-semibold tracking-tight">{t('admin.support.title')}</h1>
      <SupportThreadView initial={thread} labels={labels} />
    </>
  );
}
