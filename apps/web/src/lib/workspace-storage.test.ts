import { describe, expect, it } from 'vitest';
import { purgeWorkspaceFiles, type StorageLike } from './workspace-storage';

const ORG = '11111111-2222-4333-8444-555555555555';

/** Un stockage de poche : « dossier » -> entrées (sans identifiant = sous-dossier). */
function fakeStorage(tree: Record<string, { name: string; id: string | null }[]>, opts: { failList?: string; failRemove?: boolean } = {}) {
  const removed: Record<string, string[]> = {};
  const listed: string[] = [];
  const storage: StorageLike = {
    from: (bucket) => ({
      async list(path, { limit, offset }) {
        listed.push(`${bucket}:${path}`);
        if (opts.failList === bucket) return { data: null, error: new Error('boom') };
        return { data: (tree[`${bucket}:${path}`] ?? []).slice(offset, offset + limit), error: null };
      },
      async remove(paths) {
        if (opts.failRemove) return { error: new Error('boom') };
        (removed[bucket] ??= []).push(...paths);
        return { error: null };
      },
    }),
  };
  return { storage, removed, listed };
}

describe('purgeWorkspaceFiles : retirer les fichiers d’un espace supprimé', () => {
  it('retire tous les fichiers du dossier de l’espace, sous-dossiers compris, dans chaque bucket', async () => {
    const { storage, removed } = fakeStorage({
      [`media:${ORG}`]: [{ name: 'a.jpg', id: 'f1' }, { name: 'normalized', id: null }],
      [`media:${ORG}/normalized`]: [{ name: 'a.mp4', id: 'f2' }],
      [`knowledge:${ORG}`]: [{ name: 'guide.pdf', id: 'f3' }],
    });
    expect(await purgeWorkspaceFiles(storage, ORG)).toEqual({ removed: 3, failed: false });
    expect(removed.media?.sort()).toEqual([`${ORG}/a.jpg`, `${ORG}/normalized/a.mp4`]);
    expect(removed.knowledge).toEqual([`${ORG}/guide.pdf`]);
  });

  it('lit les listes page par page (100 à la fois) et supprime par lots de 100', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ name: `f${i}.jpg`, id: `id${i}` }));
    const { storage, removed } = fakeStorage({ [`media:${ORG}`]: many });
    expect(await purgeWorkspaceFiles(storage, ORG)).toEqual({ removed: 250, failed: false });
    expect(removed.media).toHaveLength(250);
    expect(new Set(removed.media).size).toBe(250);
  });

  it('un espace sans fichier ne retire rien', async () => {
    const { storage, removed } = fakeStorage({});
    expect(await purgeWorkspaceFiles(storage, ORG)).toEqual({ removed: 0, failed: false });
    expect(removed).toEqual({});
  });

  it('refuse un identifiant qui n’est pas un UUID : aucun chemin construit à partir d’autre chose (pas de « .. », pas de dossier racine)', async () => {
    for (const bad of ['', '.', '..', '../autre', 'media', `${ORG}/..`, '*', ORG.toUpperCase().slice(1)]) {
      const { storage, listed } = fakeStorage({});
      expect(await purgeWorkspaceFiles(storage, bad), bad).toEqual({ removed: 0, failed: true });
      expect(listed, bad).toEqual([]);
    }
  });

  it('signale l’échec d’une lecture ou d’une suppression sans s’arrêter aux autres buckets', async () => {
    const tree = { [`media:${ORG}`]: [{ name: 'a.jpg', id: 'f1' }], [`knowledge:${ORG}`]: [{ name: 'b.pdf', id: 'f2' }] };
    const listFail = fakeStorage(tree, { failList: 'media' });
    expect(await purgeWorkspaceFiles(listFail.storage, ORG)).toEqual({ removed: 1, failed: true });
    expect(listFail.removed.knowledge).toEqual([`${ORG}/b.pdf`]);
    const removeFail = fakeStorage(tree, { failRemove: true });
    expect(await purgeWorkspaceFiles(removeFail.storage, ORG)).toEqual({ removed: 0, failed: true });
  });
});
