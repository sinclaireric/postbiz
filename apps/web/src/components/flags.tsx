import type { LocaleMeta } from '@/i18n/config';

type Code = LocaleMeta['flag'];

/** Points d'une étoile à cinq branches. */
function star(cx: number, cy: number, r: number, rotation = -90): string {
  return Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? r : r * 0.382;
    const a = ((rotation + i * 36) * Math.PI) / 180;
    return `${(cx + radius * Math.cos(a)).toFixed(2)},${(cy + radius * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

const FLAGS: Record<Code, React.ReactNode> = {
  gb: (
    <>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0 30 20M30 0 0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0 30 20M30 0 0 20" stroke="#c8102e" strokeWidth="1.6" />
      <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3.4" />
    </>
  ),
  il: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <rect y="2.5" width="30" height="2.6" fill="#0038b8" />
      <rect y="14.9" width="30" height="2.6" fill="#0038b8" />
      <polygon points="15,5.8 19.3,13.2 10.7,13.2" fill="none" stroke="#0038b8" strokeWidth="0.9" />
      <polygon points="15,14.2 10.7,6.8 19.3,6.8" fill="none" stroke="#0038b8" strokeWidth="0.9" />
    </>
  ),
  ru: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <rect y="6.67" width="30" height="6.67" fill="#0039a6" />
      <rect y="13.33" width="30" height="6.67" fill="#d52b1e" />
    </>
  ),
  cn: (
    <>
      <rect width="30" height="20" fill="#de2910" />
      <polygon points={star(5.5, 5.5, 3.2)} fill="#ffde00" />
      <polygon points={star(11, 2.4, 1)} fill="#ffde00" />
      <polygon points={star(13, 4.6, 1)} fill="#ffde00" />
      <polygon points={star(13, 7.6, 1)} fill="#ffde00" />
      <polygon points={star(11, 9.8, 1)} fill="#ffde00" />
    </>
  ),
  fr: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <rect width="10" height="20" fill="#002395" />
      <rect x="20" width="10" height="20" fill="#ed2939" />
    </>
  ),
  es: (
    <>
      <rect width="30" height="20" fill="#aa151b" />
      <rect y="5" width="30" height="10" fill="#f1bf00" />
    </>
  ),
  pt: (
    <>
      <rect width="30" height="20" fill="#ff0000" />
      <rect width="12" height="20" fill="#006600" />
      <circle cx="12" cy="10" r="3.6" fill="#ffcc00" />
      <circle cx="12" cy="10" r="2" fill="#fff" stroke="#ff0000" strokeWidth="0.8" />
    </>
  ),
  de: (
    <>
      <rect width="30" height="20" fill="#ffce00" />
      <rect width="30" height="13.33" fill="#dd0000" />
      <rect width="30" height="6.67" fill="#000" />
    </>
  ),
  it: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <rect width="10" height="20" fill="#009246" />
      <rect x="20" width="10" height="20" fill="#ce2b37" />
    </>
  ),
  jp: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <circle cx="15" cy="10" r="6" fill="#bc002d" />
    </>
  ),
  kr: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <path d="M9.6 10a5.4 5.4 0 0 1 10.8 0" fill="#cd2e3a" />
      <path d="M9.6 10a5.4 5.4 0 0 0 10.8 0 2.7 2.7 0 0 0-5.4 0 2.7 2.7 0 0 1-5.4 0Z" fill="#0047a0" />
      <path d="M9.6 10a2.7 2.7 0 0 1 5.4 0 2.7 2.7 0 0 0 5.4 0 5.4 5.4 0 0 0-10.8 0Z" fill="#cd2e3a" />
      <g stroke="#000" strokeWidth="0.9">
        <path d="M3.4 3.6l2.6-1.6M3.9 4.8l2.6-1.6M4.4 6l2.6-1.6" />
        <path d="M24 2l2.6 1.6M23.5 3.2l2.6 1.6M23 4.4l2.6 1.6" />
        <path d="M3.4 16.4 6 18M3.9 15.2 6.5 16.8M4.4 14 7 15.6" />
        <path d="M24 18l2.6-1.6M23.5 16.8l2.6-1.6M23 15.6l2.6-1.6" />
      </g>
    </>
  ),
  sa: (
    <>
      <rect width="30" height="20" fill="#006c35" />
      <path d="M8 7.2h14M9 9h12M10 10.8h10" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
      <path d="M8.5 14.4h13" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
    </>
  ),
  tr: (
    <>
      <rect width="30" height="20" fill="#e30a17" />
      <circle cx="11" cy="10" r="5" fill="#fff" />
      <circle cx="12.6" cy="10" r="4" fill="#e30a17" />
      <polygon points={star(17, 10, 2.4, -90)} fill="#fff" />
    </>
  ),
  vn: (
    <>
      <rect width="30" height="20" fill="#da251d" />
      <polygon points={star(15, 10.4, 6)} fill="#ff0" />
    </>
  ),
};

/** Drapeau simplifié (SVG intégré : s'affiche partout, y compris sous Windows qui n'affiche pas les émojis de drapeaux). */
export function Flag({ code, className = '' }: { code: Code; className?: string }) {
  return (
    <svg viewBox="0 0 30 20" className={`h-5 w-[30px] overflow-hidden rounded-[3px] ring-1 ring-black/10 ${className}`} aria-hidden="true" focusable="false">
      {FLAGS[code]}
    </svg>
  );
}
