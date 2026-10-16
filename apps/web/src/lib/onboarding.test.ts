import { describe, expect, it } from 'vitest';
import { NETWORKS } from '@/lib/networks';
import { onboardingTiles, tutorialEmbedUrl } from './onboarding';

const all = (available: boolean) => Object.fromEntries(NETWORKS.map((n) => [n.id, { available }]));

describe('onboardingTiles', () => {
  it('une tuile par réseau, dans l’ordre du catalogue', () => {
    expect(onboardingTiles(all(true), { demo: false, role: 'admin' }).map((t) => t.id)).toEqual(NETWORKS.map((n) => n.id));
  });
  it('un administrateur peut connecter les réseaux configurés', () => {
    const tiles = onboardingTiles({ ...all(false), facebook: { available: true } }, { demo: false, role: 'admin' });
    expect(tiles.find((t) => t.id === 'facebook')!.state).toBe('connect');
    expect(tiles.find((t) => t.id === 'x')!.state).toBe('unavailable');
  });
  it('un membre ou un lecteur ne peut pas connecter de canal', () => {
    for (const role of ['member', 'viewer'] as const) {
      expect(onboardingTiles(all(true), { demo: false, role }).every((t) => t.state === 'admin_only')).toBe(true);
    }
  });
  it('le mode démo simule la connexion de tous les réseaux', () => {
    expect(onboardingTiles(all(false), { demo: true, role: 'viewer' }).every((t) => t.state === 'demo')).toBe(true);
  });
  it('conserve les capacités de chaque réseau (inbox : LinkedIn sans messages privés)', () => {
    expect(onboardingTiles(all(true), { demo: false, role: 'admin' }).find((t) => t.id === 'linkedin')!.capabilities.dm).toBe('none');
  });
});

describe('tutorialEmbedUrl', () => {
  it('accepte une URL https', () => expect(tutorialEmbedUrl('https://www.youtube.com/embed/abc')).toBe('https://www.youtube.com/embed/abc'));
  it('refuse le reste', () => {
    for (const bad of [undefined, '', 'http://x.test/v', 'javascript:alert(1)', 'pas une url', 'data:text/html,x']) expect(tutorialEmbedUrl(bad)).toBeNull();
  });
});
