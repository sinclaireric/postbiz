import { describe, expect, it, vi } from 'vitest';
import { tusUpload, TusError } from './tus';

const decode = (v: string) => new TextDecoder().decode(Uint8Array.from(atob(v), (c) => c.charCodeAt(0)));

/** Faux serveur TUS : garde les octets reçus et applique des pannes programmées. */
function server(opts: { failPatch?: (n: number) => 'network' | 500 | 403 | null; dropAckOnce?: boolean } = {}) {
  let stored = 0;
  let patches = 0;
  let droppedAck = false;
  const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, url: String(url), headers });
    if (method === 'POST') return new Response(null, { status: 201, headers: { Location: '/storage/v1/upload/resumable/abc123' } });
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'Upload-Offset': String(stored) } });
    patches++;
    const fail = opts.failPatch?.(patches);
    if (fail === 'network') throw new TypeError('failed to fetch');
    if (fail) return new Response(null, { status: fail });
    expect(Number(headers['Upload-Offset'])).toBe(stored); // le client reprend au bon octet
    stored += (init!.body as Blob).size;
    if (opts.dropAckOnce && !droppedAck) { droppedAck = true; throw new TypeError('réponse perdue'); }
    return new Response(null, { status: 204, headers: { 'Upload-Offset': String(stored) } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, stored: () => stored };
}

const base = { endpoint: 'https://p.supabase.co/storage/v1/upload/resumable', headers: { Authorization: 'Bearer T', apikey: 'K' }, bucket: 'media', objectName: 'org/a.mp4', contentType: 'video/mp4', sleep: async () => {} };
const blob = (n: number) => new Blob([new Uint8Array(n)]);

describe('envoi TUS', () => {
  it('crée l’envoi avec les métadonnées, puis envoie les morceaux dans l’ordre en rendant compte de la progression', async () => {
    const s = server();
    const progress: number[] = [];
    await tusUpload({ ...base, file: blob(25), chunkBytes: 10, fetchImpl: s.fetchImpl, onProgress: (sent) => progress.push(sent) });
    expect(s.stored()).toBe(25);
    expect(progress).toEqual([10, 20, 25]);
    const [create] = s.calls;
    expect(create).toMatchObject({ method: 'POST', url: base.endpoint });
    expect(create!.headers).toMatchObject({ 'Tus-Resumable': '1.0.0', 'Upload-Length': '25', Authorization: 'Bearer T', apikey: 'K' });
    const meta = Object.fromEntries(create!.headers['Upload-Metadata']!.split(',').map((p) => p.split(' ') as [string, string]).map(([k, v]) => [k, decode(v)]));
    expect(meta).toMatchObject({ bucketName: 'media', objectName: 'org/a.mp4', contentType: 'video/mp4' });
    expect(s.calls.filter((c) => c.method === 'PATCH').every((c) => c.url === 'https://p.supabase.co/storage/v1/upload/resumable/abc123')).toBe(true); // Location relative résolue
  });

  it('un fichier plus petit qu’un morceau part d’un coup', async () => {
    const s = server();
    await tusUpload({ ...base, file: blob(5), chunkBytes: 10, fetchImpl: s.fetchImpl });
    expect(s.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('une coupure réseau ou un 5xx est retenté, sans renvoyer ce que le serveur a déjà reçu', async () => {
    const s = server({ failPatch: (n) => (n === 2 ? 'network' : n === 3 ? 500 : null) });
    await tusUpload({ ...base, file: blob(30), chunkBytes: 10, fetchImpl: s.fetchImpl });
    expect(s.stored()).toBe(30);
    expect(s.calls.some((c) => c.method === 'HEAD')).toBe(true);
  });

  it('si la réponse d’un morceau est perdue alors qu’il est arrivé, on reprend après lui (pas de doublon)', async () => {
    const s = server({ dropAckOnce: true });
    await tusUpload({ ...base, file: blob(20), chunkBytes: 10, fetchImpl: s.fetchImpl });
    expect(s.stored()).toBe(20);
  });

  it('un refus définitif (403) arrête tout, sans réessayer', async () => {
    const s = server({ failPatch: () => 403 });
    await expect(tusUpload({ ...base, file: blob(20), chunkBytes: 10, fetchImpl: s.fetchImpl })).rejects.toMatchObject({ name: 'TusError', status: 403 });
    expect(s.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('abandonne après trop de pannes consécutives', async () => {
    const s = server({ failPatch: () => 'network' });
    await expect(tusUpload({ ...base, file: blob(20), chunkBytes: 10, retries: 2, fetchImpl: s.fetchImpl })).rejects.toBeInstanceOf(TusError);
    expect(s.calls.filter((c) => c.method === 'PATCH')).toHaveLength(3);
  });

  it('refuse proprement quand la création est refusée', async () => {
    const f = vi.fn(async () => new Response(null, { status: 413 })) as unknown as typeof fetch;
    await expect(tusUpload({ ...base, file: blob(5), fetchImpl: f })).rejects.toMatchObject({ status: 413 });
  });
});
