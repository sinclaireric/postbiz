'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { connectDemoChannelAction } from '@/app/app/onboarding/actions';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/types';
import { capabilityKey, networkName, networkNoteKey, type Network } from '@/lib/networks';
import { TILE_HINT_KEY, type OnboardingTile } from '@/lib/onboarding';

export interface ConnectedChannel {
  id: string;
  name: string;
  networkId: string;
  color: string;
}

interface Props {
  tiles: OnboardingTile[];
  connected: ConnectedChannel[];
  tutorialUrl: string | null;
}

const STEP_KEYS: MessageKey[] = ['app.onboarding.step1', 'app.onboarding.step2', 'app.onboarding.step3'];
const CALENDAR = '/app/calendrier';

/** Onboarding plein écran, ouvert par `?onboarding=true` (après l'inscription), comme dans Postiz. */
export function Onboarding(props: Props) {
  const params = useSearchParams();
  if (!params.get('onboarding')) return null;
  return <OnboardingDialog {...props} />;
}

function OnboardingDialog({ tiles, connected, tutorialUrl }: Props) {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [askClose, setAskClose] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const close = () => router.push(CALENDAR);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  // Échap demande confirmation au lieu de fermer d'un coup (comme Postiz).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAskClose(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t('app.onboarding.label')}
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-white text-ink outline-none"
    >
      <button type="button" onClick={() => setAskClose(true)} aria-label={t('app.onboarding.closeLabel')} className="absolute top-5 end-5 z-10 flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-wash hover:text-ink">
        <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2 2 10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-5 pt-8 pb-8 sm:px-10">
        <Stepper step={step} />
        <div className="mt-10 flex flex-1 flex-col">
          {step === 1 && <StepChannels tiles={tiles} connected={connected} onNext={() => setStep(2)} />}
          {step === 2 && <StepAgents onBack={() => setStep(1)} onNext={() => setStep(3)} />}
          {step === 3 && <StepTutorial tutorialUrl={tutorialUrl} onBack={() => setStep(2)} onFinish={close} />}
        </div>
      </div>

      {askClose && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby="ob-close-title">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <h2 id="ob-close-title" className="text-lg font-semibold">{t('app.onboarding.quitTitle')}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t('app.onboarding.quitText')}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" autoFocus onClick={() => setAskClose(false)} className="h-10 rounded-full border border-line px-5 text-sm font-semibold hover:bg-wash">{t('app.onboarding.stay')}</button>
              <button type="button" onClick={close} className="h-10 rounded-full bg-lime px-5 text-sm font-semibold text-ink hover:brightness-95">{t('app.onboarding.quit')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const t = useT();
  return (
    <ol className="flex items-center justify-center gap-3 sm:gap-5" aria-label={t('app.onboarding.steps')}>
      {STEP_KEYS.map((key, i) => {
        const n = i + 1;
        const active = step === n;
        return (
          <li key={key} className="flex items-center gap-3 sm:gap-5" aria-current={active ? 'step' : undefined}>
            <span className="flex items-center gap-2.5">
              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${active ? 'bg-ink text-white' : step > n ? 'bg-lime text-ink' : 'bg-wash text-muted'}`}>
                {step > n ? '✓' : n}
              </span>
              <span className={`hidden text-[15px] sm:inline ${active ? 'font-semibold' : 'text-muted'}`}>{t(key)}</span>
            </span>
            {n < STEP_KEYS.length && <span className="hidden h-px w-10 bg-line sm:block sm:w-14" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="text-center">
      <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-2xl text-[15px] text-muted">{subtitle}</p>
    </div>
  );
}

const ArrowRight = () => (
  <svg className="rtl:rotate-180" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
);

const PrimaryButton = (props: React.ComponentProps<'button'>) => (
  <button {...props} className="group flex h-12 items-center gap-3 rounded-xl bg-lime px-7 text-[15px] font-semibold text-ink shadow-[0_8px_30px_-8px_rgba(198,244,50,0.45)] transition hover:brightness-95" />
);

const BackButton = ({ onClick }: { onClick: () => void }) => {
  const t = useT();
  return (
    <button type="button" onClick={onClick} className="flex h-12 items-center gap-2 rounded-xl border-2 border-line px-6 text-[15px] font-medium hover:bg-wash">
      <svg className="rtl:rotate-180" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7M19 12H5" /></svg>
      {t('common.back')}
    </button>
  );
};

/* ------------------------------------------------------------------ Étape 1 */

function StepChannels({ tiles, connected, onNext }: { tiles: OnboardingTile[]; connected: ConnectedChannel[]; onNext: () => void }) {
  const t = useT();
  const [help, setHelp] = useState<string | null>(null);

  return (
    <div className="flex flex-1 flex-col">
      <Heading title={t('app.onboarding.channelsTitle')} subtitle={t('app.onboarding.channelsSubtitle')} />

      {connected.length > 0 && (
        <section className="mt-8 rounded-2xl bg-wash p-4" aria-label={t('app.onboarding.connectedChannels', { count: connected.length })}>
          <p className="text-sm font-medium">{t('app.onboarding.connectedChannels', { count: connected.length })}</p>
          <ul className="mt-3 flex flex-wrap gap-3">
            {connected.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} aria-hidden="true" />
                {c.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-[15px] font-medium">{t('app.onboarding.clickToAdd')}</p>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <li key={tile.id} className="relative">
            <Tile tile={tile} />
            <button
              type="button"
              aria-expanded={help === tile.id}
              aria-label={t('app.onboarding.about', { name: networkName(tile.id) })}
              onClick={() => setHelp(help === tile.id ? null : tile.id)}
              className="absolute top-2 end-2 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white"
            >
              ?
            </button>
            {help === tile.id && (
              <div role="note" className="absolute top-9 inset-x-0 z-20 rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed text-ink shadow-xl">
                <p className="font-semibold">{networkName(tile.id)}</p>
                <p className="mt-1 text-muted">
                  {t('app.onboarding.capabilities', { publish: t(capabilityKey(tile.capabilities.publish)), dm: t(capabilityKey(tile.capabilities.dm)), comments: t(capabilityKey(tile.capabilities.comments)) })}
                </p>
                <p className="mt-1.5 text-muted">{t(networkNoteKey(tile.id as Network['id']))}</p>
                <p className="mt-1.5 text-subtle">{t(TILE_HINT_KEY[tile.state])}</p>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex justify-end pt-10">
        <PrimaryButton type="button" onClick={onNext}>
          {connected.length > 0 ? t('app.onboarding.continueWith') : t('app.onboarding.continueWithout')}
          <ArrowRight />
        </PrimaryButton>
      </div>
    </div>
  );
}

function Tile({ tile }: { tile: OnboardingTile }) {
  const t = useT();
  const name = networkName(tile.id);
  const inner = (
    <>
      <span className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: tile.color }} aria-hidden="true">
        {name.slice(0, 1)}
      </span>
      <span className="mt-3 text-[15px] font-medium">{name}</span>
    </>
  );
  const base = 'flex h-[132px] w-full flex-col items-center justify-center rounded-2xl border border-line bg-surface transition';

  if (tile.state === 'connect') {
    // Le démarrage OAuth est un POST same-origin (voir app/api/oauth/start/[network]).
    return (
      <form method="post" action={`/api/oauth/start/${tile.id}`}>
        <input type="hidden" name="next" value="/app/calendrier?onboarding=true" />
        <button type="submit" className={`${base} cursor-pointer hover:border-ink/30 hover:bg-wash`}>{inner}</button>
      </form>
    );
  }
  if (tile.state === 'demo') {
    return (
      <form action={connectDemoChannelAction}>
        <input type="hidden" name="networkId" value={tile.id} />
        <button type="submit" className={`${base} cursor-pointer hover:border-ink/30 hover:bg-wash`}>{inner}</button>
      </form>
    );
  }
  return (
    <button type="button" disabled title={t(TILE_HINT_KEY[tile.state])} className={`${base} cursor-not-allowed opacity-45`}>
      {inner}
    </button>
  );
}

/* ------------------------------------------------------------------ Étape 2 */

function StepAgents({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const t = useT();
  const options = [
    { title: t('app.onboarding.mcpTitle'), text: t('app.onboarding.mcpText') },
    { title: t('app.onboarding.cliTitle'), text: t('app.onboarding.cliText') },
    { title: t('app.onboarding.apiTitle'), text: t('app.onboarding.apiText') },
  ];
  return (
    <div className="flex flex-1 flex-col">
      <Heading title={t('app.onboarding.agentsTitle')} subtitle={t('app.onboarding.agentsSubtitle')} />

      <p className="mx-auto mt-8 max-w-2xl rounded-2xl border border-lime bg-lime-soft px-5 py-4 text-center text-[15px] leading-relaxed text-forest">
        {t('app.onboarding.agentsSoon')}
      </p>

      <ul className="mx-auto mt-8 grid w-full max-w-4xl gap-4 md:grid-cols-3">
        {options.map((o) => (
          <li key={o.title} className="rounded-2xl border border-line bg-surface p-6 opacity-70">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{o.title}</h2>
              <span className="rounded-full bg-wash px-2.5 py-0.5 text-xs font-semibold text-muted">{t('app.onboarding.soon')}</span>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">{o.text}</p>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center justify-between pt-10">
        <BackButton onClick={onBack} />
        <PrimaryButton type="button" onClick={onNext}>
          {t('app.onboarding.continueSkip')}
          <ArrowRight />
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Étape 3 */

function StepTutorial({ tutorialUrl, onBack, onFinish }: { tutorialUrl: string | null; onBack: () => void; onFinish: () => void }) {
  const t = useT();
  const checklist = [
    { title: t('app.onboarding.check1.title'), text: t('app.onboarding.check1.text'), href: '/app/canaux', cta: t('app.onboarding.check1.cta') },
    { title: t('app.onboarding.check2.title'), text: t('app.onboarding.check2.text'), href: '/app/calendrier', cta: t('app.onboarding.check2.cta') },
    { title: t('app.onboarding.check3.title'), text: t('app.onboarding.check3.text'), href: '/app/inbox', cta: t('app.onboarding.check3.cta') },
  ];
  return (
    <div className="flex flex-1 flex-col">
      <Heading title={t('app.onboarding.tutorialTitle')} subtitle={tutorialUrl ? t('app.onboarding.tutorialVideo') : t('app.onboarding.tutorialSteps')} />

      {tutorialUrl ? (
        <div className="mx-auto mt-8 w-full max-w-4xl flex-1">
          <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
            <iframe className="h-full w-full" src={tutorialUrl} title={t('app.onboarding.videoTitle')} allow="autoplay; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          </div>
        </div>
      ) : (
        <ol className="mx-auto mt-8 grid w-full max-w-4xl gap-4 md:grid-cols-3">
          {checklist.map((c, i) => (
            <li key={c.title} className="flex flex-col rounded-2xl border border-line bg-surface p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-wash text-sm font-bold">{i + 1}</span>
              <h2 className="mt-4 text-lg font-semibold">{c.title}</h2>
              <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted">{c.text}</p>
              <Link href={c.href} className="mt-5 text-sm font-semibold text-forest underline underline-offset-4">{c.cta}</Link>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-auto flex items-center justify-between pt-10">
        <BackButton onClick={onBack} />
        <button type="button" onClick={onFinish} className="flex h-12 items-center gap-3 rounded-xl bg-lime px-7 text-[15px] font-semibold text-ink shadow-[0_8px_30px_-8px_rgba(198,244,50,0.45)] transition hover:brightness-95">
          {t('app.onboarding.start')}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m22 4-10 10-3-3" /></svg>
        </button>
      </div>
    </div>
  );
}
