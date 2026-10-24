// Recadrage d'une image pour un format imposé (Instagram : entre 4:5 et 1,91:1). Fonctions pures, testées dans image-fit.test.ts.

export const INSTAGRAM_MIN_RATIO = 0.8;
export const INSTAGRAM_MAX_RATIO = 1.91;
/** Largeur maximale du fichier recadré : Instagram réduit de toute façon à 1080–1440 px, et le fichier reste léger. */
export const CROP_MAX_WIDTH = 1440;

export type Rect = { originX: number; originY: number; width: number; height: number };

const EPS = 1e-6;

export const instagramRatioOk = (width: number, height: number) => {
  const r = width / height;
  return r >= INSTAGRAM_MIN_RATIO - EPS && r <= INSTAGRAM_MAX_RATIO + EPS;
};

/** Format accepté le plus proche de celui de l'image : on coupe le moins possible. */
export const nearestInstagramRatio = (width: number, height: number) => Math.min(INSTAGRAM_MAX_RATIO, Math.max(INSTAGRAM_MIN_RATIO, width / height));

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Zone à garder dans une image `iw` × `ih` pour obtenir le format `ratio` (largeur / hauteur), le plus grand possible.
 * `fx` et `fy` (0 à 1) placent la zone : 0,5 centre ; seul l'axe qui déborde bouge.
 * Les arrondis ne sortent jamais du format accepté par Instagram (quand `ratio` en fait partie).
 */
export function cropRect(iw: number, ih: number, ratio: number, fx = 0.5, fy = 0.5): Rect {
  let width: number;
  let height: number;
  if (iw / ih >= ratio) {
    height = ih;
    width = Math.round(ih * ratio);
    width = clamp(width, Math.ceil(ih * INSTAGRAM_MIN_RATIO - EPS), Math.floor(ih * INSTAGRAM_MAX_RATIO + EPS));
    if (ratio < INSTAGRAM_MIN_RATIO || ratio > INSTAGRAM_MAX_RATIO) width = Math.round(ih * ratio);
    width = Math.min(iw, Math.max(1, width));
  } else {
    width = iw;
    height = Math.round(iw / ratio);
    height = clamp(height, Math.ceil(iw / INSTAGRAM_MAX_RATIO - EPS), Math.floor(iw / INSTAGRAM_MIN_RATIO + EPS));
    if (ratio < INSTAGRAM_MIN_RATIO || ratio > INSTAGRAM_MAX_RATIO) height = Math.round(iw / ratio);
    height = Math.min(ih, Math.max(1, height));
  }
  return {
    originX: Math.round(clamp(fx, 0, 1) * (iw - width)),
    originY: Math.round(clamp(fy, 0, 1) * (ih - height)),
    width,
    height,
  };
}

/** Dimensions finales d'une zone recadrée : réduites à `maxWidth` de large, sans jamais sortir du format Instagram. */
export function outputSize(rect: Pick<Rect, "width" | "height">, maxWidth = CROP_MAX_WIDTH): { width: number; height: number } {
  if (rect.width <= maxWidth) return { width: rect.width, height: rect.height };
  const width = maxWidth;
  let height = Math.round((rect.height * maxWidth) / rect.width);
  if (instagramRatioOk(rect.width, rect.height)) {
    height = clamp(height, Math.ceil(width / INSTAGRAM_MAX_RATIO - EPS), Math.floor(width / INSTAGRAM_MIN_RATIO + EPS));
  }
  return { width, height };
}

/** Image affichée pour remplir un cadre `fw` × `fh` (comme `cover`), décalée selon le point de vue `fx` / `fy`. */
export function coverLayout(iw: number, ih: number, fw: number, fh: number, fx: number, fy: number) {
  const scale = Math.max(fw / iw, fh / ih);
  const width = iw * scale;
  const height = ih * scale;
  const overflowX = Math.max(0, width - fw);
  const overflowY = Math.max(0, height - fh);
  return { width, height, overflowX, overflowY, left: -clamp(fx, 0, 1) * overflowX, top: -clamp(fy, 0, 1) * overflowY };
}
