import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'lime';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none';
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-black/80',
  secondary: 'bg-surface text-ink border border-line hover:bg-wash',
  ghost: 'text-ink hover:bg-wash',
  lime: 'bg-lime text-ink hover:brightness-95',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-5 text-[15px]',
  lg: 'h-12 px-6 text-base',
};

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', extra = '') =>
  `${base} ${variants[variant]} ${sizes[size]} ${extra}`.trim();

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

/** Petit intitulé en capitales au-dessus d'un titre de section. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-xs font-bold tracking-[0.14em] text-muted uppercase ${className}`}>{children}</p>;
}

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1200px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'lime' | 'danger' }) {
  const tones = {
    neutral: 'bg-wash text-muted',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    lime: 'bg-lime-soft text-forest',
    danger: 'bg-danger-soft text-danger',
  } as const;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
