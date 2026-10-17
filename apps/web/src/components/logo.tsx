import Link from 'next/link';

export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="9" fill="#c6f432" />
      <path d="M10 8h7.5a5.5 5.5 0 0 1 0 11H14v5h-4V8Zm4 3.6v3.8h3.3a1.9 1.9 0 0 0 0-3.8H14Z" fill="#111110" />
    </svg>
  );
}

export function Logo({ href = '/', className = '' }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 text-[19px] font-extrabold tracking-tight ${className}`} aria-label="Postbiz, accueil">
      <LogoMark />
      <span>postbiz</span>
    </Link>
  );
}
