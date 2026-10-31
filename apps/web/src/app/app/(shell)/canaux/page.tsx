import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SettingsTabs } from '@/components/app/settings-tabs';
import { ChannelAvatar } from '@/components/calendar/channel-avatar';
import { SocialIcon } from '@/components/social-icon';
import { RichText } from '@/components/rich-text';
import { Badge } from '@/components/ui';
import { getT } from '@/i18n/server';
import type { MessageKey, T } from '@/i18n/types';
import { getRepositories, getSession } from '@/lib/data';
import { APP_NETWORKS, capabilityKey, networkName, networkNoteKey } from '@/lib/networks';
import { networkAvailability } from '@/lib/oauth/availability';
import { ERROR_MESSAGES, type ErrorCode } from '@/lib/oauth/flow';
import { DisconnectButton } from './disconnect-button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('meta.channelsApp') };
}
export const dynamic = 'force-dynamic';

const STATUS = {
  active: { key: 'app.channelsPage.status.active', tone: 'ok' as const },
  refresh_needed: { key: 'app.channelsPage.status.refresh_needed', tone: 'warn' as const },
  disabled: { key: 'app.channelsPage.status.disabled', tone: 'neutral' as const },
} satisfies Record<string, { key: MessageKey; tone: 'ok' | 'warn' | 'neutral' }>;

type Search = { connecte?: string; deconnecte?: string; erreur?: string; reseau?: string; webhooks?: string; nettoyage?: string };

/** Les messages viennent de codes fixes : on n'affiche jamais un texte pris dans l'URL. */
function banner(t: T, q: Search): { tone: 'ok' | 'warn' | 'danger'; text: string } | null {
  if (q.erreur) {
    const code = (q.erreur in ERROR_MESSAGES ? q.erreur : 'erreur') as ErrorCode;
    const net = q.reseau ? networkName(q.reseau) : undefined;
    const text = t(`app.oauthErrors.${code}`);
    return { tone: 'danger', text: net && net !== q.reseau ? `${net} : ${text}` : text };
  }
  if (q.connecte) {
    const n = Math.max(0, Math.min(99, Number.parseInt(q.connecte, 10) || 0));
    const warn = q.webhooks === 'ko' ? ` ${t('app.channelsPage.flashWebhooks')}` : '';
    return { tone: q.webhooks === 'ko' ? 'warn' : 'ok', text: `${t('app.channelsPage.flashConnected', { count: n })}.${warn}` };
  }
  if (q.deconnecte) {
    return q.nettoyage === 'ko'
      ? { tone: 'warn', text: t('app.channelsPage.flashCleanupFailed') }
      : { tone: 'ok', text: t('app.channelsPage.flashDisconnected') };
  }
  return null;
}

const BANNER_CLASS = { ok: 'border-ok/30 bg-ok-soft text-ok', warn: 'border-warn/30 bg-warn-soft text-warn', danger: 'border-danger/30 bg-danger-soft text-danger' };

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getT();
  const session = await getSession();
  if (session.status !== 'ready') redirect('/login');
  const repos = await getRepositories(session.ctx);
  const integrations = await repos.workspace.integrations();
  const q = await searchParams;
  const flash = banner(t, q);

  const isAdmin = session.ctx.org.role === 'admin';
  const demo = session.ctx.mode === 'demo';
  const availability = networkAvailability(process.env, demo);
  const anyAvailable = Object.values(availability).some((a) => a.available);

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <SettingsTabs current="channels" t={t} />
      <p className="text-muted">{t('app.channelsPage.intro')}</p>

      {flash && <p role="status" className={`mt-5 rounded-2xl border px-4 py-3 text-sm leading-relaxed ${BANNER_CLASS[flash.tone]}`}>{flash.text}</p>}

      <section className="mt-8" aria-labelledby="connected">
        <h2 id="connected" className="text-sm font-semibold tracking-wide text-muted uppercase">{t('app.channelsPage.connectedTitle', { count: integrations.length })}</h2>
        {integrations.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-line bg-surface p-8 text-center text-muted">{t('app.channelsPage.noneConnected')}</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {integrations.map((i) => (
              <li key={i.id} className="flex min-w-0 items-center gap-4 rounded-2xl border border-line bg-surface p-4">
                <ChannelAvatar channel={i} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{i.name}</span>
                  <span className="block truncate text-sm text-muted">{networkName(i.networkId)}{i.username ? ` · ${i.username}` : ''}</span>
                </span>
                <span className="flex flex-col items-end gap-2">
                  <Badge tone={STATUS[i.status].tone}>{t(STATUS[i.status].key)}</Badge>
                  {isAdmin && !demo && (
                    <span className="flex items-center gap-2">
                      {i.status === 'refresh_needed' && availability[i.networkId]?.available && (
                        <form method="post" action={`/api/oauth/start/${i.networkId}`}>
                          <button type="submit" className="h-8 rounded-full bg-ink px-3 text-xs font-semibold text-white">{t('app.channelsPage.reconnectButton')}</button>
                        </form>
                      )}
                      <DisconnectButton integrationId={i.id} name={i.name} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="add">
        <h2 id="add" className="text-sm font-semibold tracking-wide text-muted uppercase">{t('app.channelsPage.addTitle')}</h2>
        {!anyAvailable && (
          <div className="mt-3 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
            {demo ? t('app.channelsPage.demoWarn') : t('app.channelsPage.configWarn')}{' '}
            <RichText t={t} k="app.channelsPage.seeDocs" tags={{ code: (x) => <code dir="ltr">{x}</code> }} />
          </div>
        )}
        {anyAvailable && !isAdmin && (
          <p className="mt-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted">{t('app.channelsPage.adminOnly')}</p>
        )}
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {APP_NETWORKS.map((n) => {
            const a = availability[n.id] ?? { available: false, missing: [] };
            const enabled = a.available && isAdmin;
            const why = demo
              ? t('app.channelsPage.whyDemo')
              : !a.available
                ? t('app.channelsPage.whyMissing', { missing: a.missing.join(', ') })
                : !isAdmin
                  ? t('app.channelsPage.whyAdmin')
                  : t('app.channelsPage.whyConnect', { name: networkName(n.id) });
            return (
              <li key={n.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-2.5 font-semibold"><SocialIcon id={n.id} size={28} />{networkName(n.id)}</p>
                  <form method="post" action={`/api/oauth/start/${n.id}`}>
                    <button
                      type="submit"
                      disabled={!enabled}
                      title={why}
                      className={`h-9 rounded-full border px-4 text-sm font-semibold ${enabled ? 'border-ink bg-ink text-white hover:bg-black/80' : 'cursor-not-allowed border-line text-subtle'}`}
                    >
                      {t('app.channelsPage.connect')}
                    </button>
                  </form>
                </div>
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>{t('app.channelsPage.publish', { status: t(capabilityKey(n.publish)) })}</span>
                  <span>{t('app.channelsPage.messages', { status: t(capabilityKey(n.dm)) })}</span>
                  <span>{t('app.channelsPage.comments', { status: t(capabilityKey(n.comments)) })}</span>
                </p>
                <p className="mt-2 text-xs leading-relaxed text-subtle">{t(networkNoteKey(n.id))}</p>
                {(n.id === 'instagram' || n.id === 'instagram_standalone') && (
                  <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">{t('app.channelsPage.proAccountRequired')}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
