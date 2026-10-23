import OpenGraphImage from './opengraph-image';

// Même image pour les cartes X / Twitter. Les exports de configuration sont redéclarés (Next ne les relit pas à travers un export groupé).
export const alt = 'Postbiz';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export default OpenGraphImage;
