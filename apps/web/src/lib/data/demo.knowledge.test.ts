import { describe, expect, it } from 'vitest';
import { chunkKnowledge } from '@/lib/kb/chunk';
import { demoRepositories } from './demo';

const kb = demoRepositories.knowledge;
const search = (terms: string[], over: { limit?: number; perItem?: number; exclude?: string[] } = {}) => kb.search({ embedding: null, terms, limit: 6, perItem: 3, exclude: [], ...over });
/** Les passages d'une fiche seulement (les fiches d'exemple partagent quelques mots avec celles que les tests créent). */
const of = async (id: string, terms: string[]) => (await search(terms)).filter((h) => h.itemId === id);

describe('base de connaissance (mode démo)', () => {
  it('les fiches d’exemple sont indexées ; les questions fréquentes ne sont pas épinglées', async () => {
    const items = await kb.list();
    const faq = items.find((k) => k.id === 'k3')!;
    expect(items.find((k) => k.id === 'k1')).toMatchObject({ pinned: true, indexedAt: expect.any(String), embeddedAt: null });
    expect(faq).toMatchObject({ pinned: false, chunkCount: chunkKnowledge(faq.title, faq.content).length });
    expect(items.every((k) => k.chunkCount > 0 && k.indexedAt !== null)).toBe(true);
  });

  it('rapproche les mots qui commencent pareil (la démo n’a pas de radicaux) : « livrez » trouve « livraison »', async () => {
    const hits = await search(['livrez', 'belgique']);
    expect(hits[0]).toMatchObject({ itemId: 'k3', termHits: 2 });
    expect(hits[0]!.content).toContain('Livraison en France et en Belgique');
    // Quatre lettres communes ne suffisent pas pour un mot court.
    expect(await search(['fini'])).toEqual([]);
  });

  it('cherche par les mots : le passage qui contient le plus de mots de la question vient en premier', async () => {
    const hits = await search(['atelier', 'ouvert', 'samedi']);
    expect(hits[0]).toMatchObject({ itemId: 'k3', title: 'Questions fréquentes', termHits: 3, similarity: 0 });
    expect(hits[0]!.content).toContain('samedi');
    expect(await search(['inexistantxyz'])).toEqual([]);
    expect(await search([])).toEqual([]);
  });

  it('écarte les fiches demandées, borne le nombre de passages et par fiche', async () => {
    expect((await search(['atelier'], { exclude: ['k3'] })).some((h) => h.itemId === 'k3')).toBe(false);
    expect(await search(['atelier', 'garantie', 'livraison', 'tutoyons'], { limit: 1 })).toHaveLength(1);
  });

  it('créer une fiche ne l’indexe pas ; écrire ses passages la rend cherchable et marque son état', async () => {
    const created = await kb.create({ title: 'Reprise', content: 'La reprise de l’ancien meuble est gratuite pour tout achat d’une table.' });
    expect(created.ok).toBe(true);
    const id = created.id!;
    expect(await of(id, ['reprise', 'meuble'])).toEqual([]);

    const written = await kb.replaceChunks(id, [{ content: 'La reprise de l’ancien meuble est gratuite.', embedding: null, meta: { heading: 'Reprise' } }]);
    expect(written.ok).toBe(true);
    const item = (await kb.list()).find((k) => k.id === id)!;
    expect(item).toMatchObject({ chunkCount: 1, embeddedAt: null, pinned: true });
    expect(item.indexedAt).not.toBeNull();
    const hits = await of(id, ['reprise', 'meuble']);
    expect(hits[0]).toMatchObject({ itemId: id, title: 'Reprise', heading: 'Reprise', termHits: 2 });

    // Avec des vecteurs partout, la fiche est « vectorisée ».
    await kb.replaceChunks(id, [{ content: 'a', embedding: [1, 0], meta: {} }]);
    expect((await kb.list()).find((k) => k.id === id)!.embeddedAt).not.toBeNull();
  });

  it('modifier le titre ou le contenu supprime les passages ; épingler ou désépingler les garde', async () => {
    const id = (await kb.create({ title: 'À modifier', content: 'Le chêne massif vieillit bien.' })).id!;
    await kb.replaceChunks(id, [{ content: 'Le chêne massif vieillit bien.', embedding: null, meta: {} }]);
    expect(await of(id, ['chêne', 'massif'])).toHaveLength(1);

    await kb.setPinned(id, false);
    expect((await kb.list()).find((k) => k.id === id)).toMatchObject({ pinned: false, chunkCount: 1 });

    await kb.update(id, { title: 'À modifier', content: 'Le chêne massif vieillit bien.' });
    expect((await kb.list()).find((k) => k.id === id)!.chunkCount).toBe(1);

    await kb.update(id, { title: 'À modifier', content: 'Le noyer vieillit bien.' });
    expect((await kb.list()).find((k) => k.id === id)).toMatchObject({ chunkCount: 0, indexedAt: null, embeddedAt: null });
    expect(await of(id, ['chêne', 'massif'])).toEqual([]);
  });

  it('supprimer une fiche supprime ses passages ; une fiche inconnue est refusée', async () => {
    const id = (await kb.create({ title: 'Éphémère', content: 'Le mélèze est léger.' })).id!;
    await kb.replaceChunks(id, [{ content: 'Le mélèze est léger.', embedding: null, meta: {} }]);
    await kb.remove(id);
    expect(await of(id, ['mélèze'])).toEqual([]);
    expect((await kb.replaceChunks('fantome', [])).ok).toBe(false);
    expect((await kb.setPinned('fantome', true)).ok).toBe(false);
    expect((await kb.update('fantome', { title: 'x', content: 'y' })).ok).toBe(false);
  });
});
