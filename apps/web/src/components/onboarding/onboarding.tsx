'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { connectDemoChannelAction } from '@/app/app/onboarding/actions';
import { CAPABILITY_LABEL } from '@/lib/networks';
import { TILE_HINT, type OnboardingTile } from '@/lib/onboarding';

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

const STEPS = ['Connecter des canaux', 'Connecter des agents', 'Regarder le tutoriel'];
const CALENDAR = '/app/calendrier';

/** Onboarding plein écran, ouvert par `?onboarding=true` (après l'inscription), comme dans Postiz. */
export function Onboarding(props: Props) {
  const params = useSearchParams();
  if (!params.get('onboarding')) return null;
  return <OnboardingDialog {...props} />;
}

function OnboardingDialog({ tiles, connected, tutorialUrl }: Props) {
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
      aria-label="Prise en main de Postbiz"
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-[#121211] text-white outline-none"
    >
      <button type="button" onClick={() => setAskClose(true)} aria-label="Fermer la prise en main" className="absolute top-5 right-5 z-10 flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="alertdialog" aria-modal="true" aria-labelledby="ob-close-title">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#1c1c1a] p-6">
            <h2 id="ob-close-title" className="text-lg font-semibold">Quitter la prise en main ?</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/65">Vous pourrez connecter vos canaux plus tard depuis la page Canaux.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" autoFocus onClick={() => setAskClose(false)} className="h-10 rounded-full border border-white/20 px-5 text-sm font-semibold hover:bg-white/10">Rester</button>
              <button type="button" onClick={close} className="h-10 rounded-full bg-lime px-5 text-sm font-semibold text-ink hover:brightness-95">Quitter</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center justify-center gap-3 sm:gap-5" aria-label="Étapes">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const active = step === n;
        return (
          <li key={label} className="flex items-center gap-3 sm:gap-5" aria-current={active ? 'step' : undefined}>
            <span className="flex items-center gap-2.5">
              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${active ? 'bg-white text-ink' : step > n ? 'bg-lime text-ink' : 'bg-white/10 text-white/80'}`}>
                {step > n ? '✓' : n}
              </span>
              <span className={`hidden text-[15px] sm:inline ${active ? 'font-semibold' : 'text-white/70'}`}>{label}</span>
            </span>
            {n < STEPS.length && <span className="hidden h-px w-10 bg-white/50 sm:block sm:w-14" aria-hidden="true" />}
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
      <p className="mx-auto mt-2 max-w-2xl text-[15px] text-white/60">{subtitle}</p>
    </div>
  );
}

const ArrowRight = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
);

const PrimaryButton = (props: React.ComponentProps<'button'>) => (
  <button {...props} className="group flex h-12 items-center gap-3 rounded-xl bg-lime px-7 text-[15px] font-semibold text-ink shadow-[0_8px_30px_-8px_rgba(198,244,50,0.45)] transition hover:brightness-95" />
);

const BackButton = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="flex h-12 items-center gap-2 rounded-xl border-2 border-white/25 px-6 text-[15px] font-medium hover:bg-white/10">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7M19 12H5" /></svg>
    Retour
  </button>
);

/* ------------------------------------------------------------------ Étape 1 */

function StepChannels({ tiles, connected, onNext }: { tiles: OnboardingTile[]; connected: ConnectedChannel[]; onNext: () => void }) {
  const [help, setHelp] = useState<string | null>(null);

  return (
    <div className="flex flex-1 flex-col">
      <Heading title="Connectez vos canaux" subtitle="Connectez vos comptes de réseaux sociaux pour commencer à programmer des publications et à répondre à vos messages." />

      {connected.length > 0 && (
        <section className="mt-8 rounded-2xl bg-white/5 p-4" aria-label="Canaux connectés">
          <p className="text-sm font-medium">Canaux connectés ({connected.length})</p>
          <ul className="mt-3 flex flex-wrap gap-3">
            {connected.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} aria-hidden="true" />
                {c.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-[15px] font-medium">Cliquez sur un canal pour l’ajouter</p>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <li key={t.id} className="relative">
            <Tile tile={t} />
            <button
              type="button"
              aria-expanded={help === t.id}
              aria-label={`À savoir sur ${t.name}`}
              onClick={() => setHelp(help === t.id ? null : t.id)}
              className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-ink"
            >
              ?
            </button>
            {help === t.id && (
              <div role="note" className="absolute top-9 right-0 left-0 z-20 rounded-xl border border-white/10 bg-[#2a2a27] p-3 text-xs leading-relaxed text-white/85 shadow-xl">
                <p className="font-semibold">{t.name}</p>
                <p className="mt-1 text-white/70">
                  Publier : {CAPABILITY_LABEL[t.capabilities.publish]} · Messages : {CAPABILITY_LABEL[t.capabilities.dm]} · Commentaires : {CAPABILITY_LABEL[t.capabilities.comments]}
                </p>
                {t.note && <p className="mt-1.5 text-white/70">{t.note}</p>}
                <p className="mt-1.5 text-white/55">{TILE_HINT[t.state]}</p>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex justify-end pt-10">
        <PrimaryButton type="button" onClick={onNext}>
          {connected.length > 0 ? 'Continuer' : 'Continuer sans canaux'}
          <ArrowRight />
        </PrimaryButton>
      </div>
    </div>
  );
}

function Tile({ tile }: { tile: OnboardingTile }) {
  const inner = (
    <>
      <span className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: tile.color }} aria-hidden="true">
        {tile.name.slice(0, 1)}
      </span>
      <span className="mt-3 text-[15px] font-medium">{tile.name}</span>
    </>
  );
  const base = 'flex h-[132px] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#1c1c1a] transition';

  if (tile.state === 'connect') {
    // Le démarrage OAuth est un POST same-origin (voir app/api/oauth/start/[network]).
    return (
      <form method="post" action={`/api/oauth/start/${tile.id}`}>
        <input type="hidden" name="next" value="/app/calendrier?onboarding=true" />
        <button type="submit" className={`${base} cursor-pointer hover:border-lime/60 hover:bg-[#242421]`}>{inner}</button>
      </form>
    );
  }
  if (tile.state === 'demo') {
    return (
      <form action={connectDemoChannelAction}>
        <input type="hidden" name="networkId" value={tile.id} />
        <button type="submit" className={`${base} cursor-pointer hover:border-lime/60 hover:bg-[#242421]`}>{inner}</button>
      </form>
    );
  }
  return (
    <button type="button" disabled title={TILE_HINT[tile.state]} className={`${base} cursor-not-allowed opacity-45`}>
      {inner}
    </button>
  );
}

/* ------------------------------------------------------------------ Étape 2 */

const AGENT_OPTIONS = [
  { title: 'Serveur MCP', text: 'Donnez à votre agent (Claude, ChatGPT, Cursor…) des outils pour créer, programmer et gérer vos publications.' },
  { title: 'Ligne de commande', text: 'Installez la CLI Postbiz et laissez votre agent l’utiliser depuis votre terminal.' },
  { title: 'API publique', text: 'Pilotez Postbiz depuis vos propres outils (n8n, Make, scripts).' },
];

function StepAgents({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <Heading title="Connectez votre agent IA" subtitle="Laissez l’agent de votre choix créer et programmer des publications pour vous." />

      <p className="mx-auto mt-8 max-w-2xl rounded-2xl border border-lime/30 bg-lime/10 px-5 py-4 text-center text-[15px] leading-relaxed text-lime">
        Cette étape s’activera bientôt : le serveur MCP, la CLI et l’API publique de Postbiz ne sont pas encore disponibles. Vous pouvez la passer.
      </p>

      <ul className="mx-auto mt-8 grid w-full max-w-4xl gap-4 md:grid-cols-3">
        {AGENT_OPTIONS.map((o) => (
          <li key={o.title} className="rounded-2xl border border-white/10 bg-[#1c1c1a] p-6 opacity-70">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{o.title}</h2>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/80">Bientôt</span>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-white/60">{o.text}</p>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center justify-between pt-10">
        <BackButton onClick={onBack} />
        <PrimaryButton type="button" onClick={onNext}>
          Continuer / Passer
          <ArrowRight />
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Étape 3 */

const CHECKLIST = [
  { title: 'Connectez un canal', text: 'Depuis la page Canaux : vos comptes Facebook, Instagram, X, LinkedIn, TikTok ou YouTube.', href: '/app/canaux', cta: 'Ouvrir Canaux' },
  { title: 'Programmez une publication', text: 'Dans le calendrier, cliquez sur un créneau libre, écrivez, choisissez les canaux.', href: '/app/calendrier', cta: 'Ouvrir le calendrier' },
  { title: 'Répondez à vos messages', text: 'Les messages privés et commentaires arrivent en direct dans la boîte de réception.', href: '/app/inbox', cta: 'Ouvrir la boîte de réception' },
];

function StepTutorial({ tutorialUrl, onBack, onFinish }: { tutorialUrl: string | null; onBack: () => void; onFinish: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <Heading
        title="Apprenez à utiliser Postbiz"
        subtitle={tutorialUrl ? 'Regardez cette courte vidéo pour tirer le meilleur parti de Postbiz.' : 'Trois gestes suffisent pour démarrer.'}
      />

      {tutorialUrl ? (
        <div className="mx-auto mt-8 w-full max-w-4xl flex-1">
          <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
            <iframe className="h-full w-full" src={tutorialUrl} title="Tutoriel Postbiz" allow="autoplay; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          </div>
        </div>
      ) : (
        <ol className="mx-auto mt-8 grid w-full max-w-4xl gap-4 md:grid-cols-3">
          {CHECKLIST.map((c, i) => (
            <li key={c.title} className="flex flex-col rounded-2xl border border-white/10 bg-[#1c1c1a] p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm font-bold">{i + 1}</span>
              <h2 className="mt-4 text-lg font-semibold">{c.title}</h2>
              <p className="mt-2 flex-1 text-[15px] leading-relaxed text-white/60">{c.text}</p>
              <Link href={c.href} className="mt-5 text-sm font-semibold text-lime underline underline-offset-4">{c.cta}</Link>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-auto flex items-center justify-between pt-10">
        <BackButton onClick={onBack} />
        <button type="button" onClick={onFinish} className="flex h-12 items-center gap-3 rounded-xl bg-lime px-7 text-[15px] font-semibold text-ink shadow-[0_8px_30px_-8px_rgba(198,244,50,0.45)] transition hover:brightness-95">
          Commencer
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m22 4-10 10-3-3" /></svg>
        </button>
      </div>
    </div>
  );
}
