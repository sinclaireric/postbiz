import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@/lib/data';
import { DEMO_CONTEXT, demoRepositories } from '@/lib/data/demo';
import { DEMO_VIDEO_MS } from '@/lib/agent/demo';
import { parseVideoJobResponse } from '@/lib/agent/video-client';
import type { VideoJobResponse } from '@/lib/agent/types';

const state = vi.hoisted(() => ({ session: null as unknown, byToken: null as unknown as (token: string) => Promise<{ session: unknown; repos: unknown }>, cookieReads: 0 }));
vi.mock('@/lib/data', async () => ({
  getSession: async () => { state.cookieReads++; return state.session; },
  getRepositories: async () => (await import('@/lib/data/demo')).demoRepositories,
  bearerToken: (header: string | null) => /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? null,
  getSessionForToken: (token: string) => state.byToken(token),
}));

const { GET } = await import('./route');

const ready = (over: { id?: string; role?: 'admin' | 'member' | 'viewer' } = {}): SessionState => ({
  status: 'ready', ctx: { ...DEMO_CONTEXT, mode: 'demo', user: { ...DEMO_CONTEXT.user, id: over.id ?? 'u-' + Math.random() }, org: { ...DEMO_CONTEXT.org, role: over.role ?? 'admin' } },
});
const get = (id: string, headers: Record<string, string> = {}) => GET(new Request(`http://localhost/api/agent/video/${id}`, { headers }), { params: Promise.resolve({ id }) });
const newJob = async (prompt = 'Un rabot sur du chêne') => (await demoRepositories.generation.createJob({ prompt, orientation: 'vertical', providerTaskId: `demo-${Date.now()}`, referenceMediaIds: [] }))!;

beforeEach(() => {
  state.session = ready();
  state.cookieReads = 0;
  state.byToken = async () => ({ session: { status: 'anonymous' }, repos: null });
});

describe('GET /api/agent/video/[id]', () => {
  it('refuse un visiteur anonyme et un lecteur', async () => {
    state.session = { status: 'anonymous' } satisfies SessionState;
    const anon = await get('v1');
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: 'forbidden' });
    state.session = ready({ role: 'viewer' });
    expect((await get('v1')).status).toBe(403);
  });

  it('refuse un identifiant mal formé, et une vidéo qui n’existe pas', async () => {
    expect((await get('../../etc/passwd')).status).toBe(400);
    expect((await get('x'.repeat(65))).status).toBe(400);
    const missing = await get('fantome');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
  });

  it('une vidéo en cours reste en cours ; une réponse lisible par le navigateur et le mobile, sans identifiant du fournisseur', async () => {
    const job = await newJob();
    const res = await get(job.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as VideoJobResponse;
    expect(body).toEqual({ job: { id: job.id, status: 'pending', orientation: 'vertical', prompt: 'Un rabot sur du chêne', mediaId: null, error: null, createdAt: job.createdAt }, media: null, url: null });
    expect(JSON.stringify(body)).not.toContain('demo-');
    expect(parseVideoJobResponse(body)).toEqual(body);
  });

  it('une vidéo prête est rangée dans la médiathèque, une seule fois, même interrogée plusieurs fois', async () => {
    const job = await newJob();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + DEMO_VIDEO_MS + 1_000 });
    try {
      const before = (await demoRepositories.media.list({ pageSize: 500 })).total;
      const [a, b] = await Promise.all([get(job.id), get(job.id)]);
      const first = (await a.json()) as VideoJobResponse;
      const second = (await b.json()) as VideoJobResponse;
      expect(first.job.status === 'completed' || second.job.status === 'completed').toBe(true);
      const again = (await (await get(job.id)).json()) as VideoJobResponse;
      expect(again.job).toMatchObject({ status: 'completed', mediaId: expect.any(String) });
      expect(again.media).toMatchObject({ id: again.job.mediaId, kind: 'video', durationSeconds: 8 });
      expect((await demoRepositories.media.list({ pageSize: 500 })).total).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('l’application mobile s’identifie par son jeton, sans lire les cookies', async () => {
    const job = await newJob();
    state.byToken = async () => ({ session: ready({ id: 'mobile-video' }), repos: demoRepositories });
    const res = await get(job.id, { Authorization: 'Bearer abc.def' });
    expect(res.status).toBe(200);
    expect(state.cookieReads).toBe(0);
    state.byToken = async () => ({ session: { status: 'anonymous' }, repos: null });
    expect((await get(job.id, { Authorization: 'Bearer perime' })).status).toBe(401);
  });

  it('limite les interrogations par utilisateur, sans gêner les autres', async () => {
    state.session = ready({ id: 'impatient' });
    const codes: number[] = [];
    for (let i = 0; i < 41; i++) codes.push((await get('fantome')).status);
    expect(codes.slice(0, 40).every((c) => c === 404)).toBe(true);
    expect(codes[40]).toBe(429);
    state.session = ready({ id: 'patient' });
    expect((await get('fantome')).status).toBe(404);
  });
});

describe('parseVideoJobResponse', () => {
  const job = { id: 'j1', status: 'pending', orientation: 'vertical', prompt: 'x', mediaId: null, error: null, createdAt: '2026-10-27T10:00:00Z' };
  it('relit une réponse correcte et rejette les autres', () => {
    expect(parseVideoJobResponse({ job, media: null, url: null })).toEqual({ job, media: null, url: null });
    const media = { id: 'm1', kind: 'video', name: 'v.mp4', alt: '', url: null, thumbUrl: null, durationSeconds: 8 };
    expect(parseVideoJobResponse({ job: { ...job, status: 'completed', mediaId: 'm1' }, media, url: 'https://cdn/x' })?.media).toEqual(media);
    for (const bad of [null, 'x', {}, { error: 'not_found' }, { job: { ...job, status: 'zzz' }, media: null, url: null }, { job: { ...job, orientation: 'carre' }, media: null, url: null },
      { job, media: 'x', url: null }, { job, media: null, url: 3 }, { job: { ...job, mediaId: 4 }, media: null, url: null }, { job: { ...job, id: 7 }, media: null, url: null }]) {
      expect(parseVideoJobResponse(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
