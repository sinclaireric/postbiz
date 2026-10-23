import { ImageResponse } from 'next/og';

// Icône de l'écran d'accueil (iOS) : le logo Postbiz, sans transparence (iOS arrondit lui-même les angles).
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#c6f432' }}>
        <svg width="112" height="112" viewBox="0 0 32 32" fill="none">
          <path d="M10 8h7.5a5.5 5.5 0 0 1 0 11H14v5h-4V8Zm4 3.6v3.8h3.3a1.9 1.9 0 0 0 0-3.8H14Z" fill="#111110" />
        </svg>
      </div>
    ),
    size
  );
}
