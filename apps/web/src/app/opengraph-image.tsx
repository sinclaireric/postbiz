import { ImageResponse } from 'next/og';

// Image de partage (Open Graph) par défaut de toutes les pages : le logo et le nom, sans texte traduit (la police intégrée ne couvre pas
// toutes les langues du site). Une page peut avoir la sienne en ajoutant un fichier opengraph-image dans son dossier.
export const alt = 'Postbiz';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf7', position: 'relative' }}>
        <div style={{ position: 'absolute', right: -140, top: -140, width: 520, height: 520, borderRadius: 520, background: '#eef9c4', display: 'flex' }} />
        <div style={{ position: 'absolute', left: -120, bottom: -160, width: 420, height: 420, borderRadius: 420, background: '#c6f432', opacity: 0.35, display: 'flex' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <svg width="210" height="210" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="9" fill="#c6f432" />
            <path d="M10 8h7.5a5.5 5.5 0 0 1 0 11H14v5h-4V8Zm4 3.6v3.8h3.3a1.9 1.9 0 0 0 0-3.8H14Z" fill="#111110" />
          </svg>
          <div style={{ display: 'flex', fontSize: 168, letterSpacing: -6, color: '#111110' }}>postbiz</div>
        </div>
      </div>
    ),
    size
  );
}
