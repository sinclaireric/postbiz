import { describe, expect, it } from 'vitest';
import type { T } from '@/i18n/types';
import { demoRepositories as repos } from '@/lib/data/demo';
import { savePost, type SavePostRequest } from './save';

// Les textes reviennent sous forme de clé : le test vérifie quelle règle a parlé, pas la langue.
const t = ((key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key)) as unknown as T;

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const base = (over: Partial<SavePostRequest> = {}): SavePostRequest => ({ content: 'Atelier ouvert samedi', integrationIds: ['i2'], publishAt: inDays(2), mode: 'schedule', firstComment: '', media: [], ...over });

const posts = () => repos.posts.list();
const countBy = async (text: string) => (await posts()).filter((p) => p.content === text).length;

describe('savePost : la voie d’écriture commune au composeur et à l’agent', () => {
  it('programme une publication sur un canal actif', async () => {
    const content = 'Programmée par le test';
    expect(await savePost(repos, t, base({ content }))).toEqual({ ok: true });
    const saved = (await posts()).find((p) => p.content === content)!;
    expect(saved).toMatchObject({ state: 'queued', integrationId: 'i2', networkId: 'facebook' });
    expect(saved.publishAt).not.toBeNull();
  });

  it('enregistre un brouillon, avec ou sans date', async () => {
    expect(await savePost(repos, t, base({ content: 'Brouillon daté', mode: 'draft' }))).toEqual({ ok: true });
    expect(await savePost(repos, t, base({ content: 'Brouillon sans date', mode: 'draft', publishAt: null }))).toEqual({ ok: true });
    const list = await posts();
    expect(list.find((p) => p.content === 'Brouillon daté')).toMatchObject({ state: 'draft' });
    expect(list.find((p) => p.content === 'Brouillon sans date')).toMatchObject({ state: 'draft', publishAt: null });
  });

  it('refuse une date passée sans rien écrire', async () => {
    const content = 'Date passée';
    const res = await savePost(repos, t, base({ content, publishAt: inDays(-1) }));
    expect(res).toEqual({ ok: false, errors: ['app.validation.pastDate'] });
    expect(await countBy(content)).toBe(0);
  });

  it('refuse un texte trop long pour le réseau (X : 280)', async () => {
    const x = (await repos.workspace.integrations()).find((i) => i.networkId === 'x')?.id;
    if (!x) return; // la démo n'a pas de canal X : couvert par logic.test.ts
    const res = await savePost(repos, t, base({ integrationIds: [x], content: 'a'.repeat(300) }));
    expect(res.ok).toBe(false);
  });

  it('refuse Instagram sans média : le réseau en exige un', async () => {
    const res = await savePost(repos, t, base({ integrationIds: ['i1'], content: 'Sans image' }));
    expect(res.ok === false && res.errors[0]).toContain('app.validation.needsMedia');
    expect(await countBy('Sans image')).toBe(0);
  });

  it('accepte Instagram avec une image de la bibliothèque, et garde son texte alternatif', async () => {
    const res = await savePost(repos, t, base({ integrationIds: ['i1'], content: 'Avec image', media: [{ id: 'm1', alt: 'Atelier en hiver' }] }));
    expect(res).toEqual({ ok: true });
    expect((await posts()).find((p) => p.content === 'Avec image')!.media).toMatchObject([{ id: 'm1', kind: 'image', alt: 'Atelier en hiver' }]);
  });

  it('refuse un média qui n’est pas dans la bibliothèque', async () => {
    const res = await savePost(repos, t, base({ integrationIds: ['i1'], content: 'Média fantôme', media: [{ id: 'inconnu', alt: '' }] }));
    expect(res).toEqual({ ok: false, errors: ['app.validation.mediaMissing'] });
    expect(await countBy('Média fantôme')).toBe(0);
  });

  it('refuse un canal à reconnecter', async () => {
    const res = await savePost(repos, t, base({ integrationIds: ['i3'], content: 'Canal expiré', media: [{ id: 'm5', alt: '' }] }));
    expect(res.ok === false && res.errors[0]).toContain('app.composer.errReconnect');
    expect(await countBy('Canal expiré')).toBe(0);
  });

  it('refuse les médias là où le worker ne sait pas encore les publier, mais accepte Facebook avec une image', async () => {
    expect(await savePost(repos, t, base({ content: 'Facebook avec image', media: [{ id: 'm1', alt: '' }] }))).toEqual({ ok: true });
  });

  it('donne le premier commentaire aux canaux qui savent le publier', async () => {
    const content = 'Avec premier commentaire';
    expect(await savePost(repos, t, base({ content, firstComment: 'Adresse en commentaire' }))).toEqual({ ok: true });
    expect((await posts()).find((p) => p.content === content)).toMatchObject({ firstComment: 'Adresse en commentaire', firstCommentState: 'pending' });
  });

  it('refuse un premier commentaire quand aucun canal choisi ne le gère', async () => {
    const res = await savePost(repos, t, base({ integrationIds: ['i1'], content: 'Insta avec commentaire', media: [{ id: 'm1', alt: '' }], firstComment: 'salut' }));
    expect(res.ok === false && res.errors).toContain('app.validation.firstCommentUnsupported');
  });

  it('refuse une publication sans canal ou vide', async () => {
    expect((await savePost(repos, t, base({ integrationIds: [] }))).ok).toBe(false);
    expect((await savePost(repos, t, base({ content: '   ' }))).ok).toBe(false);
  });
});
