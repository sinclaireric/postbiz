import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@/lib/data';
import { DEMO_CONTEXT, demoRepositories } from '@/lib/data/demo';
import { SOURCE_LIMITS } from '@postbiz/kb';

const state = vi.hoisted(() => ({ session: null as unknown, revalidated: [] as string[] }));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => void state.revalidated.push(path) }));
vi.mock('@/i18n/server', () => ({ getT: async () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }));
vi.mock('@/lib/data', async () => ({ getSession: async () => state.session, getRepositories: async () => (await import('@/lib/data/demo')).demoRepositories }));

const { POST } = await import('./route');

const ready = (over: { role?: 'admin' | 'member' | 'viewer'; mode?: 'demo' | 'supabase' } = {}): SessionState => ({
  status: 'ready', ctx: { ...DEMO_CONTEXT, mode: over.mode ?? 'demo', org: { ...DEMO_CONTEXT.org, role: over.role ?? 'admin' } },
});
const upload = (file: File | string | null) => {
  const body = new FormData();
  if (file !== null) body.set('file', file);
  return POST(new Request('http://localhost/api/knowledge/demo-upload', { method: 'POST', body }));
};
const json = async (res: Response) => (await res.json()) as { ok: boolean; error?: string };
const files = async () => (await demoRepositories.knowledge.list()).filter((k) => k.kind === 'file');

beforeEach(() => {
  state.session = ready();
  state.revalidated = [];
});

describe('POST /api/knowledge/demo-upload : l’envoi de documents en mode démonstration', () => {
  it('lit le fichier tout de suite, pour de vrai : il est prêt, cherchable, et la page est rafraîchie', async () => {
    const res = await upload(new File(['Nous livrons en Belgique sous cinq jours.\n\nRetours acceptés sous quatorze jours.'], 'conditions_de_vente.txt', { type: 'text/plain' }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(state.revalidated).toEqual(['/app/connaissances']);

    const item = (await files()).find((f) => f.fileName === 'conditions_de_vente.txt')!;
    expect(item).toMatchObject({ title: 'conditions de vente', status: 'ready', chunkCount: 1, pinned: false });
    const hits = await demoRepositories.knowledge.search({ embedding: null, terms: ['belgique', 'cinq'], limit: 6, perItem: 3, exclude: [] });
    expect(hits.find((h) => h.itemId === item.id)?.content).toContain('Belgique');
  });

  it('un fichier illisible est accepté mais apparaît « en échec » avec son code (comme en production)', async () => {
    expect(await json(await upload(new File(['pas un pdf'], 'faux.pdf')))).toEqual({ ok: true });
    expect((await files()).find((f) => f.fileName === 'faux.pdf')).toMatchObject({ status: 'failed', error: 'corrupt' });
  });

  it('le nom du fichier ne peut pas désigner un autre dossier', async () => {
    await upload(new File(['Texte.'], '../../autre/piege.txt'));
    const item = (await files()).find((f) => f.fileName?.endsWith('piege.txt'))!;
    expect(item.fileName).not.toMatch(/[/\\]/);
  });

  it('refuse un visiteur anonyme (401), un autre mode que la démonstration (404) et un lecteur (403)', async () => {
    state.session = { status: 'anonymous' } satisfies SessionState;
    const anonymous = await upload(new File(['x'], 'a.txt'));
    expect(anonymous.status).toBe(401);
    expect(await json(anonymous)).toEqual({ ok: false, error: 'forbidden' });

    state.session = ready({ mode: 'supabase' });
    expect((await upload(new File(['x'], 'b.txt'))).status).toBe(404);

    state.session = ready({ role: 'viewer' });
    const viewer = await upload(new File(['x'], 'c.txt'));
    expect(viewer.status).toBe(403);
    expect(await json(viewer)).toEqual({ ok: false, error: 'app.knowledge.viewerNote' });

    expect((await files()).some((f) => ['a.txt', 'b.txt', 'c.txt'].includes(f.fileName ?? ''))).toBe(false);
    expect(state.revalidated).toEqual([]);
  });

  it('refuse une requête sans fichier, avec autre chose qu’un fichier, ou un fichier vide (400)', async () => {
    for (const body of [await upload(null), await upload('du texte'), await upload(new File([], 'vide.txt'))]) {
      expect(body.status).toBe(400);
      expect(await json(body)).toEqual({ ok: false, error: 'app.knowledgePage.errors.fileMissing' });
    }
    const notAForm = await POST(new Request('http://localhost/api/knowledge/demo-upload', { method: 'POST', body: JSON.stringify({ file: 'x' }), headers: { 'Content-Type': 'application/json' } }));
    expect(notAForm.status).toBe(400);
  });

  it('refuse un fichier de plus de 10 Mo (413) en le disant en mégaoctets', async () => {
    const big = await upload(new File([new Uint8Array(SOURCE_LIMITS.fileBytes + 1)], 'enorme.txt'));
    expect(big.status).toBe(413);
    expect(await json(big)).toEqual({ ok: false, error: 'app.knowledgePage.errors.fileTooLarge {"max":10}' });
    expect((await files()).some((f) => f.fileName === 'enorme.txt')).toBe(false);
  });

  it('un corps annoncé bien plus gros que la limite est refusé sans être lu (413), au lieu d’un « fichier introuvable » quand le serveur le tronque', async () => {
    const body = new FormData();
    body.set('file', new File(['x'], 'a.txt'));
    const res = await POST(new Request('http://localhost/api/knowledge/demo-upload', { method: 'POST', body, headers: { 'content-length': String(SOURCE_LIMITS.fileBytes + 300_000) } }));
    expect(res.status).toBe(413);
    expect(await json(res)).toEqual({ ok: false, error: 'app.knowledgePage.errors.fileTooLarge {"max":10}' });
    // Un fichier de 10 Mo pile, avec les en-têtes du formulaire, reste admis.
    const ok = new FormData();
    ok.set('file', new File(['Texte.'], 'b.txt'));
    expect((await POST(new Request('http://localhost/api/knowledge/demo-upload', { method: 'POST', body: ok, headers: { 'content-length': String(SOURCE_LIMITS.fileBytes + 1_000) } }))).status).toBe(200);
  });

  it('refuse un type de fichier non pris en charge (400), avec le message de la base', async () => {
    const res = await upload(new File(['MZ'], 'programme.exe'));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ ok: false, error: 'app.knowledgePage.errors.unsupportedType' });
  });
});
